import {
  runScoutTool,
  TOOL_DEFINITIONS,
  type ScoutContext,
  type ScoutMatch,
  type ToolResult,
} from './scoutTools.ts'

export type AiScoutResponse = {
  answer: string
  matches: ScoutMatch[]
  toolsUsed: string[]
  mode: 'ai' | 'rules'
}

type AiBinding = {
  run: (
    model: string,
    input: Record<string, unknown>,
  ) => Promise<{ response?: string; result?: string } | string>
}

type PlannedCall = { name: string; arguments: Record<string, unknown> }

const SYSTEM_PLAN = `Du är en planerare för Svenska Matcher (svensk fotboll).
Välj ENDAST verktyg från listan. Hitta aldrig på matcher.
Viktigt:
- Frågor om vad man HINNER / rekommendera / hela dagen → day_route (inte search_matches).
- Bilresa / längs vägen / från X till Y → matches_along_route.
- "Hinner jag se A och B" → can_make_matches.
- search_matches är bara inventering, inte en genomförbar plan.
Svara med JSON: {"tools":[{"name":"...","arguments":{...}}]}
Om frågan inte handlar om svenska matcher/resor/scouting: {"tools":[],"out_of_scope":true}
Verktyg:
${TOOL_DEFINITIONS.map((t: (typeof TOOL_DEFINITIONS)[number]) => `- ${t.name}: ${t.description}`).join('\n')}`

const SYSTEM_ANSWER = `Du är scoutassistent för Svenska Matcher.
Svara kort på svenska. Använd ENDAST fakta från VERKTYGSRESULTAT.
Om resultatet är en genomförbar dagsrutt/kedja: rekommendera BARA de matcherna och nämn att tiderna är kontrollerade.
Om resultatet är en okontrollerad lista: säg uttryckligen att man troligen inte hinner alla, och föreslå att fråga om dagsrutt.
Hitta aldrig på matcher. Ingen markdown-rubrik.`

function extractJson(text: string): unknown | null {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const m = /\{[\s\S]*\}/.exec(trimmed)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

function isStrongPlan(plan: PlannedCall[]) {
  return plan.some(
    (p) =>
      p.name === 'matches_along_route' ||
      p.name === 'day_route' ||
      p.name === 'can_make_matches',
  )
}

function heuristicPlan(message: string, ctx: ScoutContext): PlannedCall[] {
  const q = message.trim()
  const lower = q.toLowerCase()

  const along =
    /(?:från|start(?:ar)?(?:\s+i)?)\s+([a-zåäöA-ZÅÄÖ\s\-]+?)\s+till\s+([a-zåäöA-ZÅÄÖ\s\-]+?)(?:\s|,|\.|$)/i.exec(
      q,
    ) ||
    /längs\s+vägen.*?(?:från\s+)?([a-zåäöA-ZÅÄÖ\s\-]+?)\s*(?:→|->|till)\s*([a-zåäöA-ZÅÄÖ\s\-]+)/i.exec(
      q,
    )
  if (along || /längs\s+vägen|på\s+vägen\s+till|bilresa/.test(lower)) {
    let fromPlace = along?.[1]?.trim() || 'Uppsala'
    let toPlace = along?.[2]?.trim() || 'Malmö'
    // UI form / short phrasing: "uppsala malmö"
    const bare = /^([a-zåäö\-]+)\s+([a-zåäö\-]+)$/i.exec(q.trim())
    if (!along && bare) {
      fromPlace = bare[1]!
      toPlace = bare[2]!
    }
    const time = /(\d{1,2})[:.](\d{2})/.exec(q)
    const departTime = time
      ? `${String(time[1]).padStart(2, '0')}:${time[2]}`
      : /börjar\s+åka\s+kl\s*(\d{1,2})/i.exec(q)
        ? `${String(/börjar\s+åka\s+kl\s*(\d{1,2})/i.exec(q)![1]).padStart(2, '0')}:00`
        : '08:00'
    return [
      {
        name: 'matches_along_route',
        arguments: {
          fromPlace,
          toPlace,
          departTime,
          day: ctx.from,
        },
      },
    ]
  }

  if (/hinner\s+jag|hinna\s+se|och\s+sedan|därefter/.test(lower) && !/hela\s+dagen/.test(lower)) {
    const teams: string[] = []
    const quoted = [...q.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)
    teams.push(...quoted)
    const se = /se\s+([^,?]+?)(?:,|\s+och\s+|\s+hinner|\s+sedan|$)/gi
    let m: RegExpExecArray | null
    while ((m = se.exec(q))) {
      const part = m[1]!.trim()
      if (part.length > 2 && part.length < 40) teams.push(part)
    }
    const och = /hinner\s+jag\s+(?:då\s+)?se\s+(.+?)\s*\?/i.exec(q)
    if (och) {
      for (const piece of och[1]!.split(/\s+och\s+/i)) {
        if (piece.trim()) teams.push(piece.trim())
      }
    }
    const unique = [...new Set(teams.map((t) => t.replace(/^match\s+/i, '').trim()))].slice(0, 4)
    if (unique.length >= 1) {
      return [{ name: 'can_make_matches', arguments: { teamsOrQueries: unique } }]
    }
  }

  const place =
    /(?:i|från|vid|nära|runt)\s+([A-ZÅÄÖ][a-zåäöA-ZÅÄÖ\-]+(?:\s+[A-ZÅÄÖ][a-zåäöA-ZÅÄÖ\-]+)?)/.exec(
      q,
    )?.[1] || ctx.baseQuery

  // Recommendations / whole day / "matcher i X" → feasible day route, not raw list
  if (
    /hela\s+dagen|dagsrutt|rekommender|hinner|vilka\s+matcher|planera|matcher\s+i\s+|se\s+matcher/.test(
      lower,
    )
  ) {
    return [
      {
        name: 'day_route',
        arguments: place ? { place, watchMinutes: 75, maxKm: 50 } : { watchMinutes: 75 },
      },
    ]
  }

  if (place && /(?:i|nära|runt)\s+/i.test(q)) {
    return [
      {
        name: 'day_route',
        arguments: { place, watchMinutes: 75, maxKm: 50 },
      },
    ]
  }

  const cleaned = q
    .replace(/^(visa|hitta|sök|finns det)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
  if (cleaned.length >= 2) {
    return [{ name: 'search_matches', arguments: { query: cleaned, limit: 12 } }]
  }

  return [{ name: 'day_route', arguments: { watchMinutes: 75 } }]
}

async function planWithAi(
  ai: AiBinding,
  message: string,
  ctx: ScoutContext,
): Promise<PlannedCall[] | null> {
  try {
    const raw = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_PLAN },
        {
          role: 'user',
          content: `Kontext: datum ${ctx.from ?? 'idag'}${ctx.to && ctx.to !== ctx.from ? `–${ctx.to}` : ''}, basort ${ctx.baseQuery ?? 'saknas'}, kön ${ctx.gender ?? 'all'}.\nFråga: ${message}`,
        },
      ],
      max_tokens: 400,
      temperature: 0,
    })
    const text =
      typeof raw === 'string' ? raw : (raw.response ?? raw.result ?? JSON.stringify(raw))
    const parsed = extractJson(text) as {
      tools?: PlannedCall[]
      out_of_scope?: boolean
    } | null
    if (!parsed) return null
    if (parsed.out_of_scope) return []
    if (!Array.isArray(parsed.tools)) return null
    return parsed.tools
      .filter((t) => t && typeof t.name === 'string')
      .map((t) => ({
        name: t.name,
        arguments: t.arguments && typeof t.arguments === 'object' ? t.arguments : {},
      }))
  } catch {
    return null
  }
}

async function answerWithAi(ai: AiBinding, message: string, toolText: string): Promise<string | null> {
  try {
    const raw = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM_ANSWER },
        {
          role: 'user',
          content: `Fråga: ${message}\n\nVERKTYGSRESULTAT:\n${toolText.slice(0, 6000)}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
    })
    const text = typeof raw === 'string' ? raw : (raw.response ?? raw.result ?? '')
    const cleaned = String(text).trim()
    return cleaned || null
  } catch {
    return null
  }
}

function fallbackAnswer(results: ToolResult[]): string {
  if (results.length === 0) {
    return 'Jag kan bara hjälpa till med svenska matcher, dagsrutter och resor utifrån datan på sidan. Prova t.ex. "matcher i Stockholm idag" eller "Uppsala till Malmö från 08:00".'
  }
  return results.map((r) => r.summary).join('\n\n')
}

export async function askScout(
  message: string,
  ctx: ScoutContext,
  ai?: AiBinding | null,
): Promise<AiScoutResponse> {
  const trimmed = message.trim().slice(0, 500)
  if (trimmed.length < 2) {
    return {
      answer: 'Skriv en fråga om matcher, t.ex. vilka du hinner se eller längs en bilresa.',
      matches: [],
      toolsUsed: [],
      mode: 'rules',
    }
  }

  const mode: 'ai' | 'rules' = 'rules'
  const heuristic = heuristicPlan(trimmed, ctx)
  let plan = heuristic
  const strong = isStrongPlan(heuristic)

  // Strong travel/day plans stay on the fast rule path (no LLM plan/polish).
  // AI is only used for vague queries where tools are unclear.
  if (ai && !strong) {
    const aiPlan = await planWithAi(ai, trimmed, ctx)
    if (aiPlan && aiPlan.length > 0) {
      plan = aiPlan
    }
  }

  if (plan.length === 0) {
    return {
      answer:
        'Jag svarar bara på frågor om svenska matcher, scouting och resor utifrån datan på den här sidan.',
      matches: [],
      toolsUsed: [],
      mode,
    }
  }

  const results: ToolResult[] = []
  const toolsUsed: string[] = []
  const matches: ScoutMatch[] = []
  const seen = new Set<number>()

  for (const call of plan.slice(0, 3)) {
    toolsUsed.push(call.name)
    const result = await runScoutTool(call.name, call.arguments, ctx)
    results.push(result)
    for (const m of result.matches) {
      if (seen.has(m.gameId)) continue
      seen.add(m.gameId)
      matches.push(m)
    }
  }

  let answer = fallbackAnswer(results)
  // Optional short polish only for weak/generic searches (saves 1–2s on route questions)
  if (ai && !strong && !isStrongPlan(plan)) {
    const polished = await answerWithAi(ai, trimmed, results.map((r) => r.summary).join('\n\n'))
    if (polished && polished.length < 900) answer = polished
  }

  return {
    answer,
    matches: matches.slice(0, 20),
    toolsUsed,
    mode: ai && !strong ? 'ai' : 'rules',
  }
}

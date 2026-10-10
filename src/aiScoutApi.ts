export type ScoutAskMatch = {
  gameId: number
  date: string
  home: string
  away: string
  competitionName: string
  location: string
  genderName: string
  ageCategoryName: string
  url: string
  lat?: number
  lon?: number
}

export type ScoutAskContext = {
  from?: string
  to?: string
  baseQuery?: string
  baseLat?: number
  baseLon?: number
  gender?: 'all' | 'Man' | 'Kvinna'
  ageCategory?: string
  query?: string
}

export type ScoutAskResult = {
  answer: string
  matches: ScoutAskMatch[]
  toolsUsed: string[]
  mode: 'ai' | 'rules'
}

export async function askScoutApi(
  message: string,
  context: ScoutAskContext,
): Promise<ScoutAskResult> {
  const res = await fetch('/api/scout/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Kunde inte fråga (${res.status})`)
  }
  return res.json() as Promise<ScoutAskResult>
}

export async function alongRouteApi(input: {
  fromPlace: string
  toPlace: string
  departTime?: string
  day?: string
  context?: ScoutAskContext
}): Promise<{ summary: string; matches: ScoutAskMatch[]; ok: boolean }> {
  const res = await fetch('/api/scout/along', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fromPlace: input.fromPlace,
      toPlace: input.toPlace,
      departTime: input.departTime,
      day: input.day,
      context: input.context,
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Kunde inte söka längs vägen (${res.status})`)
  }
  return res.json() as Promise<{ summary: string; matches: ScoutAskMatch[]; ok: boolean }>
}

export const ASK_EXAMPLES = [
  'Jag är i Stockholm och vill se matcher hela dagen – vad rekommenderar du?',
  'Jag ska åka från Uppsala till Malmö, vilka matcher kan jag gå på längs vägen om jag börjar åka kl 08?',
  'Hinner jag se AIK och sedan en ungdomsmatch?',
]

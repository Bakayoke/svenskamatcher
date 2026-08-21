/**
 * API-Football (api-sports.io) free-tier client.
 * Budget: ~100 requests/day — cache aggressively.
 */

export type ApiFootballEnv = {
  API_FOOTBALL_KEY?: string
}

export const ELITE_NAME_RE =
  /\b(allsvenskan|superettan|elitettan|obos damallsvenskan|damallsvenskan)\b/i

type CacheEntry = { expiresAt: number; body: unknown }
const memoryCache = new Map<string, CacheEntry>()

const DAY_MS = 24 * 60 * 60 * 1000
const FIXTURES_TTL = 5 * 60 * 1000
const DETAIL_TTL = 10 * 60 * 1000
const TRANSFERS_TTL = 12 * 60 * 60 * 1000
const LEAGUES_TTL = 7 * DAY_MS

function cacheGet<T>(key: string): T | null {
  const hit = memoryCache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    memoryCache.delete(key)
    return null
  }
  return hit.body as T
}

function cacheSet(key: string, body: unknown, ttlMs: number) {
  memoryCache.set(key, { expiresAt: Date.now() + ttlMs, body })
}

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\b(fk|if|ff|bk|sk|aik|gif|aif|kif|dff|fc|united|fotboll)\b/g, '')
    .replace(/[^a-z0-9åäö]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export type EliteLeague = {
  id: number
  name: string
  season: number
}

export type EnrichedFixture = {
  fixtureId: number
  leagueId: number
  leagueName: string
  status: string
  statusLong: string
  elapsed: number | null
  home: string
  away: string
  homeId: number
  awayId: number
  goalsHome: number | null
  goalsAway: number | null
  kickoff: string
  venue: string | null
}

export type FixtureDetail = {
  fixture: EnrichedFixture
  events: Array<{
    time: number | null
    team: string
    player: string
    assist: string | null
    type: string
    detail: string
  }>
  lineups: Array<{
    team: string
    formation: string | null
    startXI: Array<{ name: string; number: number | null; pos: string | null }>
    substitutes: Array<{ name: string; number: number | null; pos: string | null }>
  }>
  players: Array<{
    team: string
    name: string
    rating: string | null
    goals: number
    assists: number
    minutes: number | null
  }>
}

export type TransferRow = {
  date: string | null
  type: string | null
  from: string | null
  to: string | null
  player: string
}

async function apiGet(
  path: string,
  params: Record<string, string | number>,
  key: string,
): Promise<unknown> {
  const url = new URL(`https://v3.football.api-sports.io${path}`)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v))
  }
  const res = await fetch(url, {
    headers: {
      'x-apisports-key': key,
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw Object.assign(new Error(`API-Football ${res.status}: ${text.slice(0, 180)}`), {
      status: res.status === 429 ? 429 : 502,
    })
  }
  const data = (await res.json()) as {
    errors?: Record<string, string> | string[] | string
    response?: unknown
  }
  const err = data.errors
  if (err && ((typeof err === 'object' && !Array.isArray(err) && Object.keys(err).length > 0) || (Array.isArray(err) && err.length > 0) || (typeof err === 'string' && err))) {
    const message =
      typeof err === 'string'
        ? err
        : Array.isArray(err)
          ? err.join('; ')
          : Object.entries(err)
              .map(([k, v]) => `${k}: ${v}`)
              .join('; ')
    const freeSeason =
      /Free plans do not have access to this season/i.test(message) ||
      /try from 2022 to 2024/i.test(message)
    throw Object.assign(
      new Error(
        freeSeason
          ? 'API-Football gratisplan täcker bara säsong 2022–2024 (inte 2026). Uppgradera planen eller använd SvFF-data tills vidare.'
          : message,
      ),
      { status: freeSeason ? 402 : 502 },
    )
  }
  return data
}

function currentSeason(): number {
  // Swedish leagues run calendar year
  return new Date().getFullYear()
}

export async function getEliteLeagues(key: string): Promise<EliteLeague[]> {
  const cacheKey = `leagues:sweden:${currentSeason()}`
  const cached = cacheGet<EliteLeague[]>(cacheKey)
  if (cached) return cached

  const raw = (await apiGet('/leagues', { country: 'Sweden', current: 'true' }, key)) as {
    response?: Array<{
      league: { id: number; name: string }
      seasons?: Array<{ year: number; current: boolean }>
    }>
  }

  const wanted = [/allsvenskan/i, /superettan/i, /damallsvenskan/i, /elitettan/i]
  const out: EliteLeague[] = []
  for (const row of raw.response ?? []) {
    if (!wanted.some((re) => re.test(row.league.name))) continue
    // Prefer exact top-tier names, skip cups like "Svenska Cupen"
    if (/cup/i.test(row.league.name)) continue
    const season =
      row.seasons?.find((s) => s.current)?.year ??
      row.seasons?.[row.seasons.length - 1]?.year ??
      currentSeason()
    out.push({ id: row.league.id, name: row.league.name, season })
  }

  // Stable fallbacks if discovery fails (API-Sports v3 common IDs)
  if (out.length === 0) {
    const season = currentSeason()
    out.push(
      { id: 113, name: 'Allsvenskan', season },
      { id: 114, name: 'Superettan', season },
    )
  }

  cacheSet(cacheKey, out, LEAGUES_TTL)
  return out
}

function mapFixture(item: {
  fixture: {
    id: number
    date: string
    status: { short: string; long: string; elapsed: number | null }
    venue?: { name: string | null }
  }
  league: { id: number; name: string }
  teams: { home: { id: number; name: string }; away: { id: number; name: string } }
  goals: { home: number | null; away: number | null }
}): EnrichedFixture {
  return {
    fixtureId: item.fixture.id,
    leagueId: item.league.id,
    leagueName: item.league.name,
    status: item.fixture.status.short,
    statusLong: item.fixture.status.long,
    elapsed: item.fixture.status.elapsed,
    home: item.teams.home.name,
    away: item.teams.away.name,
    homeId: item.teams.home.id,
    awayId: item.teams.away.id,
    goalsHome: item.goals.home,
    goalsAway: item.goals.away,
    kickoff: item.fixture.date,
    venue: item.fixture.venue?.name ?? null,
  }
}

export async function getEliteFixturesForDate(
  key: string,
  dateIso: string,
): Promise<EnrichedFixture[]> {
  const day = dateIso.slice(0, 10)
  const cacheKey = `fixtures:${day}`
  const cached = cacheGet<EnrichedFixture[]>(cacheKey)
  if (cached) return cached

  const leagues = await getEliteLeagues(key)
  const all: EnrichedFixture[] = []

  for (const league of leagues) {
    const raw = (await apiGet(
      '/fixtures',
      { league: league.id, season: league.season, date: day },
      key,
    )) as { response?: Parameters<typeof mapFixture>[0][] }
    for (const item of raw.response ?? []) {
      all.push(mapFixture(item))
    }
  }

  cacheSet(cacheKey, all, FIXTURES_TTL)
  return all
}

export async function getEliteFixturesForRange(
  key: string,
  fromIso: string,
  toIso: string,
): Promise<EnrichedFixture[]> {
  const from = new Date(fromIso.slice(0, 10) + 'T12:00:00')
  const to = new Date(toIso.slice(0, 10) + 'T12:00:00')
  const days: string[] = []
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
    if (days.length > 7) break // free-tier guard
  }
  const merged: EnrichedFixture[] = []
  const seen = new Set<number>()
  for (const day of days) {
    const list = await getEliteFixturesForDate(key, day)
    for (const f of list) {
      if (seen.has(f.fixtureId)) continue
      seen.add(f.fixtureId)
      merged.push(f)
    }
  }
  return merged
}

export async function getFixtureDetail(key: string, fixtureId: number): Promise<FixtureDetail> {
  const cacheKey = `fixture:${fixtureId}`
  const cached = cacheGet<FixtureDetail>(cacheKey)
  if (cached) return cached

  const raw = (await apiGet('/fixtures', { id: fixtureId }, key)) as {
    response?: Array<{
      fixture: Parameters<typeof mapFixture>[0]['fixture']
      league: Parameters<typeof mapFixture>[0]['league']
      teams: Parameters<typeof mapFixture>[0]['teams']
      goals: Parameters<typeof mapFixture>[0]['goals']
      events?: Array<{
        time: { elapsed: number | null }
        team: { name: string }
        player: { name: string | null }
        assist: { name: string | null }
        type: string
        detail: string
      }>
      lineups?: Array<{
        team: { name: string }
        formation: string | null
        startXI: Array<{ player: { name: string; number: number | null; pos: string | null } }>
        substitutes: Array<{ player: { name: string; number: number | null; pos: string | null } }>
      }>
      players?: Array<{
        team: { name: string }
        players: Array<{
          player: { name: string }
          statistics: Array<{
            games: { minutes: number | null; rating: string | null }
            goals: { total: number | null; assists: number | null }
          }>
        }>
      }>
    }>
  }

  const item = raw.response?.[0]
  if (!item) {
    throw Object.assign(new Error('Fixture hittades inte'), { status: 404 })
  }

  const detail: FixtureDetail = {
    fixture: mapFixture(item),
    events: (item.events ?? []).map((e) => ({
      time: e.time.elapsed,
      team: e.team.name,
      player: e.player.name ?? '',
      assist: e.assist.name,
      type: e.type,
      detail: e.detail,
    })),
    lineups: (item.lineups ?? []).map((l) => ({
      team: l.team.name,
      formation: l.formation,
      startXI: l.startXI.map((p) => ({
        name: p.player.name,
        number: p.player.number,
        pos: p.player.pos,
      })),
      substitutes: l.substitutes.map((p) => ({
        name: p.player.name,
        number: p.player.number,
        pos: p.player.pos,
      })),
    })),
    players: (item.players ?? []).flatMap((block) =>
      block.players.map((p) => {
        const stats = p.statistics?.[0]
        return {
          team: block.team.name,
          name: p.player.name,
          rating: stats?.games.rating ?? null,
          goals: stats?.goals.total ?? 0,
          assists: stats?.goals.assists ?? 0,
          minutes: stats?.games.minutes ?? null,
        }
      }),
    ),
  }

  cacheSet(cacheKey, detail, DETAIL_TTL)
  return detail
}

export async function getTeamTransfers(key: string, teamId: number): Promise<TransferRow[]> {
  const cacheKey = `transfers:${teamId}`
  const cached = cacheGet<TransferRow[]>(cacheKey)
  if (cached) return cached

  const raw = (await apiGet('/transfers', { team: teamId }, key)) as {
    response?: Array<{
      player: { name: string }
      transfers: Array<{
        date: string | null
        type: string | null
        teams: { in: { name: string | null }; out: { name: string | null } }
      }>
    }>
  }

  const rows: TransferRow[] = []
  for (const block of raw.response ?? []) {
    for (const t of block.transfers ?? []) {
      rows.push({
        date: t.date,
        type: t.type,
        from: t.teams.out.name,
        to: t.teams.in.name,
        player: block.player.name,
      })
    }
  }

  rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const recent = rows.slice(0, 25)
  cacheSet(cacheKey, recent, TRANSFERS_TTL)
  return recent
}

export function matchEnrichmentKey(home: string, away: string): string {
  return `${normalizeTeamName(home)}|${normalizeTeamName(away)}`
}

export function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a)
  const nb = normalizeTeamName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  // token overlap
  const ta = new Set(na.split(' '))
  const tb = nb.split(' ')
  const overlap = tb.filter((t) => t.length > 2 && ta.has(t)).length
  return overlap >= 1 && (overlap >= 2 || Math.min(ta.size, tb.length) <= 2)
}

export function findMatchingFixture(
  home: string,
  away: string,
  fixtures: EnrichedFixture[],
): EnrichedFixture | null {
  for (const f of fixtures) {
    if (namesLikelyMatch(home, f.home) && namesLikelyMatch(away, f.away)) return f
  }
  return null
}

export function isEliteCompetitionName(name: string): boolean {
  return ELITE_NAME_RE.test(name)
}

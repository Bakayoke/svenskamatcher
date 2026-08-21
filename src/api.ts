import type { MatchesPayload } from './types'

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

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string; hint?: string } | null
  return body?.error ?? `Fel ${res.status}`
}

export async function fetchMatches(from: string, to: string): Promise<MatchesPayload> {
  const params = new URLSearchParams({ from, to })
  const res = await fetch(`/api/matches?${params}`)
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<MatchesPayload>
}

export async function fetchEnrich(
  from: string,
  to: string,
): Promise<{ fixtures: EnrichedFixture[]; configured: boolean; error?: string }> {
  const params = new URLSearchParams({ from, to })
  const res = await fetch(`/api/enrich?${params}`)
  const body = (await res.json().catch(() => null)) as {
    fixtures?: EnrichedFixture[]
    configured?: boolean
    error?: string
  } | null
  if (res.status === 503) {
    return { fixtures: [], configured: false, error: body?.error }
  }
  if (!res.ok) {
    return { fixtures: [], configured: true, error: body?.error ?? `Fel ${res.status}` }
  }
  return {
    fixtures: body?.fixtures ?? [],
    configured: body?.configured ?? true,
  }
}

export async function fetchFixtureDetail(fixtureId: number): Promise<FixtureDetail> {
  const res = await fetch(`/api/fixture/${fixtureId}`)
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<FixtureDetail>
}

export async function fetchTeamTransfers(teamId: number): Promise<TransferRow[]> {
  const res = await fetch(`/api/team/${teamId}/transfers`)
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { transfers: TransferRow[] }
  return body.transfers
}

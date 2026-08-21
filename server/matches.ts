import { eachDayOfInterval, format, isAfter } from 'date-fns'

export const ASSOCIATION_ID = 1
export const MAX_RANGE_DAYS = 14
export const CACHE_TTL_MS = 5 * 60 * 1000

type CacheEntry = { expiresAt: number; body: unknown }

const cache = new Map<string, CacheEntry>()

export type Team = {
  teamImageUrl: string
  teamImageAlt: string
  name: string
}

export type Game = {
  gameId: number
  homeTeam: Team
  awayTeam: Team
  score: { home: number; away: number }
  date: string
  dateFormatted: string
  location: string
  referees: unknown[]
  note: string
  status: number
  url: string
  homeTeamClubAssociationId: number
  awayTeamClubAssociationId: number
}

export type Competition = {
  competitionId: number
  name: string
  genderId: number
  genderName: string
  ageCategoryId: number
  ageCategoryName: string
  games: Game[]
}

export type MatchesResponse = {
  associationId: number
  date: string
  competitions: Competition[]
}

function cacheKey(dateIso: string) {
  return `${ASSOCIATION_ID}:${dateIso.slice(0, 10)}`
}

function getCached(dateIso: string) {
  const key = cacheKey(dateIso)
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expiresAt) {
    cache.delete(key)
    return null
  }
  return hit.body
}

function setCached(dateIso: string, body: unknown) {
  cache.set(cacheKey(dateIso), { expiresAt: Date.now() + CACHE_TTL_MS, body })
}

export function parseDateParam(value: string | undefined, fallback: Date) {
  if (!value) return fallback
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) {
    throw new Error(`Ogiltigt datum: ${value}`)
  }
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(year, month, day, 12, 0, 0, 0)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Ogiltigt datum: ${value}`)
  }
  return parsed
}

async function fetchDay(date: Date) {
  const dateParam = date.toISOString()
  const cached = getCached(dateParam)
  if (cached) return cached as MatchesResponse

  const url = new URL('https://www.svenskfotboll.se/api/matches-today/games/')
  url.searchParams.set('associationId', String(ASSOCIATION_ID))
  url.searchParams.set('date', dateParam)

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (compatible; SvenskaMatcher/1.0; +https://github.com/svenskamatcher)',
      Referer: 'https://www.svenskfotboll.se/',
      Origin: 'https://www.svenskfotboll.se',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`)
  }

  const body = (await res.json()) as MatchesResponse
  setCached(dateParam, body)
  return body
}

function mergeResponses(responses: MatchesResponse[]): MatchesResponse {
  const byCompetition = new Map<number, Competition>()

  for (const response of responses) {
    for (const competition of response.competitions ?? []) {
      const existing = byCompetition.get(competition.competitionId)
      if (!existing) {
        byCompetition.set(competition.competitionId, {
          ...competition,
          games: [...competition.games],
        })
        continue
      }

      const seen = new Set(existing.games.map((g) => g.gameId))
      for (const game of competition.games) {
        if (!seen.has(game.gameId)) {
          existing.games.push(game)
          seen.add(game.gameId)
        }
      }
    }
  }

  const competitions = [...byCompetition.values()].map((c) => ({
    ...c,
    games: c.games.sort((a, b) => a.date.localeCompare(b.date)),
  }))

  competitions.sort((a, b) => a.name.localeCompare(b.name, 'sv'))

  return {
    associationId: ASSOCIATION_ID,
    date: responses[0]?.date ?? new Date().toISOString(),
    competitions,
  }
}

export async function getMatches(fromInput?: string, toInput?: string) {
  const today = new Date()
  const from = parseDateParam(fromInput, today)
  const to = parseDateParam(toInput ?? fromInput, from)

  if (isAfter(from, to)) {
    throw Object.assign(new Error('from måste vara före eller samma som to'), {
      status: 400,
    })
  }

  const days = eachDayOfInterval({ start: from, end: to })
  if (days.length > MAX_RANGE_DAYS) {
    throw Object.assign(
      new Error(`Max ${MAX_RANGE_DAYS} dagar i ett intervall. Välj ett kortare spann.`),
      { status: 400 },
    )
  }

  const responses: MatchesResponse[] = []
  for (const day of days) {
    const noon = new Date(
      Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), 12, 0, 0),
    )
    responses.push(await fetchDay(noon))
    if (days.length > 1) {
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  const merged = mergeResponses(responses)
  return {
    ...merged,
    meta: {
      from: format(from, 'yyyy-MM-dd'),
      to: format(to, 'yyyy-MM-dd'),
      days: days.length,
      source: 'svenskfotboll.se',
      cachedTtlSeconds: CACHE_TTL_MS / 1000,
      maxRangeDays: MAX_RANGE_DAYS,
    },
  }
}

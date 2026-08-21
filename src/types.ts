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

export type MatchesPayload = {
  associationId: number
  date: string
  competitions: Competition[]
  meta?: {
    from: string
    to: string
    days: number
    source: string
    cachedTtlSeconds: number
    maxRangeDays: number
  }
}

/** Observed status values from svenskfotboll.se – incomplete mapping */
export function statusLabel(status: number): string {
  switch (status) {
    case 0:
      return 'Inställd'
    case 1:
      return 'Avslutad'
    case 2:
      return 'Pågår'
    case 3:
      return 'Halvtid'
    case 4:
      return 'Uppskjuten'
    case 5:
      return 'Kommande'
    default:
      return `Status ${status}`
  }
}

export function matchUrl(path: string): string {
  if (path.startsWith('http')) return path
  return `https://www.svenskfotboll.se${path}`
}

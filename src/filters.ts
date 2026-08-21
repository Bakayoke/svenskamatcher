import type { Competition, Game } from './types'

export type Filters = {
  gender: 'all' | 'Man' | 'Kvinna'
  ageCategory: 'all' | string
  competitions: Set<number>
  query: string
  districtId: 'all' | number
}

export const emptyFilters = (): Filters => ({
  gender: 'all',
  ageCategory: 'all',
  competitions: new Set(),
  query: '',
  districtId: 'all',
})

export function filterCompetitions(
  competitions: Competition[],
  filters: Filters,
): Competition[] {
  const q = filters.query.trim().toLowerCase()

  return competitions
    .filter((c) => {
      if (filters.gender !== 'all' && c.genderName !== filters.gender) return false
      if (filters.ageCategory !== 'all' && c.ageCategoryName !== filters.ageCategory) {
        return false
      }
      if (filters.competitions.size > 0 && !filters.competitions.has(c.competitionId)) {
        return false
      }
      return true
    })
    .map((c) => {
      let games = c.games
      if (filters.districtId !== 'all') {
        games = games.filter(
          (g) =>
            g.homeTeamClubAssociationId === filters.districtId ||
            g.awayTeamClubAssociationId === filters.districtId,
        )
      }
      if (q) {
        const competitionHit = c.name.toLowerCase().includes(q)
        games = competitionHit
          ? games
          : games.filter(
              (g) =>
                g.homeTeam.name.toLowerCase().includes(q) ||
                g.awayTeam.name.toLowerCase().includes(q) ||
                g.location.toLowerCase().includes(q),
            )
      }
      return { ...c, games }
    })
    .filter((c) => c.games.length > 0)
}

export function countGames(competitions: Competition[]): number {
  return competitions.reduce((n, c) => n + c.games.length, 0)
}

export function uniqueAgeCategories(competitions: Competition[]): string[] {
  return [...new Set(competitions.map((c) => c.ageCategoryName))].sort((a, b) =>
    a.localeCompare(b, 'sv'),
  )
}

export function uniqueGenders(competitions: Competition[]): string[] {
  return [...new Set(competitions.map((c) => c.genderName))].sort((a, b) =>
    a.localeCompare(b, 'sv'),
  )
}

export type FlatGame = Game & {
  competitionId: number
  competitionName: string
  genderName: string
  ageCategoryName: string
}

export function flattenGames(competitions: Competition[]): FlatGame[] {
  return competitions.flatMap((c) =>
    c.games.map((g) => ({
      ...g,
      competitionId: c.competitionId,
      competitionName: c.name,
      genderName: c.genderName,
      ageCategoryName: c.ageCategoryName,
    })),
  )
}

import type { FlatGame } from './filters'
import { districtName } from './districts'
import { parseKickoff } from './time'

export type MatchCluster = {
  id: string
  kind: 'district' | 'venue'
  label: string
  day: string
  dayLabel: string
  games: FlatGame[]
}

function dayKey(dateStr: string) {
  return dateStr.slice(0, 10)
}

function dayLabel(dateStr: string) {
  return parseKickoff(dateStr).toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function venueKey(location: string) {
  return location.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Clusters of 2+ matches same calendar day by district or venue. */
export function buildClusters(games: FlatGame[], minSize = 2): MatchCluster[] {
  const byDistrict = new Map<string, FlatGame[]>()
  const byVenue = new Map<string, FlatGame[]>()

  for (const g of games) {
    const day = dayKey(g.date)
    const distId = g.homeTeamClubAssociationId
    const dKey = `${day}|d|${distId}`
    const dList = byDistrict.get(dKey) ?? []
    dList.push(g)
    byDistrict.set(dKey, dList)

    const loc = g.location?.trim()
    if (loc) {
      const vKey = `${day}|v|${venueKey(loc)}`
      const vList = byVenue.get(vKey) ?? []
      vList.push(g)
      byVenue.set(vKey, vList)
    }
  }

  const out: MatchCluster[] = []

  for (const [id, list] of byDistrict) {
    if (list.length < minSize) continue
    const day = id.split('|')[0]
    out.push({
      id,
      kind: 'district',
      label: districtName(list[0].homeTeamClubAssociationId),
      day,
      dayLabel: dayLabel(list[0].date),
      games: list.slice().sort((a, b) => a.date.localeCompare(b.date)),
    })
  }

  for (const [id, list] of byVenue) {
    if (list.length < minSize) continue
    const day = id.split('|')[0]
    out.push({
      id,
      kind: 'venue',
      label: list[0].location.trim(),
      day,
      dayLabel: dayLabel(list[0].date),
      games: list.slice().sort((a, b) => a.date.localeCompare(b.date)),
    })
  }

  // Prefer denser clusters; venues before districts when equal (more actionable)
  return out.sort((a, b) => {
    if (b.games.length !== a.games.length) return b.games.length - a.games.length
    if (a.kind !== b.kind) return a.kind === 'venue' ? -1 : 1
    return a.day.localeCompare(b.day) || a.label.localeCompare(b.label, 'sv')
  })
}

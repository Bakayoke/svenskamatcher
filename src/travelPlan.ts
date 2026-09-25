import type { ShortlistedMatch, BasePlace } from './agentStore'
import { haversineKm, formatKm } from './places'
import { parseKickoff } from './time'

export type TravelStop = {
  match: ShortlistedMatch
  gapMinutes: number | null
  kmFromPrev: number | null
  conflict: boolean
}

export function buildTravelPlan(
  items: ShortlistedMatch[],
  coordsByLocation?: Record<string, { lat: number; lon: number }>,
): TravelStop[] {
  const sorted = items.slice().sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map((match, i) => {
    const prev = sorted[i - 1]
    let gapMinutes: number | null = null
    let conflict = false
    if (prev) {
      const gap =
        (parseKickoff(match.date).getTime() - parseKickoff(prev.date).getTime()) / 60000
      gapMinutes = Math.round(gap)
      conflict = Math.abs(gap) < 120
    }
    let kmFromPrev: number | null = null
    if (prev && coordsByLocation) {
      const a = coordsByLocation[prev.location.trim().toLowerCase()]
      const b = coordsByLocation[match.location.trim().toLowerCase()]
      if (a && b) kmFromPrev = haversineKm(a, b)
    }
    return { match, gapMinutes, kmFromPrev, conflict }
  })
}

export function travelPlanSummary(stops: TravelStop[], base: BasePlace | null) {
  const conflicts = stops.filter((s) => s.conflict).length
  const parts = [`${stops.length} matcher`]
  if (conflicts) parts.push(`${conflicts} tidskonflikter`)
  if (base) parts.push(`bas: ${base.query}`)
  return parts.join(' · ')
}

export { formatKm }

import type { ShortlistedMatch, BasePlace } from './agentStore'
import { estimateDriveMinutes, formatDrive } from './dayOptimizer'
import { haversineKm, formatKm } from './places'
import { parseKickoff } from './time'

export type TravelStop = {
  match: ShortlistedMatch
  gapMinutes: number | null
  kmFromPrev: number | null
  driveMinutes: number | null
  conflict: boolean
  lat?: number
  lon?: number
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
    let driveMinutes: number | null = null
    const geo = coordsByLocation?.[match.location.trim().toLowerCase()]
    if (prev && coordsByLocation) {
      const a = coordsByLocation[prev.location.trim().toLowerCase()]
      const b = geo
      if (a && b) {
        kmFromPrev = haversineKm(a, b)
        driveMinutes = estimateDriveMinutes(kmFromPrev)
        if (gapMinutes != null && driveMinutes + 75 > gapMinutes) conflict = true
      }
    }
    return {
      match,
      gapMinutes,
      kmFromPrev,
      driveMinutes,
      conflict,
      lat: geo?.lat,
      lon: geo?.lon,
    }
  })
}

export function travelPlanSummary(stops: TravelStop[], base: BasePlace | null) {
  const conflicts = stops.filter((s) => s.conflict).length
  const km = stops.reduce((s, x) => s + (x.kmFromPrev ?? 0), 0)
  const drive = stops.reduce((s, x) => s + (x.driveMinutes ?? 0), 0)
  const parts = [`${stops.length} matcher`]
  if (km > 0) parts.push(`${formatKm(km)} · ${formatDrive(drive)}`)
  if (conflicts) parts.push(`${conflicts} tidskonflikter`)
  if (base) parts.push(`bas: ${base.query}`)
  return parts.join(' · ')
}

export { formatKm, formatDrive }

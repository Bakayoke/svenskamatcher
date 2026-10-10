import type { BasePlace } from './agentStore'
import type { FlatGame } from './filters'
import { haversineKm } from './places'
import { parseKickoff } from './time'

export type DayRouteOptions = {
  /** Minutes you stay after kickoff before leaving. */
  watchMinutes: number
  /** Arrive this many minutes before kickoff. */
  arriveBufferMinutes: number
  /** Assumed average road speed. */
  speedKmh: number
  /** Multiply straight-line distance (roads are longer). */
  roadFactor: number
  /** Optional hard cap between stops. */
  maxLegKm?: number
}

export const DEFAULT_DAY_ROUTE: DayRouteOptions = {
  watchMinutes: 75,
  arriveBufferMinutes: 15,
  speedKmh: 55,
  roadFactor: 1.35,
  maxLegKm: 80,
}

export type RouteStop = {
  game: FlatGame
  lat: number
  lon: number
  /** Drive from previous stop (or base). */
  kmFromPrev: number
  driveMinutesFromPrev: number
  /** Leave previous / base at this local time (ms). */
  departAt: number
  /** Arrive at venue (ms). */
  arriveAt: number
  /** Leave this venue (ms). */
  leaveAt: number
  slackMinutes: number
}

export type DayRouteResult = {
  stops: RouteStop[]
  totalKm: number
  totalDriveMinutes: number
  skipped: number
  unmapped: number
}

export function estimateDriveMinutes(
  km: number,
  opts: Pick<DayRouteOptions, 'speedKmh' | 'roadFactor'> = DEFAULT_DAY_ROUTE,
): number {
  if (km <= 0.05) return 0
  return Math.max(1, Math.ceil(((km * opts.roadFactor) / opts.speedKmh) * 60))
}

export function formatDrive(minutes: number): string {
  if (minutes < 60) return `${minutes} min bil`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h bil` : `${h} h ${m} min bil`
}

type Cand = {
  game: FlatGame
  lat: number
  lon: number
  kickoff: number
}

/**
 * Pick the longest feasible scout route in kickoff order for one day.
 * DP: maximize matches, then minimize total drive km.
 * If games span several days, the richest single calendar day wins.
 */
export function optimizeDayRoute(
  games: FlatGame[],
  coordsByGameId: Map<number, { lat: number; lon: number }>,
  base: BasePlace | null,
  opts: DayRouteOptions = DEFAULT_DAY_ROUTE,
): DayRouteResult {
  let unmapped = 0
  const byDay = new Map<string, FlatGame[]>()
  for (const game of games) {
    if (!coordsByGameId.has(game.gameId)) {
      unmapped++
      continue
    }
    const day = game.date.slice(0, 10)
    const list = byDay.get(day) ?? []
    list.push(game)
    byDay.set(day, list)
  }

  if (byDay.size === 0) {
    return { stops: [], totalKm: 0, totalDriveMinutes: 0, skipped: 0, unmapped }
  }

  let best: DayRouteResult | null = null
  for (const dayGames of byDay.values()) {
    const result = optimizeSingleDay(dayGames, coordsByGameId, base, opts, 0)
    if (
      !best ||
      result.stops.length > best.stops.length ||
      (result.stops.length === best.stops.length && result.totalKm < best.totalKm)
    ) {
      best = result
    }
  }

  return {
    ...(best ?? { stops: [], totalKm: 0, totalDriveMinutes: 0, skipped: 0, unmapped: 0 }),
    unmapped,
  }
}

function optimizeSingleDay(
  games: FlatGame[],
  coordsByGameId: Map<number, { lat: number; lon: number }>,
  base: BasePlace | null,
  opts: DayRouteOptions,
  unmapped: number,
): DayRouteResult {
  const cands: Cand[] = []
  for (const game of games) {
    const c = coordsByGameId.get(game.gameId)
    if (!c) continue
    cands.push({
      game,
      lat: c.lat,
      lon: c.lon,
      kickoff: parseKickoff(game.date).getTime(),
    })
  }
  cands.sort((a, b) => a.kickoff - b.kickoff || a.game.gameId - b.game.gameId)

  if (cands.length === 0) {
    return { stops: [], totalKm: 0, totalDriveMinutes: 0, skipped: 0, unmapped }
  }

  type Node = {
    prev: number
    count: number
    totalKm: number
    kmFromPrev: number
    driveMinutesFromPrev: number
    departAt: number
    arriveAt: number
    leaveAt: number
    slackMinutes: number
  }

  const n = cands.length
  const best: Node[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const cur = cands[i]!
    const fromBase = base
      ? haversineKm(base, cur)
      : 0
    const driveFromBase = base ? estimateDriveMinutes(fromBase, opts) : 0
    const arriveNeeded = cur.kickoff - opts.arriveBufferMinutes * 60000
    const departBase = arriveNeeded - driveFromBase * 60000
    const arriveAt = departBase + driveFromBase * 60000
    const leaveAt = cur.kickoff + opts.watchMinutes * 60000
    const slack = Math.round((arriveNeeded - arriveAt) / 60000)
    const baseOk =
      (!base || fromBase <= (opts.maxLegKm ?? Infinity)) && slack >= 0

    best[i] = baseOk
      ? {
          prev: -1,
          count: 1,
          totalKm: fromBase,
          kmFromPrev: fromBase,
          driveMinutesFromPrev: driveFromBase,
          departAt: departBase,
          arriveAt,
          leaveAt,
          slackMinutes: slack,
        }
      : {
          prev: -1,
          count: 0,
          totalKm: Infinity,
          kmFromPrev: fromBase,
          driveMinutesFromPrev: driveFromBase,
          departAt: departBase,
          arriveAt,
          leaveAt,
          slackMinutes: slack,
        }

    for (let j = 0; j < i; j++) {
      const prevNode = best[j]!
      if (prevNode.count === 0) continue
      const prev = cands[j]!
      const km = haversineKm(prev, cur)
      if (opts.maxLegKm != null && km > opts.maxLegKm) continue
      const driveMin = estimateDriveMinutes(km, opts)
      const departAt = prevNode.leaveAt
      const arriveAtJ = departAt + driveMin * 60000
      const need = cur.kickoff - opts.arriveBufferMinutes * 60000
      if (arriveAtJ > need) continue
      const leaveAtJ = cur.kickoff + opts.watchMinutes * 60000
      const count = prevNode.count + 1
      const totalKm = prevNode.totalKm + km
      const better =
        count > best[i]!.count ||
        (count === best[i]!.count && totalKm < best[i]!.totalKm)
      if (!better) continue
      best[i] = {
        prev: j,
        count,
        totalKm,
        kmFromPrev: km,
        driveMinutesFromPrev: driveMin,
        departAt,
        arriveAt: arriveAtJ,
        leaveAt: leaveAtJ,
        slackMinutes: Math.round((need - arriveAtJ) / 60000),
      }
    }
  }

  let end = -1
  for (let i = 0; i < n; i++) {
    const node = best[i]!
    if (node.count === 0) continue
    if (
      end < 0 ||
      node.count > best[end]!.count ||
      (node.count === best[end]!.count && node.totalKm < best[end]!.totalKm)
    ) {
      end = i
    }
  }

  if (end < 0) {
    return {
      stops: [],
      totalKm: 0,
      totalDriveMinutes: 0,
      skipped: cands.length,
      unmapped,
    }
  }

  const chain: number[] = []
  for (let i = end; i >= 0; i = best[i]!.prev) {
    chain.push(i)
    if (best[i]!.prev < 0) break
  }
  chain.reverse()

  const stops: RouteStop[] = chain.map((i) => {
    const c = cands[i]!
    const node = best[i]!
    return {
      game: c.game,
      lat: c.lat,
      lon: c.lon,
      kmFromPrev: node.kmFromPrev,
      driveMinutesFromPrev: node.driveMinutesFromPrev,
      departAt: node.departAt,
      arriveAt: node.arriveAt,
      leaveAt: node.leaveAt,
      slackMinutes: node.slackMinutes,
    }
  })

  const totalKm = stops.reduce((s, x) => s + x.kmFromPrev, 0)
  const totalDriveMinutes = stops.reduce((s, x) => s + x.driveMinutesFromPrev, 0)

  return {
    stops,
    totalKm,
    totalDriveMinutes,
    skipped: cands.length - stops.length,
    unmapped,
  }
}

/** Check shortlist feasibility in time order (same rules as day route). */
export function shortlistFeasibility(
  items: Array<{
    gameId: number
    date: string
    location: string
    home: string
    away: string
  }>,
  coordsByLocation: Record<string, { lat: number; lon: number }>,
  base: BasePlace | null,
  opts: DayRouteOptions = DEFAULT_DAY_ROUTE,
): Array<{
  gameId: number
  ok: boolean
  kmFromPrev: number | null
  driveMinutesFromPrev: number | null
  slackMinutes: number | null
  reason?: string
}> {
  const sorted = items.slice().sort((a, b) => a.date.localeCompare(b.date))
  let prev: { lat: number; lon: number; leaveAt: number } | null = null
  const out: Array<{
    gameId: number
    ok: boolean
    kmFromPrev: number | null
    driveMinutesFromPrev: number | null
    slackMinutes: number | null
    reason?: string
  }> = []

  for (const item of sorted) {
    const key = item.location.trim().toLowerCase()
    const geo = coordsByLocation[key]
    const kickoff = parseKickoff(item.date).getTime()
    if (!geo) {
      out.push({
        gameId: item.gameId,
        ok: false,
        kmFromPrev: null,
        driveMinutesFromPrev: null,
        slackMinutes: null,
        reason: 'Saknar plats på kartan',
      })
      continue
    }

    const need = kickoff - opts.arriveBufferMinutes * 60000

    if (!prev) {
      if (!base) {
        out.push({
          gameId: item.gameId,
          ok: true,
          kmFromPrev: null,
          driveMinutesFromPrev: null,
          slackMinutes: null,
        })
      } else {
        const km = haversineKm(base, geo)
        const driveMin = estimateDriveMinutes(km, opts)
        const ok = km <= (opts.maxLegKm ?? Infinity)
        out.push({
          gameId: item.gameId,
          ok,
          kmFromPrev: km,
          driveMinutesFromPrev: driveMin,
          slackMinutes: null,
          reason: ok ? undefined : 'För lång sträcka från bas',
        })
      }
      prev = { ...geo, leaveAt: kickoff + opts.watchMinutes * 60000 }
      continue
    }

    const km = haversineKm(prev, geo)
    const driveMin = estimateDriveMinutes(km, opts)
    const actualArrive = prev.leaveAt + driveMin * 60000
    const slack = Math.round((need - actualArrive) / 60000)
    const ok = slack >= 0 && km <= (opts.maxLegKm ?? Infinity)

    out.push({
      gameId: item.gameId,
      ok,
      kmFromPrev: km,
      driveMinutesFromPrev: driveMin,
      slackMinutes: slack,
      reason: ok
        ? undefined
        : slack < 0
          ? `För kort tid (−${Math.abs(slack)} min)`
          : 'För lång sträcka',
    })
    prev = { ...geo, leaveAt: kickoff + opts.watchMinutes * 60000 }
  }

  return out
}

export function clockFromMs(ms: number): string {
  const d = new Date(ms)
  return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

import { geocodePlace, type GeoPoint } from './places.ts'
import { getMatches, type Competition } from './matches.ts'
import {
  clockFromMs,
  distanceToSegmentKm,
  estimateDriveMinutes,
  formatDrive,
  formatKm,
  haversineKm,
  localDateTime,
  parseKickoff,
  type LatLon,
} from './geoMath.ts'

export type ScoutMatch = {
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

export type ScoutContext = {
  from?: string
  to?: string
  baseQuery?: string
  baseLat?: number
  baseLon?: number
  gender?: 'all' | 'Man' | 'Kvinna'
  ageCategory?: string
  query?: string
}

const MAX_GEOCODE = 60
const DEFAULT_WATCH = 75
const ARRIVE_BUFFER = 15
const CORRIDOR_KM = 55
/** How long you may wait at a stop after earliest arrival before kickoff. */
const MAX_WAIT_AFTER_ETA_H = 12

/** Towns roughly along common SE corridors (E4/E6) – used to prioritize geocoding. */
const CORRIDOR_TOWNS = [
  'uppsala',
  'märsta',
  'stockholm',
  'solna',
  'sollentuna',
  'södertälje',
  'nyköping',
  'norrköping',
  'linköping',
  'mjölby',
  'tranås',
  'järrfälla',
  'järfälla',
  'eskilstuna',
  'västerås',
  'örebro',
  'nässjö',
  'jönköping',
  'värnamo',
  'växjö',
  'ljungby',
  'hässleholm',
  'kristianstad',
  'helsingborg',
  'lund',
  'malmö',
  'landskrona',
  'trelleborg',
  'kalmar',
  'växjö',
  'alvesta',
  'höör',
  'ängelholm',
]

function isoToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function flatten(competitions: Competition[]): ScoutMatch[] {
  const out: ScoutMatch[] = []
  for (const c of competitions) {
    for (const g of c.games ?? []) {
      out.push({
        gameId: g.gameId,
        date: g.date,
        home: g.homeTeam.name.trim(),
        away: g.awayTeam.name.trim(),
        competitionName: c.name,
        location: g.location?.trim() ?? '',
        genderName: c.genderName,
        ageCategoryName: c.ageCategoryName,
        url: g.url,
      })
    }
  }
  return out
}

function filterMatches(games: ScoutMatch[], ctx: ScoutContext): ScoutMatch[] {
  return games.filter((g) => {
    if (ctx.gender && ctx.gender !== 'all' && g.genderName !== ctx.gender) return false
    if (ctx.ageCategory && ctx.ageCategory !== 'all' && g.ageCategoryName !== ctx.ageCategory)
      return false
    if (ctx.query?.trim()) {
      const q = ctx.query.trim().toLowerCase()
      const hay = `${g.home} ${g.away} ${g.competitionName} ${g.location}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

async function loadGames(ctx: ScoutContext): Promise<ScoutMatch[]> {
  const from = ctx.from ?? isoToday()
  const to = ctx.to ?? from
  const payload = await getMatches(from, to)
  return filterMatches(flatten(payload.competitions ?? []), ctx)
}

function prioritizeLocations(locations: string[], hints: string[] = []): string[] {
  const unique = [...new Set(locations.map((l) => l.trim()).filter(Boolean))]
  const hintSet = hints.map((h) => h.toLowerCase()).filter(Boolean)
  const score = (loc: string) => {
    const l = loc.toLowerCase()
    let s = 0
    for (const h of hintSet) {
      if (h.length >= 3 && l.includes(h)) s += 10
    }
    for (const t of CORRIDOR_TOWNS) {
      if (l.includes(t)) s += 3
    }
    return s
  }
  return unique.sort((a, b) => score(b) - score(a) || a.localeCompare(b, 'sv'))
}

async function geocodeMany(
  locations: string[],
  limit = MAX_GEOCODE,
  hints: string[] = [],
): Promise<Record<string, GeoPoint>> {
  const out: Record<string, GeoPoint> = {}
  const ordered = prioritizeLocations(locations, hints).slice(0, limit)
  for (const loc of ordered) {
    try {
      const point = await geocodePlace(loc)
      if (point) out[loc.toLowerCase()] = point
    } catch {
      // skip
    }
  }
  return out
}

function attachCoords(
  games: ScoutMatch[],
  geo: Record<string, GeoPoint>,
): Array<ScoutMatch & LatLon> {
  const out: Array<ScoutMatch & LatLon> = []
  for (const g of games) {
    const p = geo[g.location.toLowerCase()]
    if (!p) continue
    out.push({ ...g, lat: p.lat, lon: p.lon })
  }
  return out
}

function summarizeMatch(g: ScoutMatch, extra?: string) {
  const t = g.date.slice(11, 16)
  const day = g.date.slice(0, 10)
  return `${day} ${t} · ${g.home} – ${g.away} · ${g.location}${extra ? ` · ${extra}` : ''} · ${g.competitionName}`
}

/** DP day route among geocoded games (one calendar day at a time). */
export function optimizeDayRouteServer(
  games: Array<ScoutMatch & LatLon>,
  base: LatLon | null,
  watchMinutes = DEFAULT_WATCH,
): {
  stops: Array<ScoutMatch & LatLon & { kmFromPrev: number; driveMinutes: number; arriveAt: string }>
  totalKm: number
  totalDriveMinutes: number
  skipped: number
} {
  const byDay = new Map<string, Array<ScoutMatch & LatLon>>()
  for (const g of games) {
    const day = g.date.slice(0, 10)
    const list = byDay.get(day) ?? []
    list.push(g)
    byDay.set(day, list)
  }

  let best: ReturnType<typeof optimizeOneDay> | null = null
  for (const dayGames of byDay.values()) {
    const r = optimizeOneDay(dayGames, base, watchMinutes)
    if (
      !best ||
      r.stops.length > best.stops.length ||
      (r.stops.length === best.stops.length && r.totalKm < best.totalKm)
    ) {
      best = r
    }
  }
  return best ?? { stops: [], totalKm: 0, totalDriveMinutes: 0, skipped: 0 }
}

function optimizeOneDay(
  games: Array<ScoutMatch & LatLon>,
  base: LatLon | null,
  watchMinutes: number,
) {
  type Cand = ScoutMatch & LatLon & { kickoff: number }
  const cands: Cand[] = games
    .map((g) => ({ ...g, kickoff: parseKickoff(g.date).getTime() }))
    .sort((a, b) => a.kickoff - b.kickoff)

  type Node = {
    prev: number
    count: number
    totalKm: number
    kmFromPrev: number
    driveMinutes: number
    arriveAt: number
    leaveAt: number
  }

  const n = cands.length
  const best: Node[] = new Array(n)

  for (let i = 0; i < n; i++) {
    const cur = cands[i]!
    const fromBase = base ? haversineKm(base, cur) : 0
    const driveFromBase = base ? estimateDriveMinutes(fromBase) : 0
    const need = cur.kickoff - ARRIVE_BUFFER * 60000
    const leaveAt = cur.kickoff + watchMinutes * 60000
    // Must be able to leave base early enough (assume awake from 07:00 local that day).
    const dayStart = new Date(cur.kickoff)
    dayStart.setHours(7, 0, 0, 0)
    const arriveFromBase = dayStart.getTime() + driveFromBase * 60000
    const baseOk =
      !base ||
      (fromBase <= 90 && arriveFromBase <= need)

    best[i] = baseOk
      ? {
          prev: -1,
          count: 1,
          totalKm: fromBase,
          kmFromPrev: fromBase,
          driveMinutes: driveFromBase,
          arriveAt: base ? arriveFromBase : need,
          leaveAt,
        }
      : {
          prev: -1,
          count: 0,
          totalKm: Infinity,
          kmFromPrev: fromBase,
          driveMinutes: driveFromBase,
          arriveAt: arriveFromBase,
          leaveAt,
        }

    for (let j = 0; j < i; j++) {
      const prevNode = best[j]!
      if (prevNode.count === 0) continue
      const prev = cands[j]!
      const km = haversineKm(prev, cur)
      if (km > 80) continue
      const driveMin = estimateDriveMinutes(km)
      const arriveAtJ = prevNode.leaveAt + driveMin * 60000
      // Require at least a small buffer: next kickoff must be after leave + drive + arrive buffer
      if (arriveAtJ > need) continue
      // Reject “back-to-back”: need ≥ 20 min spare after arriving before kickoff
      const slack = (need - arriveAtJ) / 60000
      if (slack < 5) continue
      const count = prevNode.count + 1
      const totalKm = prevNode.totalKm + km
      if (count > best[i]!.count || (count === best[i]!.count && totalKm < best[i]!.totalKm)) {
        best[i] = {
          prev: j,
          count,
          totalKm,
          kmFromPrev: km,
          driveMinutes: driveMin,
          arriveAt: arriveAtJ,
          leaveAt: cur.kickoff + watchMinutes * 60000,
        }
      }
    }
  }

  let end = -1
  for (let i = 0; i < n; i++) {
    if (best[i]!.count === 0) continue
    if (
      end < 0 ||
      best[i]!.count > best[end]!.count ||
      (best[i]!.count === best[end]!.count && best[i]!.totalKm < best[end]!.totalKm)
    ) {
      end = i
    }
  }

  if (end < 0) return { stops: [], totalKm: 0, totalDriveMinutes: 0, skipped: cands.length }

  const chain: number[] = []
  for (let i = end; i >= 0; i = best[i]!.prev) {
    chain.push(i)
    if (best[i]!.prev < 0) break
  }
  chain.reverse()

  const stops = chain.map((i) => {
    const c = cands[i]!
    const node = best[i]!
    return {
      ...c,
      kmFromPrev: node.kmFromPrev,
      driveMinutes: node.driveMinutes,
      arriveAt: clockFromMs(node.arriveAt),
    }
  })

  return {
    stops,
    totalKm: stops.reduce((s, x) => s + x.kmFromPrev, 0),
    totalDriveMinutes: stops.reduce((s, x) => s + x.driveMinutes, 0),
    skipped: cands.length - stops.length,
  }
}

export type ToolResult = {
  ok: boolean
  summary: string
  matches: ScoutMatch[]
  meta?: Record<string, unknown>
}

async function resolveBase(ctx: ScoutContext, place?: string): Promise<(LatLon & { label: string }) | null> {
  if (place?.trim()) {
    const p = await geocodePlace(place.trim())
    if (p) return { lat: p.lat, lon: p.lon, label: p.label }
  }
  if (ctx.baseLat != null && ctx.baseLon != null) {
    return {
      lat: ctx.baseLat,
      lon: ctx.baseLon,
      label: ctx.baseQuery ?? 'basort',
    }
  }
  if (ctx.baseQuery?.trim()) {
    const p = await geocodePlace(ctx.baseQuery.trim())
    if (p) return { lat: p.lat, lon: p.lon, label: p.label }
  }
  return null
}

export async function toolSearchMatches(
  ctx: ScoutContext,
  args: { query?: string; near?: string; maxKm?: number; limit?: number },
): Promise<ToolResult> {
  const games = await loadGames({ ...ctx, query: args.query ?? ctx.query })
  const near = args.near?.trim()
  if (near) {
    const center = await geocodePlace(near)
    if (!center) {
      return { ok: false, summary: `Kunde inte hitta orten "${near}".`, matches: [] }
    }
    const maxKm = args.maxKm ?? 40
    const geo = await geocodeMany(games.map((g) => g.location))
    const ranked = attachCoords(games, geo)
      .map((g) => ({ g, km: haversineKm(center, g) }))
      .filter((x) => x.km <= maxKm)
      .sort((a, b) => a.km - b.km || a.g.date.localeCompare(b.g.date))
      .slice(0, args.limit ?? 12)

    return {
      ok: true,
      summary:
        ranked.length === 0
          ? `Inga geokodade matcher inom ${maxKm} km från ${center.label}.`
          : `Matcher nära ${center.label} (lista – inte tidskontrollerad dagsrutt; använd day_route för vad du hinner):\n${ranked.map((x) => summarizeMatch(x.g, formatKm(x.km))).join('\n')}`,
      matches: ranked.map((x) => x.g),
      meta: { near: center.label, maxKm, feasibleOnly: false },
    }
  }

  const limited = games.slice(0, args.limit ?? 15)
  return {
    ok: true,
    summary:
      limited.length === 0
        ? 'Inga matcher matchade sökningen i valt datum/filter.'
        : `Hittade ${games.length} matcher (visar ${limited.length}):\n${limited.map((g) => summarizeMatch(g)).join('\n')}`,
    matches: limited,
  }
}

export async function toolDayRoute(
  ctx: ScoutContext,
  args: { place?: string; watchMinutes?: number; maxKm?: number },
): Promise<ToolResult> {
  const watch = args.watchMinutes ?? DEFAULT_WATCH
  const maxKm = args.maxKm ?? 50
  const base = await resolveBase(ctx, args.place)
  const games = await loadGames(ctx)
  const hints = [args.place ?? '', ctx.baseQuery ?? '', base?.label ?? '']
  const geo = await geocodeMany(
    games.map((g) => g.location),
    MAX_GEOCODE,
    hints,
  )
  let mapped = attachCoords(games, geo)
  if (base) {
    mapped = mapped.filter((g) => haversineKm(base, g) <= maxKm)
  }
  const route = optimizeDayRouteServer(mapped, base, watch)
  if (route.stops.length === 0) {
    return {
      ok: true,
      summary: base
        ? `Ingen genomförbar dagsrutt inom ${maxKm} km från ${base.label} (med ${watch} min på varje match, bilbuffert mellan dem). ${mapped.length} kartlagda kandidater.`
        : `Ingen genomförbar dagsrutt (ange basort/ort). ${mapped.length} matcher hade karta.`,
      matches: [],
      meta: { unmapped: games.length - mapped.length, candidates: mapped.length, watchMinutes: watch },
    }
  }
  const lines = route.stops.map(
    (s, i) =>
      `${i + 1}. ${summarizeMatch(s, `ankomst ca ${s.arriveAt} · ${formatKm(s.kmFromPrev)} · ${formatDrive(s.driveMinutes)}`)}`,
  )
  return {
    ok: true,
    summary: `Genomförbar dagsrutt – du hinner dessa med ${watch} min på varje plan och restid emellan (${route.stops.length} matcher · ${formatKm(route.totalKm)} · ${formatDrive(route.totalDriveMinutes)}${base ? ` från ${base.label}` : ''}):\n${lines.join('\n')}\nÖvriga ${route.skipped} kartlagda matcher i området krockar tidsmässigt.`,
    matches: route.stops.map((s) => ({
      gameId: s.gameId,
      date: s.date,
      home: s.home,
      away: s.away,
      competitionName: s.competitionName,
      location: s.location,
      genderName: s.genderName,
      ageCategoryName: s.ageCategoryName,
      url: s.url,
      lat: s.lat,
      lon: s.lon,
    })),
    meta: {
      totalKm: route.totalKm,
      totalDriveMinutes: route.totalDriveMinutes,
      skipped: route.skipped,
      base: base?.label,
      watchMinutes: watch,
      feasibleOnly: true,
    },
  }
}

export async function toolCanMake(
  ctx: ScoutContext,
  args: { teamsOrQueries: string[]; place?: string; watchMinutes?: number },
): Promise<ToolResult> {
  const queries = args.teamsOrQueries.map((q) => q.trim().toLowerCase()).filter(Boolean)
  if (queries.length < 1) {
    return { ok: false, summary: 'Ange minst en match/lag att kolla.', matches: [] }
  }
  const games = await loadGames(ctx)
  const picked: ScoutMatch[] = []
  for (const q of queries) {
    const hit = games.find((g) => {
      const hay = `${g.home} ${g.away} ${g.competitionName} ${g.location}`.toLowerCase()
      return hay.includes(q)
    })
    if (hit && !picked.some((p) => p.gameId === hit.gameId)) picked.push(hit)
  }
  if (picked.length === 0) {
    return {
      ok: false,
      summary: `Hittade inga matcher för: ${args.teamsOrQueries.join(', ')}.`,
      matches: [],
    }
  }

  const base = await resolveBase(ctx, args.place)
  const geo = await geocodeMany(picked.map((g) => g.location))
  const mapped = attachCoords(picked, geo)
  if (mapped.length < picked.length) {
    return {
      ok: true,
      summary: `Hittade matcher men saknar karta för vissa platser. Geokodade ${mapped.length}/${picked.length}.`,
      matches: picked,
    }
  }

  const watch = args.watchMinutes ?? DEFAULT_WATCH
  const sorted = mapped.slice().sort((a, b) => a.date.localeCompare(b.date))
  const issues: string[] = []
  let prev: (ScoutMatch & LatLon & { leaveAt: number }) | null = null

  for (const g of sorted) {
    const kickoff = parseKickoff(g.date).getTime()
    if (!prev) {
      if (base) {
        const km = haversineKm(base, g)
        const drive = estimateDriveMinutes(km)
        issues.push(
          `${g.home}–${g.away}: ${formatKm(km)} / ${formatDrive(drive)} från ${base.label}`,
        )
      }
      prev = { ...g, leaveAt: kickoff + watch * 60000 }
      continue
    }
    const km = haversineKm(prev, g)
    const drive = estimateDriveMinutes(km)
    const arrive = prev.leaveAt + drive * 60000
    const need = kickoff - ARRIVE_BUFFER * 60000
    const slack = Math.round((need - arrive) / 60000)
    if (slack < 0) {
      issues.push(
        `HINNER INTE: ${prev.home}–${prev.away} → ${g.home}–${g.away} (${formatKm(km)}, ${formatDrive(drive)}, saknas ${Math.abs(slack)} min)`,
      )
    } else {
      issues.push(
        `OK: ${prev.home}–${prev.away} → ${g.home}–${g.away} (${formatKm(km)}, ${formatDrive(drive)}, ${slack} min marginal)`,
      )
    }
    prev = { ...g, leaveAt: kickoff + watch * 60000 }
  }

  const ok = !issues.some((l) => l.startsWith('HINNER INTE'))
  return {
    ok: true,
    summary: `${ok ? 'Ja, det går tidsmässigt' : 'Nej, tiderna krockar'} (antaget ${watch} min på plats):\n${issues.join('\n')}`,
    matches: sorted,
    meta: { feasible: ok },
  }
}

export async function toolAlongRoute(
  ctx: ScoutContext,
  args: {
    fromPlace: string
    toPlace: string
    departTime?: string
    day?: string
    corridorKm?: number
    watchMinutes?: number
  },
): Promise<ToolResult> {
  const fromP = await geocodePlace(args.fromPlace)
  const toP = await geocodePlace(args.toPlace)
  if (!fromP || !toP) {
    return {
      ok: false,
      summary: `Kunde inte geokoda ${!fromP ? args.fromPlace : args.toPlace}.`,
      matches: [],
    }
  }

  const day = args.day ?? ctx.from ?? isoToday()
  // Long southbound trips: include next calendar day for evening matches near destination
  const dayEnd = new Date(`${day}T12:00:00`)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const toDay = `${dayEnd.getFullYear()}-${String(dayEnd.getMonth() + 1).padStart(2, '0')}-${String(dayEnd.getDate()).padStart(2, '0')}`
  const games = await loadGames({ ...ctx, from: day, to: toDay })
  const hints = [args.fromPlace, args.toPlace, fromP.label, toP.label, ...CORRIDOR_TOWNS]
  const geo = await geocodeMany(
    games.map((g) => g.location),
    MAX_GEOCODE,
    hints,
  )
  const mapped = attachCoords(games, geo)
  const corridorKm = args.corridorKm ?? CORRIDOR_KM
  const depart = localDateTime(day, args.departTime ?? '08:00').getTime()
  const totalKm = haversineKm(fromP, toP)
  const totalDrive = estimateDriveMinutes(totalKm)
  const maxWait = MAX_WAIT_AFTER_ETA_H * 60
  const watch = args.watchMinutes ?? DEFAULT_WATCH

  type Hit = ScoutMatch &
    LatLon & {
      corridorKm: number
      kmAlong: number
      etaMs: number
      slackMinutes: number
    }

  const hits: Hit[] = []
  for (const g of mapped) {
    const seg = distanceToSegmentKm(g, fromP, toP)
    const nearStart = haversineKm(fromP, g) <= corridorKm
    const nearEnd = haversineKm(toP, g) <= corridorKm
    const onCorridor = seg.km <= corridorKm && seg.t >= -0.02 && seg.t <= 1.02
    if (!onCorridor && !nearStart && !nearEnd) continue

    const t = onCorridor ? Math.max(0, Math.min(1, seg.t)) : nearStart ? 0 : 1
    const kmAlong = t * totalKm
    const etaMs = depart + estimateDriveMinutes(kmAlong) * 60000
    const kickoff = parseKickoff(g.date).getTime()
    const need = kickoff - ARRIVE_BUFFER * 60000
    const slack = Math.round((need - etaMs) / 60000)
    if (slack < 0) continue
    if (slack > maxWait) continue
    hits.push({
      ...g,
      corridorKm: onCorridor ? seg.km : nearStart ? haversineKm(fromP, g) : haversineKm(toP, g),
      kmAlong,
      etaMs,
      slackMinutes: slack,
    })
  }

  hits.sort((a, b) => a.kmAlong - b.kmAlong || a.date.localeCompare(b.date))

  // Feasible chain progressing along the route (not just any day route)
  const chain = optimizeAlongRoute(hits, watch)

  const useHits =
    chain.length > 0
      ? chain.map((h) => ({
          match: h as ScoutMatch & LatLon,
          eta: clockFromMs(h.etaMs),
          side: `${formatKm(h.corridorKm)} från vägen · passerar ca ${clockFromMs(h.etaMs)}`,
        }))
      : hits.slice(0, 15).map((h) => ({
          match: h as ScoutMatch & LatLon,
          eta: clockFromMs(h.etaMs),
          side: `${formatKm(h.corridorKm)} från vägen · tidigast framme ca ${clockFromMs(h.etaMs)}`,
        }))

  const lines = useHits.map(
    (row, i) => `${i + 1}. ${summarizeMatch(row.match, `ETA ca ${row.eta} · ${row.side}`)}`,
  )

  const modeNote =
    chain.length > 0
      ? `Genomförbar kedja (${watch} min/match):`
      : hits.length > 0
        ? `Alternativ längs vägen (var för sig – tiderna krockar om du försöker alla):`
        : ''

  return {
    ok: true,
    summary:
      useHits.length === 0
        ? `Inga matcher längs ${fromP.label} → ${toP.label} (${day}, start ${args.departTime ?? '08:00'}, korridor ${corridorKm} km, ${mapped.length} kartlagda av ${games.length}). Totalsträcka ca ${formatKm(totalKm)} / ${formatDrive(totalDrive)}. Prova annat datum eller bredare urval.`
        : `${modeNote} ${fromP.label} → ${toP.label} (${day}, start ${args.departTime ?? '08:00'}, ca ${formatKm(totalKm)}):\n${lines.join('\n')}`,
    matches: useHits.map((row) => ({
      gameId: row.match.gameId,
      date: row.match.date,
      home: row.match.home,
      away: row.match.away,
      competitionName: row.match.competitionName,
      location: row.match.location,
      genderName: row.match.genderName,
      ageCategoryName: row.match.ageCategoryName,
      url: row.match.url,
      lat: row.match.lat,
      lon: row.match.lon,
    })),
    meta: {
      from: fromP.label,
      to: toP.label,
      day,
      departTime: args.departTime ?? '08:00',
      totalKm,
      totalDriveMinutes: totalDrive,
      corridorKm,
      chained: chain.length > 0,
      candidates: hits.length,
      mapped: mapped.length,
      watchMinutes: watch,
    },
  }
}

/** Greedy feasible picks ordered by progress along the drive. */
function optimizeAlongRoute(
  hits: Array<
    ScoutMatch &
      LatLon & {
        corridorKm: number
        kmAlong: number
        etaMs: number
        slackMinutes: number
      }
  >,
  watchMinutes: number,
) {
  const sorted = hits.slice().sort((a, b) => a.kmAlong - b.kmAlong || a.date.localeCompare(b.date))
  const picked: typeof hits = []
  let leaveAt = 0
  let last: (typeof hits)[number] | null = null

  for (const h of sorted) {
    const kickoff = parseKickoff(h.date).getTime()
    const need = kickoff - ARRIVE_BUFFER * 60000
    if (!last) {
      if (h.etaMs > need) continue
      picked.push(h)
      leaveAt = kickoff + watchMinutes * 60000
      last = h
      continue
    }
    // Must move further along the route (or same area) and be reachable after previous watch
    if (h.kmAlong + 5 < last.kmAlong) continue
    const legKm = haversineKm(last, h)
    const drive = estimateDriveMinutes(legKm)
    const arrive = Math.max(leaveAt + drive * 60000, h.etaMs)
    if (arrive > need) continue
    if ((need - arrive) / 60000 < 5) continue
    picked.push(h)
    leaveAt = kickoff + watchMinutes * 60000
    last = h
  }
  return picked
}

export const TOOL_DEFINITIONS = [
  {
    name: 'search_matches',
    description:
      'Sök svenska fotbollsmatcher i sidans data efter lag, ort, liga eller fritext. Använd near för att begränsa till avstånd från en ort.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Fritext: lagnamn, ort, liga' },
        near: { type: 'string', description: 'Ort att söka nära, t.ex. Stockholm' },
        maxKm: { type: 'number', description: 'Max avstånd i km från near (default 40)' },
        limit: { type: 'number', description: 'Max antal resultat' },
      },
    },
  },
  {
    name: 'day_route',
    description:
      'Bygg GENOMFÖRBAR dagsrutt: endast matcher man tidsmässigt hinner se samma dag från en ort (restid + tid på plats). Använd detta för rekommendationer – inte search_matches.',
    parameters: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'Basort om annan än användarens sparade' },
        watchMinutes: { type: 'number', description: 'Minuter på plats per match (default 75)' },
        maxKm: { type: 'number', description: 'Max avstånd från basort (default 50)' },
      },
    },
  },
  {
    name: 'can_make_matches',
    description:
      'Kolla om man hinner se flera namngivna matcher/lag samma resa (tid + bil mellan arenor).',
    parameters: {
      type: 'object',
      properties: {
        teamsOrQueries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lag- eller matchfragment, t.ex. ["AIK", "Hammarby U17"]',
        },
        place: { type: 'string' },
        watchMinutes: { type: 'number' },
      },
      required: ['teamsOrQueries'],
    },
  },
  {
    name: 'matches_along_route',
    description:
      'Hitta matcher längs en bilresa mellan två orter, givet avresetid. Perfekt för Uppsala→Malmö osv.',
    parameters: {
      type: 'object',
      properties: {
        fromPlace: { type: 'string', description: 'Startort' },
        toPlace: { type: 'string', description: 'Målord' },
        departTime: { type: 'string', description: 'Avresa HH:mm, t.ex. 08:00' },
        day: { type: 'string', description: 'Datum YYYY-MM-DD' },
        corridorKm: { type: 'number', description: 'Max km från fågelvägen (default 35)' },
        watchMinutes: { type: 'number' },
      },
      required: ['fromPlace', 'toPlace'],
    },
  },
] as const

export async function runScoutTool(
  name: string,
  rawArgs: Record<string, unknown>,
  ctx: ScoutContext,
): Promise<ToolResult> {
  switch (name) {
    case 'search_matches':
      return toolSearchMatches(ctx, {
        query: typeof rawArgs.query === 'string' ? rawArgs.query : undefined,
        near: typeof rawArgs.near === 'string' ? rawArgs.near : undefined,
        maxKm: typeof rawArgs.maxKm === 'number' ? rawArgs.maxKm : undefined,
        limit: typeof rawArgs.limit === 'number' ? rawArgs.limit : undefined,
      })
    case 'day_route':
      return toolDayRoute(ctx, {
        place: typeof rawArgs.place === 'string' ? rawArgs.place : undefined,
        watchMinutes: typeof rawArgs.watchMinutes === 'number' ? rawArgs.watchMinutes : undefined,
        maxKm: typeof rawArgs.maxKm === 'number' ? rawArgs.maxKm : undefined,
      })
    case 'can_make_matches':
      return toolCanMake(ctx, {
        teamsOrQueries: Array.isArray(rawArgs.teamsOrQueries)
          ? rawArgs.teamsOrQueries.map(String)
          : typeof rawArgs.teamsOrQueries === 'string'
            ? [rawArgs.teamsOrQueries]
            : [],
        place: typeof rawArgs.place === 'string' ? rawArgs.place : undefined,
        watchMinutes: typeof rawArgs.watchMinutes === 'number' ? rawArgs.watchMinutes : undefined,
      })
    case 'matches_along_route':
      return toolAlongRoute(ctx, {
        fromPlace: String(rawArgs.fromPlace ?? ''),
        toPlace: String(rawArgs.toPlace ?? ''),
        departTime: typeof rawArgs.departTime === 'string' ? rawArgs.departTime : undefined,
        day: typeof rawArgs.day === 'string' ? rawArgs.day : undefined,
        corridorKm: typeof rawArgs.corridorKm === 'number' ? rawArgs.corridorKm : undefined,
        watchMinutes: typeof rawArgs.watchMinutes === 'number' ? rawArgs.watchMinutes : undefined,
      })
    default:
      return { ok: false, summary: `Okänt verktyg: ${name}`, matches: [] }
  }
}

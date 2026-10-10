import { geocodePlace, geocodePlacesMany, type GeoPoint } from './places.ts'
import { getMatches, type Competition } from './matches.ts'
import { SE_CITIES, lookupSwedishPlace } from './seCities.ts'
import {
  clockFromMs,
  distanceToSegmentKm,
  estimateDriveMinutes,
  estimateHighwayMinutes,
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

const MAX_GEOCODE = 40
const DEFAULT_WATCH = 75
const ARRIVE_BUFFER = 15
const CORRIDOR_KM = 110
/** How long you may wait at a stop after earliest arrival before kickoff. */
const MAX_WAIT_AFTER_ETA_H = 14

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
    if (lookupSwedishPlace(l)) s += 5
    return s
  }
  return unique.sort((a, b) => score(b) - score(a) || a.localeCompare(b, 'sv'))
}

async function geocodeMany(
  locations: string[],
  limit = MAX_GEOCODE,
  hints: string[] = [],
): Promise<Record<string, GeoPoint>> {
  const ordered = prioritizeLocations(locations, hints).slice(0, limit)
  return geocodePlacesMany(ordered, limit)
}

/** Towns whose centers lie near the drive segment, ordered along the route. */
function townsAlongDrive(from: LatLon, to: LatLon, corridorKm: number): Array<{ name: string; t: number }> {
  const out: Array<{ name: string; t: number }> = []
  for (const [name, city] of Object.entries(SE_CITIES)) {
    const seg = distanceToSegmentKm(city, from, to)
    if (seg.km > corridorKm) continue
    out.push({ name, t: seg.t })
  }
  out.sort((a, b) => a.t - b.t)
  // unique labels preferring first occurrence
  const seen = new Set<string>()
  return out.filter((x) => {
    if (seen.has(x.name)) return false
    seen.add(x.name)
    return true
  })
}

function attachCoords(
  games: ScoutMatch[],
  geo: Record<string, GeoPoint>,
): Array<ScoutMatch & LatLon> {
  const out: Array<ScoutMatch & LatLon> = []
  for (const g of games) {
    const p = geo[g.location.toLowerCase()]
    if (p) {
      out.push({ ...g, lat: p.lat, lon: p.lon })
      continue
    }
    // Instant approx from city name in venue string (covers south without Nominatim queue)
    const approx = lookupSwedishPlace(g.location)
    if (approx) out.push({ ...g, lat: approx.lat, lon: approx.lon })
  }
  return out
}

/** Stratify venue strings so mid/south corridor towns get geocode slots, not only Stockholm. */
function locationsStratifiedAlongRoute(
  games: ScoutMatch[],
  alongTowns: Array<{ name: string; t: number }>,
  limit: number,
): string[] {
  const buckets = 6
  const byBucket: string[][] = Array.from({ length: buckets }, () => [])
  const unmatched: string[] = []

  for (const g of games) {
    const loc = g.location.trim()
    if (!loc) continue
    const lower = loc.toLowerCase()
    const town = alongTowns.find((t) => t.name.length >= 4 && lower.includes(t.name))
    if (town) {
      const b = Math.min(buckets - 1, Math.floor(Math.max(0, Math.min(1, town.t)) * buckets))
      byBucket[b]!.push(loc)
    } else {
      unmatched.push(loc)
    }
  }

  const out: string[] = []
  const seen = new Set<string>()
  const take = (list: string[]) => {
    for (const loc of list) {
      if (out.length >= limit) return
      const key = loc.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(loc)
    }
  }

  // Round-robin across route buckets first (north → south)
  for (let round = 0; round < 8 && out.length < limit; round++) {
    for (let b = 0; b < buckets && out.length < limit; b++) {
      const loc = byBucket[b]![round]
      if (loc) take([loc])
    }
  }
  take(unmatched)
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
  const corridorKm = args.corridorKm ?? CORRIDOR_KM
  // Long trips: include next calendar day for evening matches near destination
  const dayEnd = new Date(`${day}T12:00:00`)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const toDay = `${dayEnd.getFullYear()}-${String(dayEnd.getMonth() + 1).padStart(2, '0')}-${String(dayEnd.getDate()).padStart(2, '0')}`
  const games = await loadGames({ ...ctx, from: day, to: toDay })

  const alongTowns = townsAlongDrive(fromP, toP, corridorKm)
  const townHints = alongTowns.map((t) => t.name)
  // Geocode a stratified sample (north→south). City-name approx covers the rest instantly.
  const toGeocode = locationsStratifiedAlongRoute(games, alongTowns, MAX_GEOCODE)
  const geo = await geocodeMany(toGeocode, MAX_GEOCODE, [
    args.fromPlace,
    args.toPlace,
    ...townHints,
  ])
  // Attach coords for ALL games (static city approx + geocode hits) so south is not dropped
  const mapped = attachCoords(games, geo)
  const depart = localDateTime(day, args.departTime ?? '08:00').getTime()
  const totalKm = haversineKm(fromP, toP)
  const totalDrive = estimateHighwayMinutes(totalKm)
  // Longer drives: allow waiting for evening kickoffs after you arrive mid-afternoon
  const maxWait =
    totalKm > 250 ? Math.max(MAX_WAIT_AFTER_ETA_H, 16) * 60 : MAX_WAIT_AFTER_ETA_H * 60
  const watch = args.watchMinutes ?? DEFAULT_WATCH

  type Hit = ScoutMatch &
    LatLon & {
      corridorKm: number
      kmAlong: number
      etaMs: number
      slackMinutes: number
      progress: number
    }

  const hits: Hit[] = []
  for (const g of mapped) {
    const seg = distanceToSegmentKm(g, fromP, toP)
    const nearStart = haversineKm(fromP, g) <= Math.min(45, corridorKm)
    const nearEnd = haversineKm(toP, g) <= Math.min(50, corridorKm)
    const onCorridor = seg.km <= corridorKm && seg.t >= -0.02 && seg.t <= 1.02
    if (!onCorridor && !nearStart && !nearEnd) continue

    const t = onCorridor ? Math.max(0, Math.min(1, seg.t)) : nearStart ? 0 : 1
    const kmAlong = t * totalKm
    // Highway ETA so Linköping→Malmö stays reachable from an early start
    const etaMs = depart + estimateHighwayMinutes(kmAlong) * 60000
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
      progress: t,
    })
  }

  hits.sort((a, b) => a.kmAlong - b.kmAlong || a.date.localeCompare(b.date))

  // Alternatives first: many reachable stops to choose from (not a "do all" itinerary)
  const useHits = pickAlongAlternatives(hits, totalKm, 16)
  const chain = optimizeAlongRoute(hits, watch, totalKm)

  const lines = useHits.map(
    (h, i) =>
      `${i + 1}. ${summarizeMatch(h, `~${Math.round(h.progress * 100)}% av vägen · tidigast framme ca ${clockFromMs(h.etaMs)} · ${formatKm(h.corridorKm)} från vägen`)}`,
  )

  let summary =
    useHits.length === 0
      ? `Inga matcher längs ${fromP.label} → ${toP.label} (${day}, start ${args.departTime ?? '08:00'}, korridor ${corridorKm} km, ${mapped.length} kartlagda av ${games.length}). Totalsträcka ca ${formatKm(totalKm)} / ${formatDrive(totalDrive)}. Orter längs vägen: ${townHints.slice(0, 12).join(', ') || '—'}.`
      : `Matcher du kan hinna till längs ${fromP.label} → ${toP.label} (${day}, start ${args.departTime ?? '08:00'}, ca ${formatKm(totalKm)}, korridor ${corridorKm} km).\nDetta är alternativ – du hinner inte alla; välj en eller några att stanna för:\n${lines.join('\n')}`

  if (useHits.length > 0 && chain.length >= 2) {
    summary += `\n\nExempel på kombination som går ihop tidsmässigt (${watch} min/match): ${chain
      .map((h) => `${h.home}–${h.away} (${h.date.slice(11, 16)})`)
      .join(' → ')}.`
  }

  return {
    ok: true,
    summary,
    matches: useHits.map((g) => ({
      gameId: g.gameId,
      date: g.date,
      home: g.home,
      away: g.away,
      competitionName: g.competitionName,
      location: g.location,
      genderName: g.genderName,
      ageCategoryName: g.ageCategoryName,
      url: g.url,
      lat: g.lat,
      lon: g.lon,
    })),
    meta: {
      from: fromP.label,
      to: toP.label,
      day,
      departTime: args.departTime ?? '08:00',
      totalKm,
      totalDriveMinutes: totalDrive,
      corridorKm,
      chained: false,
      exampleChain: chain.map((h) => h.gameId),
      candidates: hits.length,
      mapped: mapped.length,
      watchMinutes: watch,
      towns: townHints.slice(0, 20),
      alternatives: true,
    },
  }
}

type AlongHit = ScoutMatch &
  LatLon & {
    corridorKm: number
    kmAlong: number
    etaMs: number
    slackMinutes: number
    progress: number
  }

/**
 * Menu of reachable stops along the drive for the user to choose from.
 * Spreads across route segments, then fills with remaining candidates.
 */
function pickAlongAlternatives(hits: AlongHit[], totalKm: number, limit: number): AlongHit[] {
  if (hits.length === 0 || totalKm <= 0) return []
  const buckets = 6
  const byBucket: AlongHit[][] = Array.from({ length: buckets }, () => [])
  for (const h of hits) {
    const b = Math.min(buckets - 1, Math.floor(h.progress * buckets))
    byBucket[b]!.push(h)
  }
  // Prefer earlier kickoff within each bucket (more flexible stop)
  for (const list of byBucket) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.corridorKm - b.corridorKm)
  }

  const picked: AlongHit[] = []
  const seen = new Set<number>()
  // Guarantee southern buckets get slots even if the north is dense
  const perBucketCap = 4

  for (let round = 0; round < perBucketCap && picked.length < limit; round++) {
    // South-biased order on later rounds: 5,4,3,2,1,0 then normal
    const order =
      round === 0
        ? [0, 1, 2, 3, 4, 5]
        : round === 1
          ? [5, 4, 3, 2, 1, 0]
          : [2, 3, 4, 5, 1, 0]
    for (const b of order) {
      if (picked.length >= limit) break
      const next = byBucket[b]!.find((h) => !seen.has(h.gameId))
      if (!next) continue
      seen.add(next.gameId)
      picked.push(next)
    }
  }

  if (picked.length < limit) {
    for (const h of hits) {
      if (picked.length >= limit) break
      if (seen.has(h.gameId)) continue
      seen.add(h.gameId)
      picked.push(h)
    }
  }

  return picked.sort((a, b) => a.kmAlong - b.kmAlong || a.date.localeCompare(b.date))
}

/** Greedy feasible picks that must advance along the drive. */
function optimizeAlongRoute(hits: AlongHit[], watchMinutes: number, totalKm: number) {
  const sorted = hits.slice().sort((a, b) => a.kmAlong - b.kmAlong || a.date.localeCompare(b.date))
  const picked: AlongHit[] = []
  let leaveAt = 0
  let last: AlongHit | null = null
  const minAdvanceKm = Math.max(25, totalKm * 0.12)

  for (const h of sorted) {
    const kickoff = parseKickoff(h.date).getTime()
    const need = kickoff - ARRIVE_BUFFER * 60000
    if (!last) {
      if (h.etaMs > need) continue
      // Prefer not starting with a stop that is barely past origin if later options exist
      picked.push(h)
      leaveAt = kickoff + watchMinutes * 60000
      last = h
      continue
    }
    if (h.kmAlong < last.kmAlong + minAdvanceKm) continue
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
      'Lista alternativa matcher längs en bilresa (användaren väljer vilka att stanna för – inte en do-all-rutt).',
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

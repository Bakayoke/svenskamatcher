export type LatLon = { lat: number; lon: number }

export function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function estimateDriveMinutes(
  km: number,
  speedKmh = 55,
  roadFactor = 1.35,
): number {
  if (km <= 0.05) return 0
  return Math.max(1, Math.ceil(((km * roadFactor) / speedKmh) * 60))
}

/** Longer E4/E6-style legs – used for along-route ETA so south stays reachable. */
export function estimateHighwayMinutes(km: number): number {
  return estimateDriveMinutes(km, 90, 1.2)
}

/** Distance from point to segment AB, and progress along AB (0–1, may be outside). */
export function distanceToSegmentKm(
  p: LatLon,
  a: LatLon,
  b: LatLon,
): { km: number; t: number; nearest: LatLon } {
  const ax = a.lon
  const ay = a.lat
  const bx = b.lon
  const by = b.lat
  const px = p.lon
  const py = p.lat
  const abx = bx - ax
  const aby = by - ay
  const ab2 = abx * abx + aby * aby
  let t = 0
  if (ab2 > 0) {
    t = ((px - ax) * abx + (py - ay) * aby) / ab2
  }
  const clamped = Math.max(0, Math.min(1, t))
  const nearest = { lon: ax + abx * clamped, lat: ay + aby * clamped }
  return { km: haversineKm(p, nearest), t: clamped, nearest }
}

export function formatKm(km: number): string {
  if (!Number.isFinite(km)) return ''
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

export function formatDrive(minutes: number): string {
  if (minutes < 60) return `${minutes} min bil`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h bil` : `${h} h ${m} min bil`
}

/** Parse kickoff like `2026-08-21T19:00:00` as local wall clock. */
export function parseKickoff(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(dateStr)
  if (!m) return new Date(dateStr)
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  )
}

export function clockFromMs(ms: number): string {
  return new Date(ms).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

/** Combine YYYY-MM-DD + HH:mm into local Date. */
export function localDateTime(dayIso: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const [y, mo, d] = dayIso.split('-').map(Number)
  return new Date(y!, (mo ?? 1) - 1, d ?? 1, h ?? 0, m ?? 0, 0, 0)
}

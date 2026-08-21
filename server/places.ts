/** Geocode (Nominatim) + weather (Open-Meteo). Shared by Vite middleware and Worker. */

export type GeoPoint = {
  lat: number
  lon: number
  label: string
  query: string
}

export type WeatherAtKickoff = {
  temperatureC: number | null
  precipitationProb: number | null
  weatherCode: number | null
  summary: string
}

type CacheEntry<T> = { expiresAt: number; value: T }

const geoCache = new Map<string, CacheEntry<GeoPoint | null>>()
const weatherCache = new Map<string, CacheEntry<WeatherAtKickoff>>()

const GEO_TTL_MS = 30 * 24 * 60 * 60 * 1000
const WEATHER_TTL_MS = 60 * 60 * 1000
const NOMINATIM_GAP_MS = 1100

let lastNominatimAt = 0
let nominatimChain: Promise<void> = Promise.resolve()

const UA =
  'SvenskaMatcher/1.0 (https://svenskamatcher.com; https://github.com/Bakayoke/svenskamatcher)'

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expiresAt) {
    map.delete(key)
    return undefined
  }
  return hit.value
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, ttl: number) {
  map.set(key, { value, expiresAt: Date.now() + ttl })
}

function normalizeQuery(q: string) {
  return q.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function throttleNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimChain.then(async () => {
    const wait = Math.max(0, NOMINATIM_GAP_MS - (Date.now() - lastNominatimAt))
    if (wait) await new Promise((r) => setTimeout(r, wait))
    lastNominatimAt = Date.now()
    return fn()
  })
  nominatimChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function geocodePlace(query: string): Promise<GeoPoint | null> {
  const q = query.trim()
  if (!q || q.length < 2) return null
  const key = normalizeQuery(q)
  const cached = cacheGet(geoCache, key)
  if (cached !== undefined) return cached

  const point = await throttleNominatim(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', `${q}, Sverige`)
    url.searchParams.set('format', 'json')
    url.searchParams.set('limit', '1')
    url.searchParams.set('countrycodes', 'se')
    url.searchParams.set('addressdetails', '0')

    const res = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': UA,
      },
    })
    if (!res.ok) {
      throw Object.assign(new Error(`Geokodning misslyckades (${res.status})`), {
        status: res.status,
      })
    }
    const rows = (await res.json()) as Array<{
      lat: string
      lon: string
      display_name: string
    }>
    if (!rows[0]) return null
    return {
      lat: Number(rows[0].lat),
      lon: Number(rows[0].lon),
      label: rows[0].display_name,
      query: q,
    }
  })

  cacheSet(geoCache, key, point, GEO_TTL_MS)
  return point
}

const WMO: Record<number, string> = {
  0: 'Klart',
  1: 'Mestadels klart',
  2: 'Halvklart',
  3: 'Mulet',
  45: 'Dimma',
  48: 'Dimma',
  51: 'Duggregn',
  53: 'Duggregn',
  55: 'Duggregn',
  61: 'Regn',
  63: 'Regn',
  65: 'Kraftigt regn',
  71: 'Snö',
  73: 'Snö',
  75: 'Kraftig snö',
  80: 'Skurar',
  81: 'Skurar',
  82: 'Kraftiga skurar',
  95: 'Åska',
}

function weatherSummary(code: number | null, temp: number | null, pop: number | null): string {
  const parts: string[] = []
  if (temp != null && Number.isFinite(temp)) parts.push(`${Math.round(temp)}°`)
  if (code != null) parts.push(WMO[code] ?? `Kod ${code}`)
  if (pop != null && pop >= 30) parts.push(`${Math.round(pop)}% regn`)
  return parts.join(' · ') || '—'
}

export async function weatherAt(
  lat: number,
  lon: number,
  isoLocal: string,
): Promise<WeatherAtKickoff> {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(isoLocal)
  if (!m) {
    return { temperatureC: null, precipitationProb: null, weatherCode: null, summary: '—' }
  }
  const day = `${m[1]}-${m[2]}-${m[3]}`
  const hour = Number(m[4])
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)}|${day}|${hour}`
  const cached = cacheGet(weatherCache, cacheKey)
  if (cached) return cached

  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.searchParams.set('latitude', String(lat))
  url.searchParams.set('longitude', String(lon))
  url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,weather_code')
  url.searchParams.set('timezone', 'Europe/Stockholm')
  url.searchParams.set('start_date', day)
  url.searchParams.set('end_date', day)

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw Object.assign(new Error(`Väder misslyckades (${res.status})`), { status: res.status })
  }
  const data = (await res.json()) as {
    hourly?: {
      time: string[]
      temperature_2m: (number | null)[]
      precipitation_probability: (number | null)[]
      weather_code: (number | null)[]
    }
  }
  const times = data.hourly?.time ?? []
  const idx = times.findIndex((t) => t.startsWith(`${day}T${String(hour).padStart(2, '0')}`))
  const i = idx >= 0 ? idx : 0
  const temperatureC = data.hourly?.temperature_2m?.[i] ?? null
  const precipitationProb = data.hourly?.precipitation_probability?.[i] ?? null
  const weatherCode = data.hourly?.weather_code?.[i] ?? null
  const value: WeatherAtKickoff = {
    temperatureC,
    precipitationProb,
    weatherCode,
    summary: weatherSummary(weatherCode, temperatureC, precipitationProb),
  }
  cacheSet(weatherCache, cacheKey, value, WEATHER_TTL_MS)
  return value
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
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

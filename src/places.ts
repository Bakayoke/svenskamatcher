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

export async function fetchGeocode(query: string): Promise<GeoPoint | null> {
  const params = new URLSearchParams({ q: query })
  const res = await fetch(`/api/geocode?${params}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Geokodning misslyckades (${res.status})`)
  }
  const data = (await res.json()) as { point?: GeoPoint | null }
  return data.point ?? null
}

export async function fetchWeather(
  lat: number,
  lon: number,
  at: string,
): Promise<WeatherAtKickoff> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    at,
  })
  const res = await fetch(`/api/weather?${params}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Väder misslyckades (${res.status})`)
  }
  return res.json() as Promise<WeatherAtKickoff>
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

export function formatKm(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return ''
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}

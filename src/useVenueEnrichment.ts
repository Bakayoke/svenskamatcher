import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadVenueGeoCache,
  saveVenueGeoCache,
  type BasePlace,
  type VenueGeoCache,
} from './agentStore'
import type { FlatGame } from './filters'
import {
  fetchGeocode,
  fetchWeather,
  formatKm,
  haversineKm,
  type WeatherAtKickoff,
} from './places'

export type VenueMeta = {
  lat: number
  lon: number
  label: string
  km: number | null
  weather: WeatherAtKickoff | null
}

const MAX_GEOCODE = 12

export function useVenueEnrichment(games: FlatGame[], base: BasePlace | null) {
  const [geoCache, setGeoCache] = useState<VenueGeoCache>(() => loadVenueGeoCache())
  const [weatherByGame, setWeatherByGame] = useState<Record<number, WeatherAtKickoff>>({})
  const queueRef = useRef(new Set<string>())
  const weatherFetched = useRef(new Set<number>())

  const locations = useMemo(() => {
    const counts = new Map<string, number>()
    for (const g of games) {
      const loc = g.location?.trim()
      if (!loc) continue
      counts.set(loc, (counts.get(loc) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([loc]) => loc)
      .slice(0, MAX_GEOCODE)
  }, [games])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const loc of locations) {
        const key = loc.toLowerCase()
        if (geoCache[key] || queueRef.current.has(key)) continue
        queueRef.current.add(key)
        try {
          const point = await fetchGeocode(loc)
          if (cancelled) return
          if (!point) continue
          setGeoCache((prev) => {
            const next = {
              ...prev,
              [key]: { lat: point.lat, lon: point.lon, label: point.label },
            }
            saveVenueGeoCache(next)
            return next
          })
        } catch {
          // Ignore geocode failures; leave unmapped.
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [locations, geoCache])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const next: Record<number, WeatherAtKickoff> = {}
      for (const g of games.slice(0, 24)) {
        const loc = g.location?.trim()
        if (!loc) continue
        const geo = geoCache[loc.toLowerCase()]
        if (!geo) continue
        if (weatherFetched.current.has(g.gameId)) continue
        weatherFetched.current.add(g.gameId)
        try {
          const w = await fetchWeather(geo.lat, geo.lon, g.date)
          if (cancelled) return
          next[g.gameId] = w
        } catch {
          weatherFetched.current.delete(g.gameId)
        }
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setWeatherByGame((prev) => ({ ...prev, ...next }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [games, geoCache])

  const metaByGameId = useMemo(() => {
    const map = new Map<number, VenueMeta>()
    for (const g of games) {
      const loc = g.location?.trim()
      if (!loc) continue
      const geo = geoCache[loc.toLowerCase()]
      if (!geo) continue
      const km = base ? haversineKm(base, geo) : null
      map.set(g.gameId, {
        lat: geo.lat,
        lon: geo.lon,
        label: geo.label,
        km,
        weather: weatherByGame[g.gameId] ?? null,
      })
    }
    return map
  }, [games, geoCache, base, weatherByGame])

  return metaByGameId
}

export function sortGamesByDistance(
  games: FlatGame[],
  meta: Map<number, VenueMeta>,
): FlatGame[] {
  return games.slice().sort((a, b) => {
    const ka = meta.get(a.gameId)?.km
    const kb = meta.get(b.gameId)?.km
    if (ka == null && kb == null) return a.date.localeCompare(b.date)
    if (ka == null) return 1
    if (kb == null) return -1
    if (ka !== kb) return ka - kb
    return a.date.localeCompare(b.date)
  })
}

export { formatKm }

import { getMatches } from '../server/matches'
import { geocodePlace, weatherAt } from '../server/places'

export interface Env {
  ASSETS: Fetcher
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({ ok: true })
    }

    if (url.pathname === '/api/matches' || url.pathname === '/api/matches/') {
      try {
        const from = url.searchParams.get('from') ?? undefined
        const to = url.searchParams.get('to') ?? undefined
        const payload = await getMatches(from, to)
        return json(payload, {
          headers: { 'Cache-Control': 'public, max-age=60' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel'
        const status =
          err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
            ? err.status
            : 502
        return json({ error: message }, { status })
      }
    }

    if (url.pathname === '/api/geocode' || url.pathname === '/api/geocode/') {
      try {
        const q = url.searchParams.get('q') ?? ''
        const point = await geocodePlace(q)
        return json(
          { point },
          { headers: { 'Cache-Control': 'public, max-age=86400' } },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel'
        const status =
          err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
            ? err.status
            : 502
        return json({ error: message }, { status })
      }
    }

    if (url.pathname === '/api/weather' || url.pathname === '/api/weather/') {
      try {
        const lat = Number(url.searchParams.get('lat'))
        const lon = Number(url.searchParams.get('lon'))
        const at = url.searchParams.get('at') ?? ''
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !at) {
          return json({ error: 'lat, lon och at krävs' }, { status: 400 })
        }
        const weather = await weatherAt(lat, lon, at)
        return json(weather, {
          headers: { 'Cache-Control': 'public, max-age=1800' },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel'
        const status =
          err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
            ? err.status
            : 502
        return json({ error: message }, { status })
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}

import {
  getEliteFixturesForRange,
  getFixtureDetail,
  getTeamTransfers,
} from '../server/apiFootball'
import { getMatches } from '../server/matches'

export interface Env {
  ASSETS: Fetcher
  API_FOOTBALL_KEY?: string
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

function requireKey(env: Env): string | Response {
  const key = env.API_FOOTBALL_KEY?.trim()
  if (!key) {
    return json(
      {
        error: 'API_FOOTBALL_KEY saknas',
        hint: 'Skapa gratis nyckel på https://dashboard.api-football.com och sätt wrangler secret API_FOOTBALL_KEY',
        configured: false,
      },
      { status: 503 },
    )
  }
  return key
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return json({
        ok: true,
        apiFootball: Boolean(env.API_FOOTBALL_KEY?.trim()),
      })
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

    if (url.pathname === '/api/enrich' || url.pathname === '/api/enrich/') {
      const keyOrRes = requireKey(env)
      if (keyOrRes instanceof Response) return keyOrRes
      try {
        const from = url.searchParams.get('from') ?? url.searchParams.get('date')
        const to = url.searchParams.get('to') ?? from
        if (!from || !to) {
          return json({ error: 'from/to krävs (YYYY-MM-DD)' }, { status: 400 })
        }
        const fixtures = await getEliteFixturesForRange(keyOrRes, from, to)
        return json(
          { fixtures, source: 'api-football', configured: true },
          { headers: { 'Cache-Control': 'public, max-age=60' } },
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel'
        const status =
          err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
            ? err.status
            : 502
        return json({ error: message, configured: true }, { status })
      }
    }

    const fixtureMatch = url.pathname.match(/^\/api\/fixture\/(\d+)\/?$/)
    if (fixtureMatch) {
      const keyOrRes = requireKey(env)
      if (keyOrRes instanceof Response) return keyOrRes
      try {
        const detail = await getFixtureDetail(keyOrRes, Number(fixtureMatch[1]))
        return json(detail, { headers: { 'Cache-Control': 'public, max-age=120' } })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel'
        const status =
          err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
            ? err.status
            : 502
        return json({ error: message }, { status })
      }
    }

    const transfersMatch = url.pathname.match(/^\/api\/team\/(\d+)\/transfers\/?$/)
    if (transfersMatch) {
      const keyOrRes = requireKey(env)
      if (keyOrRes instanceof Response) return keyOrRes
      try {
        const transfers = await getTeamTransfers(keyOrRes, Number(transfersMatch[1]))
        return json(
          { transfers },
          { headers: { 'Cache-Control': 'public, max-age=3600' } },
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

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}

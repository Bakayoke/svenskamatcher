import { getMatches } from '../server/matches'

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

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, { status: 404 })
    }

    return env.ASSETS.fetch(request)
  },
}

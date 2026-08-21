import { getMatches } from '../../server/matches'

interface EventContext {
  request: Request
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  try {
    const url = new URL(context.request.url)
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

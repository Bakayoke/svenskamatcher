import { askScout } from '../server/aiScout'
import { getMatches } from '../server/matches'
import { geocodePlace, weatherAt } from '../server/places'
import { runScoutTool, type ScoutContext } from '../server/scoutTools'
import { buildSitemapXml, injectSeoHtml } from '../server/seo'

export interface Env {
  ASSETS: Fetcher
  AI?: {
    run: (
      model: string,
      input: Record<string, unknown>,
    ) => Promise<{ response?: string; result?: string } | string>
  }
  GOOGLE_SITE_VERIFICATION?: string
}

const askHits = new Map<string, { count: number; resetAt: number }>()

function rateLimitAsk(ip: string, limit = 20, windowMs = 60 * 60 * 1000) {
  const now = Date.now()
  const cur = askHits.get(ip)
  if (!cur || now > cur.resetAt) {
    askHits.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (cur.count >= limit) return false
  cur.count++
  return true
}

function clientIp(request: Request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}

function parseScoutContext(body: Record<string, unknown>): ScoutContext {
  const ctx = (body.context && typeof body.context === 'object'
    ? body.context
    : {}) as Record<string, unknown>
  return {
    from: typeof ctx.from === 'string' ? ctx.from : undefined,
    to: typeof ctx.to === 'string' ? ctx.to : undefined,
    baseQuery: typeof ctx.baseQuery === 'string' ? ctx.baseQuery : undefined,
    baseLat: typeof ctx.baseLat === 'number' ? ctx.baseLat : undefined,
    baseLon: typeof ctx.baseLon === 'number' ? ctx.baseLon : undefined,
    gender:
      ctx.gender === 'Man' || ctx.gender === 'Kvinna' || ctx.gender === 'all'
        ? ctx.gender
        : undefined,
    ageCategory: typeof ctx.ageCategory === 'string' ? ctx.ageCategory : undefined,
    query: typeof ctx.query === 'string' ? ctx.query : undefined,
  }
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(data), { ...init, headers })
}

async function seoPage(request: Request, env: Env, pathname: string) {
  const assetRes = await env.ASSETS.fetch(new URL('/index.html', request.url))
  let html = await assetRes.text()
  html = await injectSeoHtml(html, pathname)
  if (env.GOOGLE_SITE_VERIFICATION?.trim()) {
    const token = env.GOOGLE_SITE_VERIFICATION.trim()
    html = html.replace(
      '</head>',
      `<meta name="google-site-verification" content="${token}" />\n  </head>`,
    )
  }
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=120',
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/sitemap.xml') {
      try {
        const xml = await buildSitemapXml()
        return new Response(xml, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sitemap error'
        return new Response(message, { status: 502 })
      }
    }

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

    if (
      (url.pathname === '/api/scout/ask' || url.pathname === '/api/scout/ask/') &&
      request.method === 'POST'
    ) {
      try {
        if (!rateLimitAsk(clientIp(request))) {
          return json({ error: 'För många frågor – försök igen senare.' }, { status: 429 })
        }
        const body = (await request.json()) as Record<string, unknown>
        const message = typeof body.message === 'string' ? body.message : ''
        const ctx = parseScoutContext(body)
        const result = await askScout(message, ctx, env.AI ?? null)
        return json(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel'
        return json({ error: message }, { status: 502 })
      }
    }

    if (
      (url.pathname === '/api/scout/along' || url.pathname === '/api/scout/along/') &&
      request.method === 'POST'
    ) {
      try {
        const body = (await request.json()) as Record<string, unknown>
        const ctx = parseScoutContext(body)
        const result = await runScoutTool(
          'matches_along_route',
          {
            fromPlace: body.fromPlace,
            toPlace: body.toPlace,
            departTime: body.departTime,
            day: body.day,
            corridorKm: body.corridorKm,
            watchMinutes: body.watchMinutes,
          },
          ctx,
        )
        return json(result)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Okänt fel'
        return json({ error: message }, { status: 502 })
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, { status: 404 })
    }

    const path = url.pathname.replace(/\/+$/, '') || '/'
    if (
      path === '/idag' ||
      path === '/imorgon' ||
      path.startsWith('/lag/') ||
      path.startsWith('/distrikt/') ||
      path.startsWith('/matcher/')
    ) {
      try {
        return await seoPage(request, env, path)
      } catch {
        // fall through to SPA
      }
    }

    // Home: optional verification meta
    if ((path === '/' || path === '') && env.GOOGLE_SITE_VERIFICATION?.trim()) {
      const assetRes = await env.ASSETS.fetch(new URL('/index.html', request.url))
      let html = await assetRes.text()
      const token = env.GOOGLE_SITE_VERIFICATION.trim()
      html = html.replace(
        '</head>',
        `<meta name="google-site-verification" content="${token}" />\n  </head>`,
      )
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }

    return env.ASSETS.fetch(request)
  },
}

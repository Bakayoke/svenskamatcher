import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { askScout } from './server/aiScout.ts'
import { getMatches } from './server/matches.ts'
import { geocodePlace, weatherAt } from './server/places.ts'
import { runScoutTool, type ScoutContext } from './server/scoutTools.ts'
import { buildSitemapXml } from './server/seo.ts'

function sendJson(res: import('http').ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req: import('http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
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

function matchesApiPlugin(): Plugin {
  return {
    name: 'svenska-matcher-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const raw = req.url ?? ''
        const url = new URL(raw, 'http://localhost')

        if (url.pathname === '/sitemap.xml') {
          try {
            const xml = await buildSitemapXml()
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/xml; charset=utf-8')
            res.end(xml)
            return
          } catch (err) {
            res.statusCode = 502
            res.end(err instanceof Error ? err.message : 'sitemap error')
            return
          }
        }

        // SPA fallback for SEO client routes in dev
        if (
          url.pathname === '/idag' ||
          url.pathname === '/imorgon' ||
          url.pathname.startsWith('/lag/') ||
          url.pathname.startsWith('/distrikt/') ||
          url.pathname.startsWith('/matcher/')
        ) {
          req.url = '/index.html'
          next()
          return
        }

        if (!raw.startsWith('/api/')) return next()

        try {
          if (url.pathname === '/api/health') {
            sendJson(res, 200, { ok: true })
            return
          }

          if (url.pathname.startsWith('/api/matches')) {
            const from = url.searchParams.get('from') ?? undefined
            const to = url.searchParams.get('to') ?? undefined
            const payload = await getMatches(from, to)
            res.setHeader('Cache-Control', 'public, max-age=60')
            sendJson(res, 200, payload)
            return
          }

          if (url.pathname.startsWith('/api/geocode')) {
            const q = url.searchParams.get('q') ?? ''
            const point = await geocodePlace(q)
            res.setHeader('Cache-Control', 'public, max-age=86400')
            sendJson(res, 200, { point })
            return
          }

          if (url.pathname.startsWith('/api/weather')) {
            const lat = Number(url.searchParams.get('lat'))
            const lon = Number(url.searchParams.get('lon'))
            const at = url.searchParams.get('at') ?? ''
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || !at) {
              sendJson(res, 400, { error: 'lat, lon och at krävs' })
              return
            }
            const weather = await weatherAt(lat, lon, at)
            res.setHeader('Cache-Control', 'public, max-age=1800')
            sendJson(res, 200, weather)
            return
          }

          if (url.pathname.startsWith('/api/scout/ask') && req.method === 'POST') {
            const rawBody = await readBody(req)
            const body = JSON.parse(rawBody || '{}') as Record<string, unknown>
            const message = typeof body.message === 'string' ? body.message : ''
            const result = await askScout(message, parseScoutContext(body), null)
            sendJson(res, 200, result)
            return
          }

          if (url.pathname.startsWith('/api/scout/along') && req.method === 'POST') {
            const rawBody = await readBody(req)
            const body = JSON.parse(rawBody || '{}') as Record<string, unknown>
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
              parseScoutContext(body),
            )
            sendJson(res, 200, result)
            return
          }

          next()
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Okänt fel'
          const status =
            err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
              ? err.status
              : 502
          sendJson(res, status, { error: message })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), matchesApiPlugin()],
  server: {
    port: 5175,
  },
})

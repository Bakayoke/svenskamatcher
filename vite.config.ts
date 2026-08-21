import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { getMatches } from './server/matches.ts'
import { geocodePlace, weatherAt } from './server/places.ts'

function sendJson(res: import('http').ServerResponse, status: number, data: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function matchesApiPlugin(): Plugin {
  return {
    name: 'svenska-matcher-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://localhost')

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

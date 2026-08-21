import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { getMatches } from './server/matches.ts'

function matchesApiPlugin(): Plugin {
  return {
    name: 'svenska-matcher-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next()

        try {
          if (req.url === '/api/health') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (req.url.startsWith('/api/matches')) {
            const url = new URL(req.url, 'http://localhost')
            const from = url.searchParams.get('from') ?? undefined
            const to = url.searchParams.get('to') ?? undefined
            const payload = await getMatches(from, to)
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'public, max-age=60')
            res.end(JSON.stringify(payload))
            return
          }

          next()
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Okänt fel'
          const status =
            err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
              ? err.status
              : 502
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: message }))
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

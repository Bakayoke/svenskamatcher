import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  getEliteFixturesForRange,
  getFixtureDetail,
  getTeamTransfers,
} from './server/apiFootball.ts'
import { getMatches } from './server/matches.ts'

function loadDevKey(): string {
  if (process.env.API_FOOTBALL_KEY?.trim()) return process.env.API_FOOTBALL_KEY.trim()
  const path = resolve(process.cwd(), '.dev.vars')
  if (!existsSync(path)) return ''
  const text = readFileSync(path, 'utf8')
  const m = /^API_FOOTBALL_KEY\s*=\s*(.+)$/m.exec(text)
  return m?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
}

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
            sendJson(res, 200, { ok: true, apiFootball: Boolean(loadDevKey()) })
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

          if (url.pathname.startsWith('/api/enrich')) {
            const key = loadDevKey()
            if (!key) {
              sendJson(res, 503, {
                error: 'API_FOOTBALL_KEY saknas',
                configured: false,
                hint: 'Lägg nyckeln i .dev.vars',
              })
              return
            }
            const from = url.searchParams.get('from') ?? url.searchParams.get('date')
            const to = url.searchParams.get('to') ?? from
            if (!from || !to) {
              sendJson(res, 400, { error: 'from/to krävs' })
              return
            }
            const fixtures = await getEliteFixturesForRange(key, from, to)
            res.setHeader('Cache-Control', 'public, max-age=60')
            sendJson(res, 200, { fixtures, source: 'api-football', configured: true })
            return
          }

          const fixtureMatch = url.pathname.match(/^\/api\/fixture\/(\d+)\/?$/)
          if (fixtureMatch) {
            const key = loadDevKey()
            if (!key) {
              sendJson(res, 503, { error: 'API_FOOTBALL_KEY saknas', configured: false })
              return
            }
            const detail = await getFixtureDetail(key, Number(fixtureMatch[1]))
            sendJson(res, 200, detail)
            return
          }

          const transfersMatch = url.pathname.match(/^\/api\/team\/(\d+)\/transfers\/?$/)
          if (transfersMatch) {
            const key = loadDevKey()
            if (!key) {
              sendJson(res, 503, { error: 'API_FOOTBALL_KEY saknas', configured: false })
              return
            }
            const transfers = await getTeamTransfers(key, Number(transfersMatch[1]))
            sendJson(res, 200, { transfers })
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

import cors from 'cors'
import express from 'express'
import { getMatches } from './matches.ts'

const app = express()
const PORT = Number(process.env.PORT) || 8787

app.use(cors({ origin: true }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/matches', async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined
    const to = typeof req.query.to === 'string' ? req.query.to : undefined
    const payload = await getMatches(from, to)
    res.setHeader('Cache-Control', 'public, max-age=60')
    res.json(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Okänt fel'
    const status =
      err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
        ? err.status
        : 502
    console.error(message)
    res.status(status).json({ error: message })
  }
})

app.get('/api/matches/today', (_req, res) => {
  const today = new Date()
  const y = today.getFullYear()
  const m = String(today.getMonth() + 1).padStart(2, '0')
  const d = String(today.getDate()).padStart(2, '0')
  const iso = `${y}-${m}-${d}`
  res.redirect(`/api/matches?from=${iso}&to=${iso}`)
})

const server = app.listen(PORT, () => {
  console.log(`Svenska Matcher API på http://localhost:${PORT}`)
})

server.on('error', (err) => {
  console.error('Server error', err)
})

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err)
})

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err)
})

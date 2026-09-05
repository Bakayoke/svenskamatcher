import type { ShortlistedMatch } from './agentStore'

type CompactRow = [
  gameId: number,
  date: string,
  home: string,
  away: string,
  competitionName: string,
  location: string,
  url: string,
]

function toBase64Url(text: string) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string) {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + pad
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function encodeShortlist(items: ShortlistedMatch[]): string {
  const compact: CompactRow[] = items.map((m) => [
    m.gameId,
    m.date,
    m.home,
    m.away,
    m.competitionName,
    m.location,
    m.url,
  ])
  return toBase64Url(JSON.stringify(compact))
}

export function decodeShortlist(encoded: string): ShortlistedMatch[] | null {
  try {
    const raw = JSON.parse(fromBase64Url(encoded)) as CompactRow[]
    if (!Array.isArray(raw)) return null
    const now = new Date().toISOString()
    return raw
      .filter((row) => Array.isArray(row) && typeof row[0] === 'number')
      .map((row) => ({
        gameId: row[0],
        date: String(row[1] ?? ''),
        home: String(row[2] ?? ''),
        away: String(row[3] ?? ''),
        competitionName: String(row[4] ?? ''),
        location: String(row[5] ?? ''),
        url: String(row[6] ?? ''),
        savedAt: now,
      }))
  } catch {
    return null
  }
}

export function mergeShortlists(
  current: ShortlistedMatch[],
  incoming: ShortlistedMatch[],
): ShortlistedMatch[] {
  const byId = new Map<number, ShortlistedMatch>()
  for (const m of current) byId.set(m.gameId, m)
  for (const m of incoming) {
    if (!byId.has(m.gameId)) byId.set(m.gameId, m)
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function shortlistShareUrl(items: ShortlistedMatch[]): string {
  const url = new URL(window.location.href)
  url.search = ''
  url.searchParams.set('lista', encodeShortlist(items))
  url.searchParams.set('shortlist', '1')
  return url.toString()
}

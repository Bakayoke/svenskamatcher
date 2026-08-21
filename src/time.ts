import type { FlatGame } from './filters'

/** Kickoff strings from SvFF look like `2026-08-21T19:00:00` (local SE wall clock). */
export function parseKickoff(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(dateStr)
  if (!m) return new Date(dateStr)
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  )
}

export type MatchPhase = 'live' | 'soon' | 'later' | 'done' | 'other'

const SOON_MS = 2 * 60 * 60 * 1000

export function matchPhase(game: Pick<FlatGame, 'status' | 'date'>, now = new Date()): MatchPhase {
  if (game.status === 2 || game.status === 3) return 'live'
  if (game.status === 1 || game.status === 0 || game.status === 4) return 'done'
  if (game.status === 5) {
    const kickoff = parseKickoff(game.date).getTime()
    const delta = kickoff - now.getTime()
    if (delta <= 0 && delta > -3 * 60 * 60 * 1000) return 'live' // likely started, status lag
    if (delta > 0 && delta <= SOON_MS) return 'soon'
    if (delta > SOON_MS) return 'later'
    return 'done'
  }
  return 'other'
}

export function phaseLabel(phase: MatchPhase): string {
  switch (phase) {
    case 'live':
      return 'Pågår'
    case 'soon':
      return 'Snart'
    case 'later':
      return 'Senare'
    case 'done':
      return 'Klar'
    default:
      return ''
  }
}

export function relativeKickoff(dateStr: string, now = new Date()): string {
  const kickoff = parseKickoff(dateStr)
  const deltaMin = Math.round((kickoff.getTime() - now.getTime()) / 60000)
  if (deltaMin > 0 && deltaMin < 60) return `om ${deltaMin} min`
  if (deltaMin >= 60 && deltaMin < 24 * 60) {
    const h = Math.floor(deltaMin / 60)
    const m = deltaMin % 60
    return m === 0 ? `om ${h} h` : `om ${h} h ${m} min`
  }
  if (deltaMin <= 0 && deltaMin > -120) return 'nyss startad'
  return kickoff.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
}

export function kickoffClock(dateStr: string): string {
  return parseKickoff(dateStr).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** e.g. "fre 22 aug" */
export function kickoffDayShort(dateStr: string): string {
  return parseKickoff(dateStr).toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** e.g. "fredag 22 augusti" */
export function kickoffDayLong(dateStr: string): string {
  return parseKickoff(dateStr).toLocaleDateString('sv-SE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function dayKey(dateStr: string): string {
  return dateStr.slice(0, 10)
}

export type FocusMode = 'overview' | 'live' | 'soon' | 'all'

export function filterByFocus(games: FlatGame[], focus: FocusMode, now = new Date()): FlatGame[] {
  if (focus === 'all') return games
  return games.filter((g) => {
    const phase = matchPhase(g, now)
    if (focus === 'live') return phase === 'live'
    if (focus === 'soon') return phase === 'live' || phase === 'soon'
    // overview: hide finished youth noise less — show live, soon, later (not done)
    return phase === 'live' || phase === 'soon' || phase === 'later'
  })
}

export function sortForOverview(games: FlatGame[], now = new Date()): FlatGame[] {
  const rank = (g: FlatGame) => {
    const phase = matchPhase(g, now)
    if (phase === 'live') return 0
    if (phase === 'soon') return 1
    if (phase === 'later') return 2
    if (phase === 'other') return 3
    return 4
  }
  return [...games].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return parseKickoff(a.date).getTime() - parseKickoff(b.date).getTime()
  })
}

export function countByPhase(games: FlatGame[], now = new Date()) {
  let live = 0
  let soon = 0
  let later = 0
  let done = 0
  for (const g of games) {
    const p = matchPhase(g, now)
    if (p === 'live') live++
    else if (p === 'soon') soon++
    else if (p === 'later') later++
    else if (p === 'done') done++
  }
  return { live, soon, later, done }
}

import type { FlatGame } from './filters'
import { matchPhase, type MatchPhase } from './time'

/** Upcoming fixtures usually carry 0–0 — hide that as a fake result. */
export function shouldShowScore(game: Pick<FlatGame, 'status' | 'score' | 'date'>, now = new Date()) {
  const phase = matchPhase(game, now)
  if (phase === 'live' || phase === 'done') return true
  if (game.status === 2 || game.status === 3 || game.status === 1) return true
  // Inställd/uppskjuten: only show if non-zero (rare)
  if (game.status === 0 || game.status === 4) {
    return game.score.home !== 0 || game.score.away !== 0
  }
  return false
}

export function scoreTone(phase: MatchPhase, status: number): 'live' | 'ht' | 'ft' | 'pending' | 'other' {
  if (status === 3) return 'ht'
  if (phase === 'live' || status === 2) return 'live'
  if (phase === 'done' && status === 1) return 'ft'
  if (phase === 'later' || phase === 'soon' || status === 5) return 'pending'
  return 'other'
}

export function scoreTag(phase: MatchPhase, status: number): string | null {
  if (status === 3) return 'HT'
  if (phase === 'live' || status === 2) return 'LIVE'
  if (status === 1) return 'FT'
  if (status === 0) return 'INSTÄLLD'
  if (status === 4) return 'UPPSKJUTEN'
  return null
}

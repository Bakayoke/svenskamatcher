import type { FlatGame } from './filters'
import { matchPhase, type MatchPhase } from './time'

/**
 * Only trust final scores from matches-today.
 * Live feeds often stay at 0–0 while the real score moves — don't show those digits.
 */
export function shouldShowScore(game: Pick<FlatGame, 'status' | 'score' | 'date'>, _now = new Date()) {
  if (game.status === 1) return true
  if (game.status === 0 || game.status === 4) {
    return game.score.home !== 0 || game.score.away !== 0
  }
  return false
}

export function scoreTone(phase: MatchPhase, status: number): 'live' | 'ht' | 'ft' | 'pending' | 'other' {
  if (status === 3) return 'ht'
  if (phase === 'live' || status === 2) return 'live'
  if (status === 1) return 'ft'
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

export function isInPlay(game: Pick<FlatGame, 'status' | 'date'>, now = new Date()) {
  const phase = matchPhase(game, now)
  return phase === 'live' || game.status === 2 || game.status === 3
}

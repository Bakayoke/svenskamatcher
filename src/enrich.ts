import type { EnrichedFixture } from './api'

export function normalizeTeamName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\b(fk|if|ff|bk|sk|aik|gif|aif|kif|dff|fc|united|fotboll)\b/g, '')
    .replace(/[^a-z0-9åäö]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function namesLikelyMatch(a: string, b: string): boolean {
  const na = normalizeTeamName(a)
  const nb = normalizeTeamName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  const ta = new Set(na.split(' '))
  const tb = nb.split(' ')
  const overlap = tb.filter((t) => t.length > 2 && ta.has(t)).length
  return overlap >= 1 && (overlap >= 2 || Math.min(ta.size, tb.length) <= 2)
}

export function findEnrichedFixture(
  home: string,
  away: string,
  fixtures: EnrichedFixture[],
): EnrichedFixture | null {
  for (const f of fixtures) {
    if (namesLikelyMatch(home, f.home) && namesLikelyMatch(away, f.away)) return f
  }
  return null
}

export function isEliteCompetitionName(name: string): boolean {
  return /\b(allsvenskan|superettan|elitettan|obos damallsvenskan|damallsvenskan)\b/i.test(
    name,
  )
}

export function isLiveStatus(short: string): boolean {
  return ['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE'].includes(short)
}

export function afStatusLabel(short: string, elapsed: number | null): string {
  if (short === '1H' || short === '2H' || short === 'ET') {
    return elapsed != null ? `${elapsed}'` : short
  }
  if (short === 'HT') return 'Halvtid'
  if (short === 'FT') return 'FT'
  if (short === 'NS') return 'Kommande'
  if (short === 'PST') return 'Uppskjuten'
  if (short === 'CANC') return 'Inställd'
  return short
}

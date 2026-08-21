import type { MatchesPayload } from './types'

export async function fetchMatches(from: string, to: string): Promise<MatchesPayload> {
  const params = new URLSearchParams({ from, to })
  const res = await fetch(`/api/matches?${params}`)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Kunde inte hämta matcher (${res.status})`)
  }
  return res.json() as Promise<MatchesPayload>
}

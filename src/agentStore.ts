import type { FlatGame } from './filters'

const WATCH_KEY = 'sm.watchTeams'
const SHORT_KEY = 'sm.shortlist'
const NOTES_KEY = 'sm.notes'
const BASE_KEY = 'sm.basePlace'
const VENUE_GEO_KEY = 'sm.venueGeo'

export type BasePlace = {
  query: string
  lat: number
  lon: number
  label: string
}

export type VenueGeoCache = Record<string, { lat: number; lon: number; label: string }>

export type ShortlistedMatch = {
  gameId: number
  date: string
  home: string
  away: string
  competitionName: string
  location: string
  url: string
  savedAt: string
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function loadWatchTeams(): string[] {
  return readJson<string[]>(WATCH_KEY, [])
}

export function saveWatchTeams(teams: string[]) {
  writeJson(WATCH_KEY, [...new Set(teams.map((t) => t.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'sv'),
  ))
}

export function toggleWatchTeam(teamName: string, current: string[]): string[] {
  const name = teamName.trim()
  const next = current.includes(name)
    ? current.filter((t) => t !== name)
    : [...current, name]
  saveWatchTeams(next)
  return next
}

export function loadShortlist(): ShortlistedMatch[] {
  return readJson<ShortlistedMatch[]>(SHORT_KEY, [])
}

export function saveShortlist(items: ShortlistedMatch[]) {
  writeJson(SHORT_KEY, items)
}

export function toggleShortlist(game: FlatGame, current: ShortlistedMatch[]): ShortlistedMatch[] {
  const exists = current.some((m) => m.gameId === game.gameId)
  const next = exists
    ? current.filter((m) => m.gameId !== game.gameId)
    : [
        ...current,
        {
          gameId: game.gameId,
          date: game.date,
          home: game.homeTeam.name.trim(),
          away: game.awayTeam.name.trim(),
          competitionName: game.competitionName,
          location: game.location,
          url: game.url,
          savedAt: new Date().toISOString(),
        },
      ]
  saveShortlist(next)
  return next
}

export function loadNotes(): Record<string, string> {
  return readJson<Record<string, string>>(NOTES_KEY, {})
}

export function saveNote(gameId: number, note: string, current: Record<string, string>) {
  const next = { ...current }
  const key = String(gameId)
  if (!note.trim()) delete next[key]
  else next[key] = note
  writeJson(NOTES_KEY, next)
  return next
}

export function loadBasePlace(): BasePlace | null {
  return readJson<BasePlace | null>(BASE_KEY, null)
}

export function saveBasePlace(place: BasePlace | null) {
  if (!place) localStorage.removeItem(BASE_KEY)
  else writeJson(BASE_KEY, place)
}

export function loadVenueGeoCache(): VenueGeoCache {
  return readJson<VenueGeoCache>(VENUE_GEO_KEY, {})
}

export function saveVenueGeoCache(cache: VenueGeoCache) {
  writeJson(VENUE_GEO_KEY, cache)
}

export type ScoutPreset = 'all' | 'elit' | 'ungdom' | 'dam' | 'watch'

const ELIT_RE =
  /\b(allsvenskan|superettan|elitettan|obos damallsvenskan|damallsvenskan)\b/i

export function matchesPreset(game: FlatGame, preset: ScoutPreset, watchTeams: string[]): boolean {
  if (preset === 'all') return true
  if (preset === 'elit') return ELIT_RE.test(game.competitionName)
  if (preset === 'ungdom') return game.ageCategoryName === 'Ungdom'
  if (preset === 'dam') return game.genderName === 'Kvinna'
  if (preset === 'watch') {
    const watched = new Set(watchTeams.map((t) => t.toLowerCase()))
    return (
      watched.has(game.homeTeam.name.trim().toLowerCase()) ||
      watched.has(game.awayTeam.name.trim().toLowerCase())
    )
  }
  return true
}

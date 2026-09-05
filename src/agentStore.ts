import type { FlatGame } from './filters'

const WATCH_KEY = 'sm.watchTeams'
const SHORT_KEY = 'sm.shortlist'
const NOTES_KEY = 'sm.notes'
const BASE_KEY = 'sm.basePlace'
const VENUE_GEO_KEY = 'sm.venueGeo'
const VIEWS_KEY = 'sm.savedViews'
const SESSION_KEY = 'sm.lastSession'
const DISMISS_TOMORROW_KEY = 'sm.dismissTomorrow'

export type BasePlace = {
  query: string
  lat: number
  lon: number
  label: string
}

export type VenueGeoCache = Record<string, { lat: number; lon: number; label: string }>

export type ScoutPreset = 'all' | 'elit' | 'ungdom' | 'dam' | 'watch'

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

export type SavedView = {
  id: string
  name: string
  gender: 'all' | 'Man' | 'Kvinna'
  ageCategory: string
  districtId: 'all' | number
  query: string
  preset: ScoutPreset
  createdAt: string
}

export type LastSession = {
  from: string
  to: string
  preset: ScoutPreset
  focus: string
  gender: 'all' | 'Man' | 'Kvinna'
  ageCategory: string
  districtId: 'all' | number
  query: string
  layout: 'timeline' | 'league'
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

export function loadSavedViews(): SavedView[] {
  return readJson<SavedView[]>(VIEWS_KEY, [])
}

export function saveSavedViews(views: SavedView[]) {
  writeJson(VIEWS_KEY, views)
}

export function addSavedView(
  view: Omit<SavedView, 'id' | 'createdAt'>,
  current: SavedView[],
): SavedView[] {
  const next = [
    {
      ...view,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    },
    ...current,
  ].slice(0, 12)
  saveSavedViews(next)
  return next
}

export function removeSavedView(id: string, current: SavedView[]): SavedView[] {
  const next = current.filter((v) => v.id !== id)
  saveSavedViews(next)
  return next
}

export function loadLastSession(): LastSession | null {
  return readJson<LastSession | null>(SESSION_KEY, null)
}

export function saveLastSession(session: LastSession) {
  writeJson(SESSION_KEY, session)
}

export function isTomorrowBannerDismissed(dayIso: string): boolean {
  return localStorage.getItem(DISMISS_TOMORROW_KEY) === dayIso
}

export function dismissTomorrowBanner(dayIso: string) {
  localStorage.setItem(DISMISS_TOMORROW_KEY, dayIso)
}

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

import { addDays, format, isSameDay } from 'date-fns'
import { sv } from 'date-fns/locale'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { sv as dayPickerSv } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import {
  addSavedView,
  completeOnboarding,
  dismissTomorrowBanner,
  isOnboardingDone,
  isTomorrowBannerDismissed,
  loadBasePlace,
  loadLastAsk,
  loadLastScouted,
  loadLastSession,
  loadNotes,
  loadSavedViews,
  loadShortlist,
  loadWatchTeams,
  matchesPreset,
  pushLastScouted,
  removeSavedView,
  saveBasePlace,
  saveLastAsk,
  saveLastSession,
  saveNote,
  saveShortlist,
  toggleShortlist,
  toggleWatchTeam,
  type BasePlace,
  type LastScouted,
  type SavedView,
  type ScoutPreset,
  type ShortlistedMatch,
} from './agentStore'
import { decodeShortlist, mergeShortlists, shortlistShareUrl } from './shareShortlist'
import { fetchMatches } from './api'
import { buildClusters } from './clusters'
import { districtName } from './districts'
import { downloadShortlistCsv, downloadShortlistJson } from './exportScout'
import {
  countGames,
  emptyFilters,
  filterCompetitions,
  flattenGames,
  uniqueAgeCategories,
  type Filters,
  type FlatGame,
} from './filters'
import { buildShortlistIcs, downloadIcs } from './ics'
import { fetchGeocode } from './places'
import type { Competition, MatchesPayload } from './types'
import { matchUrl, statusLabel } from './types'
import { isInPlay, scoreTag, shouldShowScore } from './score'
import {
  countByPhase,
  dayKey,
  filterByFocus,
  kickoffClock,
  kickoffDayLong,
  kickoffDayShort,
  matchPhase,
  phaseLabel,
  relativeKickoff,
  sortForOverview,
  sortForResults,
  type FocusMode,
} from './time'
import { parseDateParam, readUrlState, toDateParam, writeUrlState } from './urlState'
import { bootFromPathname, navigateSeo } from './pathState'
import { YOUTH_AGE_CHIPS } from './seoRoutes'
import {
  alongRouteApi,
  askScoutApi,
  buildAskExamples,
  type ScoutAskMatch,
  type ScoutAskResult,
} from './aiScoutApi'
import {
  clockFromMs,
  DEFAULT_DAY_ROUTE,
  formatDrive,
  optimizeDayRoute,
  type DayRouteOptions,
} from './dayOptimizer'
import { mapsDrivingUrl, mapsPlaceUrl } from './maps'
import { buildTravelPlan, travelPlanSummary } from './travelPlan'
import { DEFAULT_DESC, useDocumentMeta } from './useDocumentMeta'
import { useInstallPrompt } from './useInstallPrompt'
import { formatKm, sortGamesByDistance, useVenueEnrichment } from './useVenueEnrichment'
import './App.css'

type Mode = 'single' | 'range'
type Layout = 'timeline' | 'league'

const MAX_RANGE_DAYS = 14

function rangeLength(range: DateRange | undefined) {
  if (!range?.from || !range?.to) return 0
  const ms = range.to.getTime() - range.from.getTime()
  return Math.floor(ms / 86400000) + 1
}

/** Show saved shortlist even when matches are outside the loaded date range. */
function shortlistToGames(items: ShortlistedMatch[], live: FlatGame[]): FlatGame[] {
  const byId = new Map(live.map((g) => [g.gameId, g]))
  return items
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => {
      const hit = byId.get(s.gameId)
      if (hit) return hit
      return {
        gameId: s.gameId,
        date: s.date,
        dateFormatted: s.date,
        location: s.location,
        url: s.url,
        homeTeam: { name: s.home, teamImageUrl: '', teamImageAlt: s.home },
        awayTeam: { name: s.away, teamImageUrl: '', teamImageAlt: s.away },
        competitionName: s.competitionName,
        competitionId: 0,
        genderName: '',
        ageCategoryName: '',
        score: { home: 0, away: 0 },
        status: 5,
        referees: [],
        note: '',
        homeTeamClubAssociationId: 0,
        awayTeamClubAssociationId: 0,
      }
    })
}

function genderShort(name: string) {
  if (name === 'Man') return 'Herr'
  if (name === 'Kvinna') return 'Dam'
  return name
}

function initialFromUrl() {
  const u = readUrlState()
  const session = loadLastSession()
  const watched = loadWatchTeams()
  const pathBoot = bootFromPathname(window.location.pathname)
  const pathSeo =
    pathBoot.teamFocus != null ||
    pathBoot.districtId !== 'all' ||
    window.location.pathname === '/idag' ||
    window.location.pathname === '/imorgon' ||
    window.location.pathname.startsWith('/matcher/')
  const bare =
    !pathSeo &&
    !u.from &&
    !u.to &&
    !u.preset &&
    !u.focus &&
    !u.gender &&
    !u.age &&
    !u.q &&
    !u.district &&
    !u.lista
  const today = new Date()
  const from = pathSeo
    ? pathBoot.from
    : parseDateParam(u.from ?? (bare ? session?.from : undefined), today)
  const to = pathSeo
    ? pathBoot.to
    : parseDateParam(u.to ?? (bare ? session?.to : undefined), from)
  const singleDay = isSameDay(from, to)
  const defaultPreset: ScoutPreset =
    watched.length > 0 ? 'watch' : ((session?.preset as ScoutPreset | undefined) ?? 'all')
  return {
    mode: (pathSeo ? pathBoot.mode : singleDay ? 'single' : 'range') as Mode,
    single: from,
    range: { from, to } as DateRange,
    focus: (pathBoot.focus ??
      u.focus ??
      (bare ? (session?.focus as FocusMode | undefined) : undefined) ??
      'overview') as FocusMode,
    preset: (pathBoot.preset ??
      u.preset ??
      (bare ? session?.preset : undefined) ??
      defaultPreset) as ScoutPreset,
    layout: (u.layout ?? (bare ? session?.layout : undefined) ?? 'timeline') as Layout,
    showShortlistOnly: u.shortlist === '1' || Boolean(u.lista),
    teamFocus: pathBoot.teamFocus,
    filters: {
      ...emptyFilters(),
      gender: u.gender ?? (bare ? session?.gender : undefined) ?? 'all',
      ageCategory: u.age ?? (bare ? session?.ageCategory : undefined) ?? 'all',
      query: pathBoot.query ?? u.q ?? (bare ? session?.query : undefined) ?? '',
      districtId:
        pathBoot.districtId !== 'all'
          ? pathBoot.districtId
          : u.district && u.district !== 'all'
            ? Number(u.district)
            : bare && session?.districtId != null
              ? session.districtId
              : 'all',
    } as Filters,
    sharedLista: u.lista,
  }
}

export default function App() {
  const boot = useMemo(() => initialFromUrl(), [])
  const [mode, setMode] = useState<Mode>(boot.mode)
  const [single, setSingle] = useState<Date>(boot.single)
  const [range, setRange] = useState<DateRange | undefined>(boot.range)
  const [data, setData] = useState<MatchesPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(boot.filters)
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [months, setMonths] = useState(1)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [layout, setLayout] = useState<Layout>(boot.layout)
  const [focus, setFocus] = useState<FocusMode>(boot.focus)
  const [preset, setPreset] = useState<ScoutPreset>(boot.preset)
  const [showShortlistOnly, setShowShortlistOnly] = useState(boot.showShortlistOnly)
  const [now, setNow] = useState(() => new Date())
  const [watchTeams, setWatchTeams] = useState<string[]>(() => loadWatchTeams())
  const [shortlist, setShortlist] = useState<ShortlistedMatch[]>(() => loadShortlist())
  const [notes, setNotes] = useState<Record<string, string>>(() => loadNotes())
  const [noteGameId, setNoteGameId] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [teamFocus, setTeamFocus] = useState<string | null>(boot.teamFocus)
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [basePlace, setBasePlace] = useState<BasePlace | null>(() => loadBasePlace())
  const [baseDraft, setBaseDraft] = useState(() => loadBasePlace()?.query ?? '')
  const [baseBusy, setBaseBusy] = useState(false)
  const [baseError, setBaseError] = useState<string | null>(null)
  const [sortByDistance, setSortByDistance] = useState(false)
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews())
  const [viewNameDraft, setViewNameDraft] = useState('')
  const [listaCopied, setListaCopied] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [tomorrowWatchCount, setTomorrowWatchCount] = useState<number | null>(null)
  const [showTomorrowBanner, setShowTomorrowBanner] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(
    () => !isOnboardingDone() && loadWatchTeams().length < 2,
  )
  const install = useInstallPrompt()
  const [lastScouted, setLastScouted] = useState<LastScouted[]>(() => loadLastScouted())
  const [showTravel, setShowTravel] = useState(false)
  const [showChat, setShowChat] = useState(false)
  const [assistantTab, setAssistantTab] = useState<'ask' | 'route' | 'along'>(
    () => loadLastAsk()?.tab ?? 'ask',
  )
  const [askDraft, setAskDraft] = useState(() => loadLastAsk()?.draft ?? '')
  const [askBusy, setAskBusy] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)
  const [askResult, setAskResult] = useState<ScoutAskResult | null>(() => {
    const boot = loadLastAsk()
    if (!boot?.answer) return null
    return {
      answer: boot.answer,
      matches: (boot.matches ?? []).map((m) => ({
        gameId: m.gameId,
        date: m.date,
        home: m.home,
        away: m.away,
        competitionName: m.competitionName,
        location: m.location,
        url: m.url,
        lat: m.lat,
        lon: m.lon,
        genderName: m.genderName ?? '',
        ageCategoryName: m.ageCategoryName ?? '',
      })),
      toolsUsed: [],
      mode: 'rules',
    }
  })
  const [alongFrom, setAlongFrom] = useState(() => loadLastAsk()?.alongFrom ?? 'Uppsala')
  const [alongTo, setAlongTo] = useState(() => loadLastAsk()?.alongTo ?? 'Malmö')
  const [alongDay, setAlongDay] = useState(() => {
    const saved = loadLastAsk()?.alongDay
    const today = toDateParam(new Date())
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) && saved >= today) return saved
    return today
  })
  const [alongTime, setAlongTime] = useState(() => loadLastAsk()?.alongTime ?? '08:00')
  const [alongBusy, setAlongBusy] = useState(false)
  const [alongError, setAlongError] = useState<string | null>(null)
  const [alongResult, setAlongResult] = useState<ScoutAskResult | null>(null)
  const [canA, setCanA] = useState(() => loadLastAsk()?.canA ?? '')
  const [canB, setCanB] = useState(() => loadLastAsk()?.canB ?? '')
  const [watchMinutes, setWatchMinutes] = useState(75)
  const [youthChip, setYouthChip] = useState<string | null>(null)
  const askInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.getElementById('seo-content')?.setAttribute('hidden', '')
  }, [])

  useEffect(() => {
    const onPop = () => {
      const p = bootFromPathname(window.location.pathname)
      setMode(p.mode)
      setSingle(p.from)
      setRange({ from: p.from, to: p.to })
      setTeamFocus(p.teamFocus)
      setFilters((f) => ({ ...f, districtId: p.districtId, query: p.query ?? f.query }))
      if (p.focus) setFocus(p.focus)
      if (p.preset) setPreset(p.preset)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!boot.sharedLista) return
    const decoded = decodeShortlist(boot.sharedLista)
    if (!decoded?.length) {
      setImportNotice('Kunde inte läsa den delade listan.')
      return
    }
    const merged = mergeShortlists(loadShortlist(), decoded)
    saveShortlist(merged)
    setShortlist(merged)
    setShowShortlistOnly(true)
    setImportNotice(`Importerade ${decoded.length} matcher till Mina matcher.`)
  }, [boot.sharedLista])

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)')
    const sync = () => setMonths(mq.matches ? 2 : 1)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const from = mode === 'single' ? single : (range?.from ?? single)
  const to = mode === 'single' ? single : (range?.to ?? range?.from ?? single)
  const fromIso = toDateParam(from)
  const toIso = toDateParam(to)
  const canFetch =
    mode === 'single' || Boolean(range?.from && range?.to && rangeLength(range) <= MAX_RANGE_DAYS)
  const viewingToday = isSameDay(from, now) && (mode === 'single' || isSameDay(to, now))

  useEffect(() => {
    writeUrlState({
      from: fromIso,
      to: toIso,
      focus,
      preset,
      gender: filters.gender,
      age: filters.ageCategory,
      q: filters.query || undefined,
      district: filters.districtId === 'all' ? undefined : String(filters.districtId),
      layout,
      shortlist: showShortlistOnly ? '1' : undefined,
    })
  }, [fromIso, toIso, focus, preset, filters, layout, showShortlistOnly])

  useEffect(() => {
    saveLastSession({
      from: fromIso,
      to: toIso,
      preset,
      focus,
      gender: filters.gender,
      ageCategory: filters.ageCategory,
      districtId: filters.districtId,
      query: filters.query,
      layout,
      savedAt: new Date().toISOString(),
    })
  }, [fromIso, toIso, preset, focus, filters, layout])

  useEffect(() => {
    if (watchTeams.length === 0) {
      setTomorrowWatchCount(null)
      setShowTomorrowBanner(false)
      return
    }
    const tomorrow = addDays(new Date(), 1)
    const dayIso = toDateParam(tomorrow)
    if (isTomorrowBannerDismissed(dayIso)) {
      setShowTomorrowBanner(false)
      return
    }
    let cancelled = false
    fetchMatches(dayIso, dayIso)
      .then((payload) => {
        if (cancelled) return
        const games = flattenGames(payload.competitions ?? [])
        const count = games.filter((g) => matchesPreset(g, 'watch', watchTeams)).length
        setTomorrowWatchCount(count)
        const alreadyOnTomorrow =
          mode === 'single' && isSameDay(single, tomorrow) && preset === 'watch'
        setShowTomorrowBanner(count > 0 && !alreadyOnTomorrow)
      })
      .catch(() => {
        if (!cancelled) setTomorrowWatchCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [watchTeams, mode, single, preset])

  useEffect(() => {
    if (!canFetch) return
    let cancelled = false
    setLoading(true)
    setError(null)

    fetchMatches(fromIso, toIso)
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setFilters((prev) => ({
          ...emptyFilters(),
          query: prev.query,
          gender: prev.gender,
          ageCategory: prev.ageCategory,
          districtId: prev.districtId,
        }))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setData(null)
        setError(err instanceof Error ? err.message : 'Något gick fel')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [canFetch, fromIso, toIso])

  useEffect(() => {
    if (!viewingToday || !canFetch) return
    const id = window.setInterval(() => {
      fetchMatches(fromIso, toIso)
        .then((payload) => setData(payload))
        .catch(() => {})
    }, 90_000)
    return () => window.clearInterval(id)
  }, [viewingToday, canFetch, fromIso, toIso])

  const filteredCompetitions = useMemo(
    () => filterCompetitions(data?.competitions ?? [], filters),
    [data, filters],
  )

  const flat = useMemo(() => flattenGames(filteredCompetitions), [filteredCompetitions])

  const scouted = useMemo(() => {
    // Scoutlista = all saved matches, not "saved ∩ current day/filters"
    if (showShortlistOnly) return shortlistToGames(shortlist, flat)

    let games = flat.filter((g) => matchesPreset(g, preset, watchTeams))
    if (teamFocus) {
      const t = teamFocus.trim().toLowerCase()
      games = games.filter(
        (g) =>
          g.homeTeam.name.trim().toLowerCase() === t ||
          g.awayTeam.name.trim().toLowerCase() === t ||
          g.homeTeam.name.trim().toLowerCase().includes(t) ||
          g.awayTeam.name.trim().toLowerCase().includes(t),
      )
    }
    if (youthChip) {
      const tag = youthChip.toLowerCase()
      games = games.filter(
        (g) =>
          g.competitionName.toLowerCase().includes(tag) ||
          g.homeTeam.name.toLowerCase().includes(tag) ||
          g.awayTeam.name.toLowerCase().includes(tag),
      )
    }
    return games
  }, [flat, preset, watchTeams, showShortlistOnly, shortlist, teamFocus, youthChip])

  const clusters = useMemo(() => buildClusters(scouted), [scouted])

  const focused = useMemo(() => {
    // Shortlist view: show every saved match regardless of Kommande/Pågår chips
    let games = showShortlistOnly ? scouted : filterByFocus(scouted, focus, now)
    if (clusterId) {
      const cluster = clusters.find((c) => c.id === clusterId)
      if (cluster) {
        const ids = new Set(cluster.games.map((g) => g.gameId))
        games = games.filter((g) => ids.has(g.gameId))
      }
    }
    return games
  }, [scouted, focus, now, clusterId, clusters, showShortlistOnly])

  const shortlistLocations = useMemo(
    () => shortlist.map((s) => s.location).filter(Boolean),
    [shortlist],
  )
  const { metaByGameId: venueMeta, geoCache } = useVenueEnrichment(
    focused,
    basePlace,
    shortlistLocations,
  )

  const timeline = useMemo(() => {
    if (sortByDistance && basePlace) return sortGamesByDistance(focused, venueMeta)
    if (focus === 'results') return sortForResults(focused)
    return sortForOverview(focused, now)
  }, [focused, now, sortByDistance, basePlace, venueMeta, focus])

  const phases = useMemo(() => countByPhase(scouted, now), [scouted, now])

  const ages = useMemo(() => uniqueAgeCategories(data?.competitions ?? []), [data])
  const districts = useMemo(() => {
    const ids = new Set<number>()
    for (const g of flattenGames(data?.competitions ?? [])) {
      ids.add(g.homeTeamClubAssociationId)
      ids.add(g.awayTeamClubAssociationId)
    }
    return [...ids]
      .map((id) => ({ id, name: districtName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'sv'))
  }, [data])

  const travelStops = useMemo(() => {
    if (!showTravel || shortlist.length === 0) return []
    return buildTravelPlan(shortlist, geoCache)
  }, [showTravel, shortlist, geoCache])

  const travelMapsUrl = useMemo(() => {
    if (!showTravel || travelStops.length === 0) return null
    const points = travelStops
      .filter((s) => s.lat != null && s.lon != null)
      .map((s) => ({ lat: s.lat!, lon: s.lon! }))
    if (points.length === 0) return null
    const origin = basePlace ?? points[0]!
    const rest = basePlace ? points : points.slice(1)
    if (rest.length === 0) return mapsPlaceUrl(origin)
    return mapsDrivingUrl(origin, rest)
  }, [showTravel, travelStops, basePlace])

  const dayRouteOpts = useMemo<DayRouteOptions>(
    () => ({ ...DEFAULT_DAY_ROUTE, watchMinutes }),
    [watchMinutes],
  )

  const dayRoute = useMemo(() => {
    if (!showChat || assistantTab !== 'route') return null
    const coords = new Map<number, { lat: number; lon: number }>()
    for (const g of focused) {
      const m = venueMeta.get(g.gameId)
      if (m) coords.set(g.gameId, { lat: m.lat, lon: m.lon })
    }
    return optimizeDayRoute(focused, coords, basePlace, dayRouteOpts)
  }, [showChat, assistantTab, focused, venueMeta, basePlace, dayRouteOpts])

  const dayRouteMapsUrl = useMemo(() => {
    if (!dayRoute || dayRoute.stops.length === 0) return null
    const points = dayRoute.stops.map((s) => ({ lat: s.lat, lon: s.lon }))
    const origin = basePlace ?? points[0]!
    const rest = basePlace ? points : points.slice(1)
    if (rest.length === 0) return mapsPlaceUrl(origin)
    return mapsDrivingUrl(origin, rest)
  }, [dayRoute, basePlace])

  const shortlistConflicts = useMemo(() => {
    const bySlot = new Map<string, ShortlistedMatch[]>()
    for (const m of shortlist) {
      const key = m.date.slice(0, 16)
      const list = bySlot.get(key) ?? []
      list.push(m)
      bySlot.set(key, list)
    }
    return [...bySlot.values()].filter((list) => list.length > 1)
  }, [shortlist])

  function applyDayRouteToShortlist() {
    if (!dayRoute || dayRoute.stops.length === 0) return
    let next = shortlist.slice()
    for (const stop of dayRoute.stops) {
      if (next.some((s) => s.gameId === stop.game.gameId)) continue
      next = toggleShortlist(stop.game, next)
    }
    setShortlist(next)
    setShowShortlistOnly(true)
    setShowTravel(true)
  }

  const scoutAskContext = useMemo(
    () => ({
      from: fromIso,
      to: toIso,
      baseQuery: basePlace?.query,
      baseLat: basePlace?.lat,
      baseLon: basePlace?.lon,
      gender: filters.gender,
      ageCategory: filters.ageCategory === 'all' ? undefined : filters.ageCategory,
      query: filters.query || undefined,
    }),
    [fromIso, toIso, basePlace, filters.gender, filters.ageCategory, filters.query],
  )

  function addAskMatchesToShortlist(matches: ScoutAskMatch[]) {
    let next = shortlist.slice()
    for (const m of matches) {
      if (next.some((s) => s.gameId === m.gameId)) continue
      next.push({
        gameId: m.gameId,
        date: m.date,
        home: m.home,
        away: m.away,
        competitionName: m.competitionName,
        location: m.location,
        url: m.url,
        savedAt: new Date().toISOString(),
      })
    }
    saveShortlist(next)
    setShortlist(next)
    setShowShortlistOnly(true)
  }

  const askExamples = useMemo(
    () =>
      buildAskExamples({
        baseQuery: basePlace?.query,
        watchTeams,
        shortlistCount: shortlist.length,
      }),
    [basePlace?.query, watchTeams, shortlist.length],
  )

  function enrichAskMessage(text: string) {
    const bits: string[] = []
    if (watchTeams.length > 0) bits.push(`Bevakade lag: ${watchTeams.join(', ')}`)
    if (shortlist.length > 0) {
      bits.push(
        `Sparade matcher: ${shortlist
          .slice(0, 10)
          .map((m) => `${m.home}–${m.away} ${m.date.slice(11, 16)}`)
          .join('; ')}`,
      )
    }
    if (bits.length === 0) return text
    return `${text}\n\n(Kontext från sidan: ${bits.join('. ')})`
  }

  function persistAskSession(partial: {
    draft?: string
    answer?: string | null
    matches?: ScoutAskMatch[]
    tab?: 'ask' | 'route' | 'along'
  }) {
    saveLastAsk({
      draft: partial.draft ?? askDraft,
      answer: partial.answer !== undefined ? partial.answer : (askResult?.answer ?? null),
      matches: partial.matches ?? askResult?.matches,
      tab: partial.tab ?? assistantTab,
      alongFrom,
      alongTo,
      alongDay,
      alongTime,
      canA,
      canB,
    })
  }

  async function submitAsk(message?: string) {
    const text = (message ?? askDraft).trim()
    if (!text) return
    setAskDraft(text)
    setAssistantTab('ask')
    setShowChat(true)
    setAskBusy(true)
    setAskError(null)
    try {
      const result = await askScoutApi(enrichAskMessage(text), scoutAskContext)
      setAskResult(result)
      persistAskSession({ draft: text, answer: result.answer, matches: result.matches, tab: 'ask' })
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Kunde inte fråga')
    } finally {
      setAskBusy(false)
    }
  }

  async function submitCanMake() {
    const a = canA.trim()
    const b = canB.trim()
    if (!a || !b) return
    await submitAsk(`Hinner jag se ${a} och sedan ${b}?`)
  }

  async function submitAlongRoute() {
    setAlongBusy(true)
    setAlongError(null)
    setAssistantTab('along')
    setShowChat(true)
    try {
      const day = alongDay || toDateParam(new Date())
      const result = await alongRouteApi({
        fromPlace: alongFrom,
        toPlace: alongTo,
        departTime: alongTime,
        day,
        context: { ...scoutAskContext, from: day, to: day },
      })
      const mapped: ScoutAskResult = {
        answer: result.summary,
        matches: result.matches,
        toolsUsed: ['matches_along_route'],
        mode: 'rules',
      }
      setAlongResult(mapped)
      persistAskSession({ tab: 'along' })
    } catch (err) {
      setAlongError(err instanceof Error ? err.message : 'Kunde inte söka längs vägen')
    } finally {
      setAlongBusy(false)
    }
  }

  const gameCount = focused.length
  const totalGames = countGames(data?.competitions ?? [])

  const dateHeadline =
    mode === 'single' || isSameDay(from, to)
      ? format(from, 'd MMMM yyyy', { locale: sv })
      : `${format(from, 'd MMM', { locale: sv })} – ${format(to, 'd MMM yyyy', { locale: sv })}`
  const multiDay = !isSameDay(from, to)
  const showDayHeaders = multiDay && !(sortByDistance && basePlace)

  const timelineSections = useMemo(() => {
    if (!showDayHeaders) {
      return [{ key: 'all', label: null as string | null, games: timeline }]
    }
    const sections: { key: string; label: string; games: FlatGame[] }[] = []
    for (const game of timeline) {
      const key = dayKey(game.date)
      const last = sections[sections.length - 1]
      if (last && last.key === key) last.games.push(game)
      else sections.push({ key, label: kickoffDayLong(game.date), games: [game] })
    }
    return sections
  }, [timeline, showDayHeaders])

  function goToday() {
    navigateSeo('today')
    const today = new Date()
    setMode('single')
    setSingle(today)
    setRange({ from: today, to: today })
    setFocus('overview')
    setTeamFocus(null)
    if (watchTeams.length > 0) setPreset('watch')
    setCalendarOpen(false)
  }

  function goTomorrow() {
    navigateSeo('tomorrow')
    const d = addDays(new Date(), 1)
    setMode('single')
    setSingle(d)
    setRange({ from: d, to: d })
    setFocus('all')
    setTeamFocus(null)
    if (watchTeams.length > 0) setPreset('watch')
    setCalendarOpen(false)
  }

  function toggleCompetition(id: number) {
    setFilters((prev) => {
      const next = new Set(prev.competitions)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, competitions: next }
    })
  }

  async function copyShareLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  async function copyShortlistShareLink() {
    if (shortlist.length === 0) return
    await navigator.clipboard.writeText(shortlistShareUrl(shortlist))
    setListaCopied(true)
    window.setTimeout(() => setListaCopied(false), 1800)
  }

  function applySavedView(view: SavedView) {
    setFilters((f) => ({
      ...f,
      gender: view.gender,
      ageCategory: view.ageCategory,
      districtId: view.districtId,
      query: view.query,
      competitions: new Set(),
    }))
    setPreset(view.preset)
    setTeamFocus(null)
    setClusterId(null)
  }

  function saveCurrentView() {
    const name = viewNameDraft.trim()
    if (!name) return
    setSavedViews(
      addSavedView(
        {
          name,
          gender: filters.gender,
          ageCategory: filters.ageCategory,
          districtId: filters.districtId,
          query: filters.query,
          preset,
        },
        savedViews,
      ),
    )
    setViewNameDraft('')
  }

  function openTomorrowWatch() {
    const d = addDays(new Date(), 1)
    setMode('single')
    setSingle(d)
    setRange({ from: d, to: d })
    setPreset('watch')
    setFocus('all')
    setShowShortlistOnly(false)
    setTeamFocus(null)
    setClusterId(null)
    setCalendarOpen(false)
    setShowTomorrowBanner(false)
  }

  function exportShortlistIcs() {
    if (shortlist.length === 0) return
    downloadIcs(`scoutlista-${fromIso}.ics`, buildShortlistIcs(shortlist))
  }

  function exportShortlistCsvFile() {
    if (shortlist.length === 0) return
    downloadShortlistCsv(`scoutlista-${fromIso}.csv`, shortlist)
  }

  function exportShortlistJsonFile() {
    if (shortlist.length === 0) return
    downloadShortlistJson(`scoutlista-${fromIso}.json`, shortlist)
  }

  async function saveBase() {
    const q = baseDraft.trim()
    if (!q) {
      setBasePlace(null)
      saveBasePlace(null)
      setSortByDistance(false)
      setBaseError(null)
      return
    }
    setBaseBusy(true)
    setBaseError(null)
    try {
      const point = await fetchGeocode(q)
      if (!point) {
        setBaseError('Hittade ingen ort. Prova t.ex. "Stockholm" eller "Malmö".')
        return
      }
      const place: BasePlace = {
        query: q,
        lat: point.lat,
        lon: point.lon,
        label: point.label,
      }
      setBasePlace(place)
      saveBasePlace(place)
      setSortByDistance(true)
    } catch (err) {
      setBaseError(err instanceof Error ? err.message : 'Kunde inte spara basort')
    } finally {
      setBaseBusy(false)
    }
  }

  const shortlistIds = useMemo(() => new Set(shortlist.map((s) => s.gameId)), [shortlist])
  const watchSet = useMemo(
    () => new Set(watchTeams.map((t) => t.toLowerCase())),
    [watchTeams],
  )

  const leagueListForLayout =
    layout === 'league'
      ? filteredCompetitions
          .map((c) => ({
            ...c,
            games: c.games.filter((g) => focused.some((f) => f.gameId === g.gameId)),
          }))
          .filter((c) => c.games.length > 0)
      : []

  const metaTitle = useMemo(() => {
    const day =
      mode === 'single' || isSameDay(from, to)
        ? format(from, 'd MMM yyyy', { locale: sv })
        : `${format(from, 'd MMM', { locale: sv })}–${format(to, 'd MMM', { locale: sv })}`
    if (preset === 'watch' && watchTeams.length > 0) {
      return `Mina lag · ${day} | Svenska Matcher`
    }
    if (focus === 'results') return `Resultat · ${day} | Svenska Matcher`
    if (focus === 'live') return `Pågående matcher · ${day} | Svenska Matcher`
    return `Svenska fotbollsmatcher · ${day} | Svenska Matcher`
  }, [mode, from, to, preset, watchTeams.length, focus])

  useDocumentMeta({
    title: metaTitle,
    description: DEFAULT_DESC,
  })

  useEffect(() => {
    if (watchTeams.length >= 2 && showOnboarding) {
      completeOnboarding()
      setShowOnboarding(false)
    }
  }, [watchTeams.length, showOnboarding])

  useEffect(() => {
    if (!showChat) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowChat(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showChat])

  useEffect(() => {
    if (!showChat || assistantTab !== 'ask') return
    askInputRef.current?.focus()
  }, [showChat, assistantTab])

  function renderAskMatches(result: ScoutAskResult, opts?: { listFirst?: boolean }) {
    const listFirst = opts?.listFirst ?? false
    const showAnswer = Boolean(result.answer) && (!listFirst || result.matches.length === 0)
    return (
      <div className="ask-result">
        {showAnswer && <p className="ask-answer">{result.answer}</p>}
        {listFirst && result.matches.length > 0 && (
          <p className="hint inline-hint">Välj en eller några att stanna för.</p>
        )}
        {result.matches.length > 0 && (
          <>
            <ul className="ask-match-list">
              {result.matches.map((m) => (
                <li key={m.gameId}>
                  <strong>
                    {m.date.slice(0, 10)} {m.date.slice(11, 16)}
                  </strong>{' '}
                  {m.home} – {m.away}
                  <br />
                  <span>
                    {m.location} · {m.competitionName}
                  </span>
                  <br />
                  <span className="foot-links">
                    {m.lat != null && m.lon != null && (
                      <a
                        className="maps-link"
                        href={mapsPlaceUrl({ lat: m.lat, lon: m.lon })}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Maps
                      </a>
                    )}
                    <a href={matchUrl(m.url)} target="_blank" rel="noreferrer">
                      Detaljer
                    </a>
                  </span>
                </li>
              ))}
            </ul>
            <div className="return-actions">
              <button
                type="button"
                className="chip active"
                onClick={() => addAskMatchesToShortlist(result.matches)}
              >
                Lägg i mina matcher
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="page app-shell">
      <header className="hero">
        <p className="eyebrow">Svensk fotboll</p>
        <h1 className="brand">Svenska Matcher</h1>
        <p className="lede">Välj datum, hitta matcher — fråga assistenten nere till höger.</p>
      </header>

      {showTomorrowBanner && tomorrowWatchCount != null && tomorrowWatchCount > 0 && (
        <div className="return-banner panel no-print" role="status">
          <p>
            Imorgon: <strong>{tomorrowWatchCount}</strong> matcher för dina bevakade lag.
          </p>
          <div className="return-actions">
            <button type="button" className="chip active" onClick={openTomorrowWatch}>
              Visa imorgon
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                dismissTomorrowBanner(toDateParam(addDays(new Date(), 1)))
                setShowTomorrowBanner(false)
              }}
            >
              Senare
            </button>
          </div>
        </div>
      )}

      {importNotice && (
        <div className="return-banner panel no-print" role="status">
          <p>{importNotice}</p>
          <button type="button" className="chip" onClick={() => setImportNotice(null)}>
            Stäng
          </button>
        </div>
      )}

      {showOnboarding && (
        <div className="return-banner panel onboarding-banner no-print" role="status">
          <div>
            <p className="banner-kicker">Kom igång</p>
            <p>
              Bevaka <strong>2 lag</strong> med ★ Hem / ★ Borta — nästa gång startar du på Mina lag
              och får tips om matcher imorgon.
            </p>
            <p className="hint inline-hint">
              Steg {Math.min(watchTeams.length, 2)}/2
              {watchTeams.length > 0 ? ` · ${watchTeams.slice(0, 2).join(', ')}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="chip"
            onClick={() => {
              completeOnboarding()
              setShowOnboarding(false)
            }}
          >
            Senare
          </button>
        </div>
      )}

      {install.visible && (
        <div className="return-banner panel install-banner no-print" role="status">
          <div>
            <p className="banner-kicker">Snabbare återbesök</p>
            <p>
              {install.canPrompt
                ? 'Lägg till Svenska Matcher på hemskärmen — öppna som en app på matchdagen.'
                : install.isIos
                  ? 'På iPhone: dela-knappen → “Lägg till på hemskärmen”.'
                  : 'Lägg till på hemskärmen via webbläsarens meny för snabbare öppning.'}
            </p>
          </div>
          <div className="return-actions">
            {install.canPrompt && (
              <button type="button" className="chip active" onClick={() => void install.install()}>
                Lägg till på hemskärmen
              </button>
            )}
            <button type="button" className="chip" onClick={install.dismiss}>
              Inte nu
            </button>
          </div>
        </div>
      )}

      <section className="quickbar panel" aria-label="Hitta matcher">
        <div className="quick-dates" role="group" aria-label="Datum">
          <button type="button" className={`chip ${viewingToday ? 'active' : ''}`} onClick={goToday}>
            Idag
          </button>
          <button
            type="button"
            className={`chip ${isSameDay(single, addDays(now, 1)) && mode === 'single' ? 'active' : ''}`}
            onClick={goTomorrow}
          >
            Imorgon
          </button>
          <button
            type="button"
            className={`chip ${calendarOpen ? 'active' : ''}`}
            onClick={() => setCalendarOpen((o) => !o)}
            aria-expanded={calendarOpen}
          >
            Annat datum
          </button>
        </div>

        {!showShortlistOnly && (
          <>
            <label className="field compact search-primary">
              <span className="sr-only">Sök lag, arena eller liga</span>
              <input
                type="search"
                placeholder="Sök lag, arena eller liga…"
                value={filters.query}
                onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              />
            </label>

            <div className="focus-row" role="group" aria-label="Visa">
              {(
                [
                  ['all', 'Alla'],
                  ['elit', 'Elit'],
                  ['ungdom', 'Ungdom'],
                  ['dam', 'Dam'],
                  ['watch', watchTeams.length > 0 ? `Mina lag (${watchTeams.length})` : 'Mina lag'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`chip ${preset === key ? 'active' : ''}`}
                  onClick={() => setPreset(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {preset === 'ungdom' && (
              <div className="chip-row tight" role="group" aria-label="Åldersnivå">
                {YOUTH_AGE_CHIPS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`chip ${youthChip === tag ? 'active' : ''}`}
                    onClick={() => setYouthChip((c) => (c === tag ? null : tag))}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="focus-row tools-row" role="group" aria-label="Verktyg">
          <button
            type="button"
            className={`chip ${showShortlistOnly ? 'active' : ''}`}
            title="Sparade matcher"
            onClick={() => setShowShortlistOnly((v) => !v)}
          >
            Mina matcher{shortlist.length > 0 ? ` (${shortlist.length})` : ''}
          </button>
        </div>

        {showShortlistOnly && (
          <div className="shortlist-toolbar no-print">
            <p className="cluster-lede">
              {shortlist.length === 0
                ? 'Tomt än. Öppna en match och tryck “+ Spara”.'
                : `${shortlist.length} sparade matcher.`}
            </p>
            {shortlist.length > 0 && (
              <div className="chip-row tight">
                <button type="button" className="chip" onClick={() => void copyShortlistShareLink()}>
                  {listaCopied ? 'Länk kopierad' : 'Dela'}
                </button>
                <button
                  type="button"
                  className={`chip ${showTravel ? 'active' : ''}`}
                  onClick={() => setShowTravel((v) => !v)}
                >
                  Resplan
                </button>
                <details className="export-menu">
                  <summary className="chip">Exportera</summary>
                  <div className="export-menu-items">
                    <button type="button" className="chip" onClick={exportShortlistIcs}>
                      Kalender (.ics)
                    </button>
                    <button type="button" className="chip" onClick={exportShortlistCsvFile}>
                      CSV
                    </button>
                    <button type="button" className="chip" onClick={exportShortlistJsonFile}>
                      JSON
                    </button>
                    <button type="button" className="chip" onClick={() => window.print()}>
                      Skriv ut
                    </button>
                  </div>
                </details>
                <button type="button" className="chip" onClick={() => setShowShortlistOnly(false)}>
                  Tillbaka
                </button>
              </div>
            )}
          </div>
        )}

        {shortlistConflicts.length > 0 && showShortlistOnly && (
          <p className="hint warn">
            Tidskonflikt: {shortlistConflicts.length} kickoff-tider har flera matcher.
            {showTravel ? '' : ' Öppna Resplan.'}
          </p>
        )}

        {showTravel && shortlist.length > 0 && (
          <section className="travel-plan panel no-print" aria-label="Resplan">
            <h3>Resplan</h3>
            <p className="cluster-lede">{travelPlanSummary(travelStops, basePlace)}</p>
            {travelMapsUrl && (
              <div className="return-actions" style={{ marginBottom: '0.55rem' }}>
                <a className="chip active maps-chip" href={travelMapsUrl} target="_blank" rel="noreferrer">
                  Öppna i Google Maps
                </a>
              </div>
            )}
            <ol className="travel-list">
              {travelStops.map((stop) => (
                <li key={stop.match.gameId} className={stop.conflict ? 'conflict' : ''}>
                  <strong>
                    {stop.match.date.slice(0, 10)} {stop.match.date.slice(11, 16)}
                  </strong>{' '}
                  {stop.match.home} – {stop.match.away}
                  <br />
                  <span>
                    {stop.match.location}
                    {stop.driveMinutes != null
                      ? ` · ${formatKm(stop.kmFromPrev)} · ${formatDrive(stop.driveMinutes)}`
                      : ''}
                    {stop.gapMinutes != null
                      ? ` · ${stop.gapMinutes >= 0 ? `${stop.gapMinutes} min efter föregående` : 'överlapp'}`
                      : ''}
                    {stop.conflict ? ' · tidskonflikt' : ''}
                  </span>
                  {stop.lat != null && stop.lon != null && (
                    <>
                      <br />
                      <a
                        className="maps-link"
                        href={mapsPlaceUrl({ lat: stop.lat, lon: stop.lon })}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Navigera hit
                      </a>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        <details className="more-filters">
          <summary>Mer filter</summary>
          <div className="layout-row">
            <div className="chip-row tight" role="group" aria-label="Kön">
              {(['all', 'Man', 'Kvinna'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`chip ${filters.gender === g ? 'active' : ''}`}
                  onClick={() => setFilters((f) => ({ ...f, gender: g }))}
                >
                  {g === 'all' ? 'Alla' : g === 'Man' ? 'Herr' : 'Dam'}
                </button>
              ))}
            </div>
            <div className="chip-row tight" role="group" aria-label="Vy">
              <button
                type="button"
                className={`chip ${layout === 'timeline' ? 'active' : ''}`}
                onClick={() => setLayout('timeline')}
              >
                Tidslinje
              </button>
              <button
                type="button"
                className={`chip ${layout === 'league' ? 'active' : ''}`}
                onClick={() => setLayout('league')}
              >
                Per liga
              </button>
            </div>
          </div>
          <div className="chip-row tight">
            <button type="button" className="chip" onClick={copyShareLink}>
              {copied ? 'Länk kopierad' : 'Dela den här vyn'}
            </button>
          </div>
          <div className="chip-row" role="group" aria-label="Ålderskategori">
            <button
              type="button"
              className={`chip ${filters.ageCategory === 'all' ? 'active' : ''}`}
              onClick={() => setFilters((f) => ({ ...f, ageCategory: 'all' }))}
            >
              Alla åldrar
            </button>
            {ages.map((age) => (
              <button
                key={age}
                type="button"
                className={`chip ${filters.ageCategory === age ? 'active' : ''}`}
                onClick={() => setFilters((f) => ({ ...f, ageCategory: age }))}
              >
                {age}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Distrikt (hemmalag eller bortalag)</span>
            <select
              value={filters.districtId === 'all' ? 'all' : String(filters.districtId)}
              onChange={(e) => {
                const v = e.target.value
                setFilters((f) => ({
                  ...f,
                  districtId: v === 'all' ? 'all' : Number(v),
                }))
              }}
            >
              <option value="all">Alla distrikt</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          <div className="league-block">
            <button
              type="button"
              className="league-toggle"
              aria-expanded={leagueOpen}
              onClick={() => setLeagueOpen((o) => !o)}
            >
              Ligor
              <span>
                {filters.competitions.size > 0 ? `${filters.competitions.size} valda` : 'Alla'}
              </span>
            </button>
            {leagueOpen && (
              <div className="league-list">
                {(data?.competitions ?? []).map((c) => (
                  <label key={c.competitionId} className="league-item">
                    <input
                      type="checkbox"
                      checked={
                        filters.competitions.size === 0
                          ? false
                          : filters.competitions.has(c.competitionId)
                      }
                      onChange={() => toggleCompetition(c.competitionId)}
                    />
                    <span>
                      <strong>{c.name}</strong>
                      <small>
                        {genderShort(c.genderName)} · {c.ageCategoryName} · {c.games.length} matcher
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {watchTeams.length > 0 && (
            <p className="hint">
              Bevakade lag: {watchTeams.join(', ')}
            </p>
          )}

          <div className="saved-views">
            <label className="field">
              <span>Sparade vyer</span>
              <div className="base-row">
                <input
                  type="text"
                  placeholder="Namn, t.ex. Stockholm ungdom"
                  value={viewNameDraft}
                  onChange={(e) => setViewNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      saveCurrentView()
                    }
                  }}
                />
                <button type="button" className="chip" onClick={saveCurrentView}>
                  Spara vy
                </button>
              </div>
            </label>
            {savedViews.length > 0 && (
              <ul className="saved-view-list">
                {savedViews.map((view) => (
                  <li key={view.id}>
                    <button type="button" className="chip" onClick={() => applySavedView(view)}>
                      {view.name}
                    </button>
                    <button
                      type="button"
                      className="chip ghost"
                      aria-label={`Ta bort ${view.name}`}
                      onClick={() => setSavedViews(removeSavedView(view.id, savedViews))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="base-place">
            <label className="field">
              <span>Basort (avstånd & dagsrutt)</span>
              <div className="base-row">
                <input
                  type="text"
                  placeholder="T.ex. Göteborg"
                  value={baseDraft}
                  onChange={(e) => setBaseDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void saveBase()
                    }
                  }}
                />
                <button type="button" className="chip" disabled={baseBusy} onClick={() => void saveBase()}>
                  {baseBusy ? 'Sparar…' : 'Spara'}
                </button>
                {basePlace && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setBasePlace(null)
                      saveBasePlace(null)
                      setBaseDraft('')
                      setSortByDistance(false)
                    }}
                  >
                    Rensa
                  </button>
                )}
              </div>
            </label>
            {basePlace && (
              <div className="chip-row tight">
                <button
                  type="button"
                  className={`chip ${sortByDistance ? 'active' : ''}`}
                  onClick={() => setSortByDistance((v) => !v)}
                >
                  Närmast först
                </button>
                <p className="hint inline-hint">Från {basePlace.query}</p>
              </div>
            )}
            {baseError && <p className="hint warn">{baseError}</p>}
          </div>
        </details>
      </section>

      {calendarOpen && (
        <section className="controls calendar-open" aria-label="Kalender">
          <div className="panel calendar-panel">
            <div className="mode-toggle" role="group" aria-label="Datumläge">
              <button
                type="button"
                className={mode === 'single' ? 'active' : ''}
                onClick={() => {
                  setMode('single')
                  setSingle(range?.from ?? single)
                }}
              >
                Ett datum
              </button>
              <button
                type="button"
                className={mode === 'range' ? 'active' : ''}
                onClick={() => {
                  setMode('range')
                  setRange({ from: single, to: single })
                }}
              >
                Intervall
              </button>
            </div>

            {mode === 'single' ? (
              <DayPicker
                mode="single"
                locale={dayPickerSv}
                selected={single}
                onSelect={(d) => {
                  if (!d) return
                  setSingle(d)
                  setCalendarOpen(false)
                }}
                defaultMonth={single}
                weekStartsOn={1}
              />
            ) : (
              <DayPicker
                mode="range"
                locale={dayPickerSv}
                selected={range}
                onSelect={setRange}
                defaultMonth={range?.from ?? single}
                weekStartsOn={1}
                numberOfMonths={months}
              />
            )}

            {mode === 'range' && range?.from && range?.to && rangeLength(range) > MAX_RANGE_DAYS && (
              <p className="hint warn">
                Max {MAX_RANGE_DAYS} dagar per sökning – välj ett kortare intervall.
              </p>
            )}
          </div>
        </section>
      )}

      <section className="results" aria-live="polite">
        <div className="results-head">
          <div>
            <h2>{dateHeadline}</h2>
            <p>
              {loading
                ? 'Hämtar matcher…'
                : error
                  ? 'Kunde inte ladda'
                  : focus === 'results'
                    ? `${gameCount} slutresultat${gameCount !== phases.done ? '' : ''}`
                    : `${gameCount} matcher${gameCount !== totalGames ? ` av ${totalGames}` : ''}${
                        phases.live > 0 ? ` · ${phases.live} pågår` : ''
                      }${phases.soon > 0 ? ` · ${phases.soon} snart` : ''}${
                        phases.done > 0 && focus === 'all' ? ` · ${phases.done} klara` : ''
                      }`}
            </p>
          </div>
          {loading && <div className="spinner" aria-hidden />}
        </div>

        {!loading && !error && scouted.length > 0 && (
          <div className="phase-strip no-print" aria-label="Matchstatus">
            <button type="button" className={`phase-pill ${focus === 'live' ? 'active' : ''}`} onClick={() => setFocus('live')}>
              <span className="dot live" /> Pågår <strong>{phases.live}</strong>
            </button>
            <button type="button" className={`phase-pill ${focus === 'soon' ? 'active' : ''}`} onClick={() => setFocus('soon')}>
              <span className="dot soon" /> Snart <strong>{phases.soon}</strong>
            </button>
            <button type="button" className={`phase-pill ${focus === 'results' ? 'active' : ''}`} onClick={() => setFocus('results')}>
              <span className="dot done" /> Resultat <strong>{phases.done}</strong>
            </button>
            <button type="button" className={`phase-pill ${focus === 'overview' ? 'active' : ''}`} onClick={() => setFocus('overview')}>
              Kommande <strong>{phases.live + phases.soon + phases.later}</strong>
            </button>
          </div>
        )}

        {error && <p className="error-box">{error}</p>}

        {(teamFocus || clusterId) && (
          <div className="focus-banner no-print">
            {teamFocus && (
              <p>
                Visar matcher för <strong>{teamFocus}</strong> i valt intervall.
              </p>
            )}
            {clusterId && (
              <p>
                Visar kluster:{' '}
                <strong>{clusters.find((c) => c.id === clusterId)?.label ?? 'valt'}</strong>
              </p>
            )}
            <button
              type="button"
              className="chip"
              onClick={() => {
                setTeamFocus(null)
                setClusterId(null)
              }}
            >
              Visa alla
            </button>
          </div>
        )}

        {!loading && !error && !teamFocus && clusters.length > 0 && (
          <details className="clusters panel no-print" aria-label="Samma arena eller distrikt">
            <summary>
              Samma arena / distrikt ({clusters.length})
            </summary>
            <ul className="cluster-list">
              {clusters.slice(0, 8).map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`cluster-btn ${clusterId === c.id ? 'active' : ''}`}
                    onClick={() => setClusterId((id) => (id === c.id ? null : c.id))}
                  >
                    <span className="cluster-count">{c.games.length}</span>
                    <span className="cluster-body">
                      <strong>{c.label}</strong>
                      <small>
                        {c.dayLabel} · {c.kind === 'venue' ? 'Arena' : 'Distrikt'}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="print-only print-plan">
          <h2>Dagsplan · {dateHeadline}</h2>
          <p>
            {gameCount} matcher
            {basePlace ? ` · från ${basePlace.query}` : ''}
            {teamFocus ? ` · lag: ${teamFocus}` : ''}
          </p>
          <ol>
            {timeline.map((g) => {
              const meta = venueMeta.get(g.gameId)
              return (
                <li key={g.gameId}>
                  <strong>
                    {multiDay ? `${kickoffDayShort(g.date)} ${kickoffClock(g.date)}` : kickoffClock(g.date)}
                  </strong>{' '}
                  {g.homeTeam.name.trim()} – {g.awayTeam.name.trim()}
                  {shouldShowScore(g, now)
                    ? ` (${g.score.home}–${g.score.away}${scoreTag(matchPhase(g, now), g.status) ? ` ${scoreTag(matchPhase(g, now), g.status)}` : ''})`
                    : ''}
                  <br />
                  <span>
                    {g.location}
                    {meta?.km != null ? ` · ${formatKm(meta.km)}` : ''}
                    {meta?.weather?.summary ? ` · ${meta.weather.summary}` : ''}
                  </span>
                  <br />
                  <span>{g.competitionName}</span>
                </li>
              )
            })}
          </ol>
        </div>

        {!loading && !error && gameCount === 0 && (
          <div className="empty-box">
            <p className="empty">
              {teamFocus
                ? `Inga matcher för ${teamFocus} i valt intervall/filter.`
                : showShortlistOnly
                  ? 'Inga sparade matcher än. Öppna en match och tryck “+ Spara”.'
                  : preset === 'watch'
                    ? watchTeams.length === 0
                      ? 'Inga bevakade lag ännu.'
                      : 'Inga matcher för bevakade lag just nu.'
                    : focus === 'live'
                      ? 'Inga matcher pågår just nu.'
                      : focus === 'results'
                        ? 'Inga slutresultat i valt urval ännu.'
                        : 'Inga matcher matchar filtren.'}
            </p>
            <div className="empty-actions">
              {preset === 'watch' && watchTeams.length === 0 && (
                <p className="hint">
                  Tipsa: öppna en match och tryck ★ Hem / ★ Borta — nästa gång startar du på Mina lag.
                </p>
              )}
              {preset === 'watch' && watchTeams.length > 0 && (
                <button type="button" className="chip" onClick={() => setPreset('all')}>
                  Visa alla matcher
                </button>
              )}
              {showShortlistOnly && (
                <button type="button" className="chip" onClick={() => setShowShortlistOnly(false)}>
                  Visa alla matcher
                </button>
              )}
              {teamFocus && (
                <button type="button" className="chip" onClick={() => setTeamFocus(null)}>
                  Visa alla lag
                </button>
              )}
              {!teamFocus && !showShortlistOnly && preset !== 'watch' && (
                <button type="button" className="chip" onClick={goTomorrow}>
                  Prova imorgon
                </button>
              )}
            </div>
          </div>
        )}

        {layout === 'timeline' ? (
          <div className="timeline-wrap">
            {timelineSections.map((section) => (
              <section key={section.key} className="day-section">
                {section.label && (
                  <h3 className="day-heading">
                    <time dateTime={section.key}>{section.label}</time>
                  </h3>
                )}
                <ul className="timeline">
                  {section.games.map((game, index) => (
                    <TimelineGame
                      key={game.gameId}
                      game={game}
                      now={now}
                      showDate={multiDay && !showDayHeaders}
                      meta={venueMeta.get(game.gameId)}
                      watched={watchSet}
                      shortlisted={shortlistIds.has(game.gameId)}
                      note={notes[String(game.gameId)] ?? ''}
                      noteOpen={noteGameId === game.gameId}
                      onSelectTeam={(name) => {
                        setClusterId(null)
                        setTeamFocus(name)
                        setLastScouted(
                          pushLastScouted(
                            {
                              gameId: 0,
                              label: name,
                              date: fromIso,
                            },
                            lastScouted,
                          ),
                        )
                        navigateSeo('team', { team: name })
                      }}
                      onToggleWatch={(name) => setWatchTeams(toggleWatchTeam(name, watchTeams))}
                      onToggleShortlist={() => {
                        const next = toggleShortlist(game, shortlist)
                        setShortlist(next)
                        setLastScouted(
                          pushLastScouted(
                            {
                              gameId: game.gameId,
                              label: `${game.homeTeam.name.trim()} – ${game.awayTeam.name.trim()}`,
                              date: game.date,
                            },
                            lastScouted,
                          ),
                        )
                      }}
                      onToggleNote={() =>
                        setNoteGameId((id) => (id === game.gameId ? null : game.gameId))
                      }
                      onNoteChange={(value) => setNotes(saveNote(game.gameId, value, notes))}
                      style={{ animationDelay: `${Math.min(index, 16) * 28}ms` }}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <div className="competition-stack">
            {leagueListForLayout.map((competition, index) => (
              <CompetitionBlock
                key={competition.competitionId}
                competition={competition}
                now={now}
                showDate={multiDay}
                venueMeta={venueMeta}
                watched={watchSet}
                shortlistIds={shortlistIds}
                notes={notes}
                noteGameId={noteGameId}
                onSelectTeam={(name) => {
                  setClusterId(null)
                  setTeamFocus(name)
                  navigateSeo('team', { team: name })
                }}
                onToggleWatch={(name) => setWatchTeams(toggleWatchTeam(name, watchTeams))}
                onToggleShortlist={(game) => setShortlist(toggleShortlist(game, shortlist))}
                onToggleNote={(id) => setNoteGameId((cur) => (cur === id ? null : id))}
                onNoteChange={(id, value) => setNotes(saveNote(id, value, notes))}
                style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="footer">
        <h2 className="footer-title">Svenska fotbollsmatcher för scouting</h2>
        <p>
          Svenska Matcher hjälper dig att hitta matcher att scouta i Sverige — herr, dam och ungdom.
          Filtrera på datum, distrikt och liga. Använd Fråga-knappen för dagsrutt, bilresa och
          om du hinner mellan matcher — navigera dit via Google Maps.
        </p>
        <p>
          Anteckningar, bevakning och sparade matcher ligger lokalt i din webbläsare.
        </p>
      </footer>

      <div className="chat-dock no-print">
        {showChat && (
          <section
            className="chat-panel ask-panel panel"
            aria-label="Fråga om matcher"
            role="dialog"
            aria-modal="false"
          >
            <header className="chat-panel-head">
              <div>
                <p className="banner-kicker">Assistent</p>
                <h3>Fråga om matcher</h3>
              </div>
              <button type="button" className="chip" onClick={() => setShowChat(false)}>
                Stäng
              </button>
            </header>

            <div className="chip-row tight plan-tabs" role="tablist" aria-label="Frågetyp">
              {(
                [
                  ['ask', 'Fråga'],
                  ['route', 'Samma dag'],
                  ['along', 'Längs vägen'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={assistantTab === key}
                  className={`chip ${assistantTab === key ? 'active' : ''}`}
                  onClick={() => {
                    setAssistantTab(key)
                    persistAskSession({ tab: key })
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="chat-panel-body">
              {assistantTab === 'ask' && (
                <>
                  <p className="cluster-lede">
                    Ställ en fråga om matcher
                    {basePlace ? ` · från ${basePlace.query}` : ''}
                    {watchTeams.length > 0 ? ` · ${watchTeams.length} bevakade` : ''}
                    {shortlist.length > 0 ? ` · ${shortlist.length} sparade` : ''}.
                  </p>
                  <div className="ask-examples">
                    {askExamples.map((ex) => (
                      <button
                        key={ex}
                        type="button"
                        className="chip"
                        disabled={askBusy}
                        onClick={() => void submitAsk(ex)}
                      >
                        {ex.length > 56 ? `${ex.slice(0, 54)}…` : ex}
                      </button>
                    ))}
                  </div>
                  <div className="can-make-row">
                    <p className="hint inline-hint">Hinner jag A sedan B?</p>
                    <div className="base-row">
                      <input
                        type="text"
                        aria-label="Första lag eller match"
                        placeholder="T.ex. AIK"
                        value={canA}
                        onChange={(e) => setCanA(e.target.value)}
                      />
                      <input
                        type="text"
                        aria-label="Andra lag eller match"
                        placeholder="T.ex. ungdomsmatch"
                        value={canB}
                        onChange={(e) => setCanB(e.target.value)}
                      />
                      <button
                        type="button"
                        className="chip"
                        disabled={askBusy || !canA.trim() || !canB.trim()}
                        onClick={() => void submitCanMake()}
                      >
                        Kolla
                      </button>
                    </div>
                  </div>
                  <label className="field">
                    <span className="sr-only">Din fråga</span>
                    <div className="base-row">
                      <input
                        ref={askInputRef}
                        type="text"
                        value={askDraft}
                        placeholder="T.ex. vilka matcher hinner jag i Stockholm?"
                        disabled={askBusy}
                        onChange={(e) => setAskDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void submitAsk()
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="chip active"
                        disabled={askBusy || !askDraft.trim()}
                        onClick={() => void submitAsk()}
                      >
                        {askBusy ? 'Söker…' : 'Fråga'}
                      </button>
                    </div>
                  </label>
                  {askError && <p className="hint warn">{askError}</p>}
                  {askResult && renderAskMatches(askResult)}
                </>
              )}

              {assistantTab === 'along' && (
                <>
                  <p className="cluster-lede">
                    Hitta matcher längs en bilresa. Välj avrese-datum och tid — dagens datum är
                    förvalt.
                  </p>
                  <div className="base-row along-inputs">
                    <input
                      type="text"
                      value={alongFrom}
                      aria-label="Från"
                      placeholder="Från"
                      onChange={(e) => setAlongFrom(e.target.value)}
                    />
                    <input
                      type="text"
                      value={alongTo}
                      aria-label="Till"
                      placeholder="Till"
                      onChange={(e) => setAlongTo(e.target.value)}
                    />
                  </div>
                  <div className="base-row along-inputs">
                    <input
                      type="date"
                      value={alongDay}
                      aria-label="Avresedatum"
                      min={toDateParam(new Date())}
                      onChange={(e) => setAlongDay(e.target.value)}
                    />
                    <input
                      type="time"
                      value={alongTime}
                      aria-label="Avresetid"
                      onChange={(e) => setAlongTime(e.target.value)}
                    />
                    <button
                      type="button"
                      className="chip active"
                      disabled={alongBusy || !alongFrom.trim() || !alongTo.trim() || !alongDay}
                      onClick={() => void submitAlongRoute()}
                    >
                      {alongBusy ? 'Söker…' : 'Sök'}
                    </button>
                  </div>
                  {alongError && <p className="hint warn">{alongError}</p>}
                  {alongResult && renderAskMatches(alongResult, { listFirst: true })}
                </>
              )}

              {assistantTab === 'route' && (
                <>
                  <p className="cluster-lede">
                    Föreslagen rutt bland matcherna du ser
                    {basePlace ? ` · från ${basePlace.query}` : ''}.
                  </p>
                  {!basePlace && (
                    <label className="field">
                      <span className="sr-only">Basort</span>
                      <div className="base-row">
                        <input
                          type="text"
                          placeholder="Var utgår du ifrån? t.ex. Göteborg"
                          value={baseDraft}
                          onChange={(e) => setBaseDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              void saveBase()
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="chip active"
                          disabled={baseBusy || !baseDraft.trim()}
                          onClick={() => void saveBase()}
                        >
                          {baseBusy ? '…' : 'Sätt bas'}
                        </button>
                      </div>
                    </label>
                  )}
                  <div className="chip-row tight" role="group" aria-label="Tid på plats">
                    <span className="hint inline-hint">Tid per match:</span>
                    {[45, 60, 90].map((m) => (
                      <button
                        key={m}
                        type="button"
                        className={`chip ${watchMinutes === m ? 'active' : ''}`}
                        onClick={() => setWatchMinutes(m)}
                      >
                        {m} min
                      </button>
                    ))}
                  </div>
                  {dayRoute && dayRoute.stops.length === 0 && (
                    <p className="hint warn">
                      Ingen rutt ännu.
                      {dayRoute.unmapped > 0
                        ? ` ${dayRoute.unmapped} matcher saknar plats på kartan.`
                        : ' Prova färre filter eller kortare tid på plats.'}
                    </p>
                  )}
                  {dayRoute && dayRoute.stops.length > 0 && (
                    <>
                      <p className="cluster-lede">
                        {dayRoute.stops.length} matcher · {formatKm(dayRoute.totalKm)} ·{' '}
                        {formatDrive(dayRoute.totalDriveMinutes)}
                        {dayRoute.skipped > 0 ? ` · ${dayRoute.skipped} hoppades över` : ''}
                      </p>
                      <ol className="travel-list">
                        {dayRoute.stops.map((stop, i) => (
                          <li key={stop.game.gameId}>
                            <strong>
                              {kickoffClock(stop.game.date)}
                              {i > 0
                                ? ` · ankomst ca ${clockFromMs(stop.arriveAt)}`
                                : ` · åk senast ${clockFromMs(stop.departAt)}`}
                            </strong>{' '}
                            {stop.game.homeTeam.name.trim()} – {stop.game.awayTeam.name.trim()}
                            <br />
                            <span>
                              {stop.game.location}
                              {stop.driveMinutesFromPrev > 0
                                ? ` · ${formatKm(stop.kmFromPrev)} · ${formatDrive(stop.driveMinutesFromPrev)}`
                                : i === 0 && basePlace
                                  ? ` · ${formatKm(stop.kmFromPrev)} från bas`
                                  : ''}
                              {stop.slackMinutes > 0
                                ? ` · ${stop.slackMinutes} min marginal`
                                : ''}
                            </span>
                            <br />
                            <a
                              className="maps-link"
                              href={mapsPlaceUrl({ lat: stop.lat, lon: stop.lon })}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Visa i Maps
                            </a>
                          </li>
                        ))}
                      </ol>
                      <div className="return-actions">
                        {dayRouteMapsUrl && (
                          <a
                            className="chip active maps-chip"
                            href={dayRouteMapsUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Navigera hela rutten
                          </a>
                        )}
                        <button type="button" className="chip" onClick={applyDayRouteToShortlist}>
                          Lägg i mina matcher
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        <button
          type="button"
          className={`chat-fab ${showChat ? 'open' : ''}`}
          aria-expanded={showChat}
          onClick={() => {
            setShowChat((v) => {
              const next = !v
              if (next && !canA && watchTeams.length > 0) {
                setCanA(watchTeams[0] ?? '')
                if (watchTeams.length >= 2) setCanB(watchTeams[1] ?? '')
              }
              return next
            })
          }}
        >
          <span className="chat-fab-label">{showChat ? 'Stäng' : 'Fråga'}</span>
        </button>
      </div>
    </div>
  )
}

function AgentActions({
  game,
  watched,
  shortlisted,
  note,
  noteOpen,
  onToggleWatch,
  onToggleShortlist,
  onToggleNote,
  onNoteChange,
}: {
  game: FlatGame
  watched: Set<string>
  shortlisted: boolean
  note: string
  noteOpen: boolean
  onToggleWatch: (name: string) => void
  onToggleShortlist: () => void
  onToggleNote: () => void
  onNoteChange: (value: string) => void
}) {
  const homeWatched = watched.has(game.homeTeam.name.trim().toLowerCase())
  const awayWatched = watched.has(game.awayTeam.name.trim().toLowerCase())
  return (
    <div className="agent-actions">
      <div className="agent-btns">
        <button
          type="button"
          className={`icon-btn ${homeWatched ? 'on' : ''}`}
          title="Bevaka hemmalag"
          onClick={() => onToggleWatch(game.homeTeam.name)}
        >
          ★ Hem
        </button>
        <button
          type="button"
          className={`icon-btn ${awayWatched ? 'on' : ''}`}
          title="Bevaka bortalag"
          onClick={() => onToggleWatch(game.awayTeam.name)}
        >
          ★ Borta
        </button>
        <button
          type="button"
          className={`icon-btn ${shortlisted ? 'on' : ''}`}
          title="Lägg i mina matcher"
          onClick={onToggleShortlist}
        >
          {shortlisted ? 'Sparad' : '+ Spara'}
        </button>
        <button type="button" className={`icon-btn ${note ? 'on' : ''}`} onClick={onToggleNote}>
          Anteckning
        </button>
      </div>
      {noteOpen && (
        <textarea
          className="note-box"
          rows={2}
          placeholder="Scoutanteckning (sparas lokalt)…"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
        />
      )}
      {!noteOpen && note && <p className="note-preview">{note}</p>}
    </div>
  )
}

function TimelineGame({
  game,
  now,
  showDate,
  meta,
  watched,
  shortlisted,
  note,
  noteOpen,
  onSelectTeam,
  onToggleWatch,
  onToggleShortlist,
  onToggleNote,
  onNoteChange,
  style,
}: {
  game: FlatGame
  now: Date
  showDate?: boolean
  meta?: {
    lat?: number
    lon?: number
    km: number | null
    weather: { summary: string } | null
  } | null
  watched: Set<string>
  shortlisted: boolean
  note: string
  noteOpen: boolean
  onSelectTeam: (name: string) => void
  onToggleWatch: (name: string) => void
  onToggleShortlist: () => void
  onToggleNote: () => void
  onNoteChange: (value: string) => void
  style?: CSSProperties
}) {
  const phase = matchPhase(game, now)
  const homeDistrict = districtName(game.homeTeamClubAssociationId)
  const mapsHref =
    meta?.lat != null && meta?.lon != null
      ? mapsPlaceUrl({ lat: meta.lat, lon: meta.lon })
      : game.location?.trim()
        ? mapsPlaceUrl(game.location.trim())
        : null
  return (
    <li className={`timeline-game phase-${phase} ${shortlisted ? 'shortlisted' : ''}`} style={style}>
      <div className="tl-time">
        {showDate && <span className="tl-day">{kickoffDayShort(game.date)}</span>}
        <span className="tl-clock">{kickoffClock(game.date)}</span>
        <span className={`tl-phase status-${game.status}`}>
          {phase === 'live' || phase === 'soon' ? phaseLabel(phase) : statusLabel(game.status)}
        </span>
        {(phase === 'soon' || phase === 'live') && (
          <span className="tl-rel">{relativeKickoff(game.date, now)}</span>
        )}
      </div>
      <div className="tl-body">
        <p className="tl-league">
          {game.competitionName}
          <span>
            {genderShort(game.genderName)} · {game.ageCategoryName} · {homeDistrict}
          </span>
        </p>
        <div className="teams compact">
          <TeamSide team={game.homeTeam} align="end" onSelectTeam={onSelectTeam} />
          <ScoreBoard game={game} now={now} />
          <TeamSide team={game.awayTeam} align="start" onSelectTeam={onSelectTeam} />
        </div>
        <div className="game-foot">
          <span>
            {game.location}
            {meta?.km != null ? ` · ${formatKm(meta.km)}` : ''}
            {meta?.weather?.summary ? ` · ${meta.weather.summary}` : ''}
            {game.note?.trim() ? ` · ${game.note.trim()}` : ''}
          </span>
          <span className="foot-links">
            {mapsHref && (
              <a className="maps-link" href={mapsHref} target="_blank" rel="noreferrer">
                Maps
              </a>
            )}
            <a href={matchUrl(game.url)} target="_blank" rel="noreferrer">
              Detaljer
            </a>
          </span>
        </div>
        <AgentActions
          game={game}
          watched={watched}
          shortlisted={shortlisted}
          note={note}
          noteOpen={noteOpen}
          onToggleWatch={onToggleWatch}
          onToggleShortlist={onToggleShortlist}
          onToggleNote={onToggleNote}
          onNoteChange={onNoteChange}
        />
      </div>
    </li>
  )
}

function CompetitionBlock({
  competition,
  now,
  showDate,
  venueMeta,
  watched,
  shortlistIds,
  notes,
  noteGameId,
  onSelectTeam,
  onToggleWatch,
  onToggleShortlist,
  onToggleNote,
  onNoteChange,
  style,
}: {
  competition: Competition
  now: Date
  showDate?: boolean
  venueMeta: Map<
    number,
    { lat?: number; lon?: number; km: number | null; weather: { summary: string } | null }
  >
  watched: Set<string>
  shortlistIds: Set<number>
  notes: Record<string, string>
  noteGameId: number | null
  onSelectTeam: (name: string) => void
  onToggleWatch: (name: string) => void
  onToggleShortlist: (game: FlatGame) => void
  onToggleNote: (id: number) => void
  onNoteChange: (id: number, value: string) => void
  style?: CSSProperties
}) {
  return (
    <article className="competition" style={style}>
      <header className="competition-head">
        <h3>{competition.name}</h3>
        <p>
          {genderShort(competition.genderName)} · {competition.ageCategoryName}
        </p>
      </header>
      <ul className="game-list">
        {competition.games.map((game) => {
          const flat: FlatGame = {
            ...game,
            competitionId: competition.competitionId,
            competitionName: competition.name,
            genderName: competition.genderName,
            ageCategoryName: competition.ageCategoryName,
          }
          const phase = matchPhase(flat, now)
          const meta = venueMeta.get(game.gameId)
          const mapsHref =
            meta?.lat != null && meta?.lon != null
              ? mapsPlaceUrl({ lat: meta.lat, lon: meta.lon })
              : game.location?.trim()
                ? mapsPlaceUrl(game.location.trim())
                : null
          return (
            <li
              key={game.gameId}
              className={`game phase-${phase} ${shortlistIds.has(game.gameId) ? 'shortlisted' : ''}`}
            >
              <div className="game-meta">
                <time dateTime={game.date}>
                  {showDate && <>{kickoffDayShort(game.date)} · </>}
                  {kickoffClock(game.date)}
                  {(phase === 'soon' || phase === 'live') && (
                    <> · {relativeKickoff(game.date, now)}</>
                  )}
                </time>
                <span className={`status status-${game.status}`}>
                  {phase === 'live' || phase === 'soon' ? phaseLabel(phase) : statusLabel(game.status)}
                </span>
              </div>
              <div className="teams">
                <TeamSide team={game.homeTeam} align="end" onSelectTeam={onSelectTeam} />
                <ScoreBoard game={game} now={now} />
                <TeamSide team={game.awayTeam} align="start" onSelectTeam={onSelectTeam} />
              </div>
              <div className="game-foot">
                <span>
                  {game.location}
                  {meta?.km != null ? ` · ${formatKm(meta.km)}` : ''}
                  {meta?.weather?.summary ? ` · ${meta.weather.summary}` : ''}
                  {game.note?.trim() ? ` · ${game.note.trim()}` : ''}
                </span>
                <span className="foot-links">
                  {mapsHref && (
                    <a className="maps-link" href={mapsHref} target="_blank" rel="noreferrer">
                      Maps
                    </a>
                  )}
                  <a href={matchUrl(game.url)} target="_blank" rel="noreferrer">
                    Detaljer
                  </a>
                </span>
              </div>
              <AgentActions
                game={flat}
                watched={watched}
                shortlisted={shortlistIds.has(game.gameId)}
                note={notes[String(game.gameId)] ?? ''}
                noteOpen={noteGameId === game.gameId}
                onToggleWatch={onToggleWatch}
                onToggleShortlist={() => onToggleShortlist(flat)}
                onToggleNote={() => onToggleNote(game.gameId)}
                onNoteChange={(value) => onNoteChange(game.gameId, value)}
              />
            </li>
          )
        })}
      </ul>
    </article>
  )
}


function ScoreBoard({
  game,
  now,
}: {
  game: Pick<FlatGame, 'status' | 'score' | 'date'>
  now: Date
}) {
  const phase = matchPhase(game, now)
  const tag = scoreTag(phase, game.status)

  if (shouldShowScore(game, now)) {
    return (
      <div
        className={`score score-${tag === 'FT' ? 'ft' : 'other'}`}
        aria-label={`Slutresultat ${game.score.home}–${game.score.away}`}
      >
        <span className="score-num">{game.score.home}</span>
        <span className="sep">–</span>
        <span className="score-num">{game.score.away}</span>
        {tag && <span className="score-tag">{tag}</span>}
      </div>
    )
  }

  if (isInPlay(game, now)) {
    return (
      <div className="score score-live score-inplay" aria-label="Match pågår">
        <span className={`score-tag live`}>{tag === 'HT' ? 'HT' : 'LIVE'}</span>
      </div>
    )
  }

  if (game.status === 0) {
    return (
      <div className="score score-pending" aria-label="Inställd">
        <span className="score-tag">INSTÄLLD</span>
      </div>
    )
  }

  if (game.status === 4) {
    return (
      <div className="score score-pending" aria-label="Uppskjuten">
        <span className="score-tag">UPPSKJUTEN</span>
      </div>
    )
  }

  return (
    <div className="score score-pending" aria-label="Ej spelad">
      <span className="vs">vs</span>
    </div>
  )
}

function TeamSide({
  team,
  align,
  onSelectTeam,
}: {
  team: Competition['games'][number]['homeTeam']
  align: 'start' | 'end'
  onSelectTeam: (name: string) => void
}) {
  const name = team.name.trim()
  return (
    <div className={`team team-${align}`}>
      <img src={team.teamImageUrl} alt="" width={36} height={36} loading="lazy" />
      <button
        type="button"
        className="team-link"
        title={`Visa alla matcher för ${name}`}
        onClick={() => onSelectTeam(name)}
      >
        {name}
      </button>
    </div>
  )
}

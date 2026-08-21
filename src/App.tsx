import { addDays, format, isSameDay } from 'date-fns'
import { sv } from 'date-fns/locale'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { sv as dayPickerSv } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import {
  loadBasePlace,
  loadNotes,
  loadShortlist,
  loadWatchTeams,
  matchesPreset,
  saveBasePlace,
  saveNote,
  toggleShortlist,
  toggleWatchTeam,
  type BasePlace,
  type ScoutPreset,
  type ShortlistedMatch,
} from './agentStore'
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
import {
  countByPhase,
  filterByFocus,
  kickoffClock,
  matchPhase,
  phaseLabel,
  relativeKickoff,
  sortForOverview,
  type FocusMode,
} from './time'
import { parseDateParam, readUrlState, toDateParam, writeUrlState } from './urlState'
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

function genderShort(name: string) {
  if (name === 'Man') return 'Herr'
  if (name === 'Kvinna') return 'Dam'
  return name
}

function initialFromUrl() {
  const u = readUrlState()
  const today = new Date()
  const from = parseDateParam(u.from, today)
  const to = parseDateParam(u.to, from)
  const singleDay = isSameDay(from, to)
  return {
    mode: (singleDay ? 'single' : 'range') as Mode,
    single: from,
    range: { from, to } as DateRange,
    focus: (u.focus ?? 'overview') as FocusMode,
    preset: (u.preset ?? 'all') as ScoutPreset,
    layout: (u.layout ?? 'timeline') as Layout,
    showShortlistOnly: u.shortlist === '1',
    filters: {
      ...emptyFilters(),
      gender: u.gender ?? 'all',
      ageCategory: u.age ?? 'all',
      query: u.q ?? '',
      districtId: u.district && u.district !== 'all' ? Number(u.district) : 'all',
    } as Filters,
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
  const [teamFocus, setTeamFocus] = useState<string | null>(null)
  const [clusterId, setClusterId] = useState<string | null>(null)
  const [basePlace, setBasePlace] = useState<BasePlace | null>(() => loadBasePlace())
  const [baseDraft, setBaseDraft] = useState(() => loadBasePlace()?.query ?? '')
  const [baseBusy, setBaseBusy] = useState(false)
  const [baseError, setBaseError] = useState<string | null>(null)
  const [sortByDistance, setSortByDistance] = useState(false)

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
    let games = flat.filter((g) => matchesPreset(g, preset, watchTeams))
    if (showShortlistOnly) {
      const ids = new Set(shortlist.map((s) => s.gameId))
      games = games.filter((g) => ids.has(g.gameId))
    }
    if (teamFocus) {
      const t = teamFocus.trim().toLowerCase()
      games = games.filter(
        (g) =>
          g.homeTeam.name.trim().toLowerCase() === t ||
          g.awayTeam.name.trim().toLowerCase() === t,
      )
    }
    return games
  }, [flat, preset, watchTeams, showShortlistOnly, shortlist, teamFocus])

  const clusters = useMemo(() => buildClusters(scouted), [scouted])

  const focused = useMemo(() => {
    let games = filterByFocus(scouted, focus, now)
    if (clusterId) {
      const cluster = clusters.find((c) => c.id === clusterId)
      if (cluster) {
        const ids = new Set(cluster.games.map((g) => g.gameId))
        games = games.filter((g) => ids.has(g.gameId))
      }
    }
    return games
  }, [scouted, focus, now, clusterId, clusters])

  const venueMeta = useVenueEnrichment(focused, basePlace)

  const timeline = useMemo(() => {
    if (sortByDistance && basePlace) return sortGamesByDistance(focused, venueMeta)
    return sortForOverview(focused, now)
  }, [focused, now, sortByDistance, basePlace, venueMeta])

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

  const gameCount = focused.length
  const totalGames = countGames(data?.competitions ?? [])

  const dateHeadline =
    mode === 'single' || isSameDay(from, to)
      ? format(from, 'd MMMM yyyy', { locale: sv })
      : `${format(from, 'd MMM', { locale: sv })} – ${format(to, 'd MMM yyyy', { locale: sv })}`

  function goToday() {
    const today = new Date()
    setMode('single')
    setSingle(today)
    setRange({ from: today, to: today })
    setFocus('overview')
    setCalendarOpen(false)
  }

  function goTomorrow() {
    const d = addDays(new Date(), 1)
    setMode('single')
    setSingle(d)
    setRange({ from: d, to: d })
    setFocus('all')
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

  return (
    <div className="page app-shell">
      <header className="hero">
        <p className="eyebrow">Scout · Agenter · Sverige</p>
        <h1 className="brand">Svenska Matcher</h1>
        <p className="lede">
          Hitta matcher att scouta, spara lag och bygg en resa — utan brus.
        </p>
      </header>

      <section className="quickbar panel" aria-label="Scoutverktyg">
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
            Byt datum
          </button>
          <button type="button" className="chip" onClick={copyShareLink}>
            {copied ? 'Länk kopierad' : 'Dela vy'}
          </button>
        </div>

        <div className="focus-row" role="group" aria-label="Scoutläge">
          {(
            [
              ['all', 'Alla'],
              ['elit', 'Elit'],
              ['ungdom', 'Ungdom'],
              ['dam', 'Dam'],
              ['watch', `Mina lag (${watchTeams.length})`],
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

        <div className="focus-row" role="group" aria-label="Visa">
          {(
            [
              ['overview', 'Kommande', phases.live + phases.soon + phases.later],
              ['live', 'Pågår', phases.live],
              ['soon', 'Nu & snart', phases.live + phases.soon],
              ['all', 'Alla tider', scouted.length],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={`chip focus-chip ${focus === key ? 'active' : ''} ${key === 'live' && phases.live > 0 ? 'has-live' : ''}`}
              onClick={() => setFocus(key)}
            >
              {label}
              <span className="count">{count}</span>
            </button>
          ))}
          <button
            type="button"
            className={`chip ${showShortlistOnly ? 'active' : ''}`}
            onClick={() => setShowShortlistOnly((v) => !v)}
          >
            Scoutlista ({shortlist.length})
          </button>
          {shortlist.length > 0 && (
            <>
              <button type="button" className="chip" onClick={exportShortlistIcs}>
                Exportera .ics
              </button>
              <button type="button" className="chip" onClick={exportShortlistCsvFile}>
                .csv
              </button>
              <button type="button" className="chip" onClick={exportShortlistJsonFile}>
                .json
              </button>
            </>
          )}
          <button type="button" className="chip no-print" onClick={() => window.print()}>
            Skriv ut dagsplan
          </button>
        </div>

        {shortlistConflicts.length > 0 && (
          <p className="hint warn">
            Tidskonflikt i scoutlistan: {shortlistConflicts.length} kickoff-tider har flera matcher.
          </p>
        )}

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

        <label className="field compact">
          <span className="sr-only">Sök lag, arena eller liga</span>
          <input
            type="search"
            placeholder="Sök lag, arena eller liga…"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          />
        </label>

        <details className="more-filters">
          <summary>Fler filter & distrikt</summary>
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

          <div className="base-place">
            <label className="field">
              <span>Basort (för avstånd)</span>
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
                  : `${gameCount} matcher${gameCount !== totalGames ? ` av ${totalGames}` : ''}${
                      phases.live > 0 ? ` · ${phases.live} pågår` : ''
                    }${phases.soon > 0 ? ` · ${phases.soon} snart` : ''}`}
            </p>
          </div>
          {loading && <div className="spinner" aria-hidden />}
        </div>

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
          <section className="clusters panel no-print" aria-label="Kluster">
            <h3>Kluster samma dag</h3>
            <p className="cluster-lede">Flera matcher i samma distrikt eller på samma arena.</p>
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
          </section>
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
                  <strong>{kickoffClock(g.date)}</strong>{' '}
                  {g.homeTeam.name.trim()} – {g.awayTeam.name.trim()}
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
          <p className="empty">
            {teamFocus
              ? `Inga matcher för ${teamFocus} i valt intervall/filter.`
              : showShortlistOnly
                ? 'Scoutlistan är tom för valt datum/filter.'
                : preset === 'watch'
                  ? 'Inga matcher för bevakade lag. Stjärnmarkera lag i en matchrad.'
                  : focus === 'live'
                    ? 'Inga matcher pågår just nu.'
                    : 'Inga matcher matchar filtren.'}
          </p>
        )}

        {layout === 'timeline' ? (
          <ul className="timeline">
            {timeline.map((game, index) => (
              <TimelineGame
                key={game.gameId}
                game={game}
                now={now}
                meta={venueMeta.get(game.gameId)}
                watched={watchSet}
                shortlisted={shortlistIds.has(game.gameId)}
                note={notes[String(game.gameId)] ?? ''}
                noteOpen={noteGameId === game.gameId}
                onSelectTeam={(name) => {
                  setClusterId(null)
                  setTeamFocus(name)
                }}
                onToggleWatch={(name) => setWatchTeams(toggleWatchTeam(name, watchTeams))}
                onToggleShortlist={() => setShortlist(toggleShortlist(game, shortlist))}
                onToggleNote={() =>
                  setNoteGameId((id) => (id === game.gameId ? null : game.gameId))
                }
                onNoteChange={(value) => setNotes(saveNote(game.gameId, value, notes))}
                style={{ animationDelay: `${Math.min(index, 16) * 28}ms` }}
              />
            ))}
          </ul>
        ) : (
          <div className="competition-stack">
            {leagueListForLayout.map((competition, index) => (
              <CompetitionBlock
                key={competition.competitionId}
                competition={competition}
                now={now}
                venueMeta={venueMeta}
                watched={watchSet}
                shortlistIds={shortlistIds}
                notes={notes}
                noteGameId={noteGameId}
                onSelectTeam={(name) => {
                  setClusterId(null)
                  setTeamFocus(name)
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
        <p>
          Byggd för scouting av matcher och lag. Spelarlistor/linups saknas i öppen data från
          svenskfotboll.se — anteckningar och bevakning sparas lokalt i din webbläsare. Kontakta{' '}
          <a href="mailto:api-support@svenskfotboll.se">api-support@svenskfotboll.se</a> för
          licensierad tillgång.
        </p>
      </footer>
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
          title="Lägg i scoutlista"
          onClick={onToggleShortlist}
        >
          {shortlisted ? 'I listan' : '+ Lista'}
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
  meta?: { km: number | null; weather: { summary: string } | null } | null
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
  return (
    <li className={`timeline-game phase-${phase} ${shortlisted ? 'shortlisted' : ''}`} style={style}>
      <div className="tl-time">
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
          <div className="score" aria-label="Resultat">
            <span>{game.score.home}</span>
            <span className="sep">–</span>
            <span>{game.score.away}</span>
          </div>
          <TeamSide team={game.awayTeam} align="start" onSelectTeam={onSelectTeam} />
        </div>
        <div className="game-foot">
          <span>
            {game.location}
            {meta?.km != null ? ` · ${formatKm(meta.km)}` : ''}
            {meta?.weather?.summary ? ` · ${meta.weather.summary}` : ''}
          </span>
          <a href={matchUrl(game.url)} target="_blank" rel="noreferrer">
            Detaljer
          </a>
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
  venueMeta: Map<number, { km: number | null; weather: { summary: string } | null }>
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
          return (
            <li
              key={game.gameId}
              className={`game phase-${phase} ${shortlistIds.has(game.gameId) ? 'shortlisted' : ''}`}
            >
              <div className="game-meta">
                <time dateTime={game.date}>
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
                <div className="score" aria-label="Resultat">
                  <span>{game.score.home}</span>
                  <span className="sep">–</span>
                  <span>{game.score.away}</span>
                </div>
                <TeamSide team={game.awayTeam} align="start" onSelectTeam={onSelectTeam} />
              </div>
              <div className="game-foot">
                <span>
                  {game.location}
                  {meta?.km != null ? ` · ${formatKm(meta.km)}` : ''}
                  {meta?.weather?.summary ? ` · ${meta.weather.summary}` : ''}
                </span>
                <a href={matchUrl(game.url)} target="_blank" rel="noreferrer">
                  Detaljer
                </a>
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

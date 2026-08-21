import { addDays, format, isSameDay } from 'date-fns'
import { sv } from 'date-fns/locale'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { sv as dayPickerSv } from 'react-day-picker/locale'
import 'react-day-picker/style.css'
import { fetchMatches } from './api'
import {
  countGames,
  emptyFilters,
  filterCompetitions,
  flattenGames,
  uniqueAgeCategories,
  type Filters,
  type FlatGame,
} from './filters'
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
import './App.css'

type Mode = 'single' | 'range'
type Layout = 'timeline' | 'league'

const MAX_RANGE_DAYS = 14

function toIsoDate(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

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

export default function App() {
  const [mode, setMode] = useState<Mode>('single')
  const [single, setSingle] = useState<Date>(() => new Date())
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const today = new Date()
    return { from: today, to: today }
  })
  const [data, setData] = useState<MatchesPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(() => ({
    ...emptyFilters(),
    ageCategory: 'Senior',
  }))
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [months, setMonths] = useState(1)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [layout, setLayout] = useState<Layout>('timeline')
  const [focus, setFocus] = useState<FocusMode>('overview')
  const [now, setNow] = useState(() => new Date())

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
  const fromIso = toIsoDate(from)
  const toIso = toIsoDate(to)
  const canFetch =
    mode === 'single' || Boolean(range?.from && range?.to && rangeLength(range) <= MAX_RANGE_DAYS)
  const viewingToday = isSameDay(from, now) && (mode === 'single' || isSameDay(to, now))

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
          ageCategory: prev.ageCategory || 'Senior',
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

  // Soft refresh while looking at today
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
  const focused = useMemo(() => filterByFocus(flat, focus, now), [flat, focus, now])
  const timeline = useMemo(() => sortForOverview(focused, now), [focused, now])
  const phases = useMemo(() => countByPhase(flat, now), [flat, now])

  const ages = useMemo(() => uniqueAgeCategories(data?.competitions ?? []), [data])
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
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Fotboll · Sverige</p>
        <h1 className="brand">Svenska Matcher</h1>
        <p className="lede">Vad går nu, och vad startar snart.</p>
      </header>

      <section className="quickbar panel" aria-label="Snabbval">
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
        </div>

        <div className="focus-row" role="group" aria-label="Visa">
          {(
            [
              ['overview', 'Kommande', phases.live + phases.soon + phases.later],
              ['live', 'Pågår', phases.live],
              ['soon', 'Nu & snart', phases.live + phases.soon],
              ['all', 'Alla', flat.length],
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
        </div>

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
          <summary>Fler filter</summary>
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
                {filters.competitions.size > 0 && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => setFilters((f) => ({ ...f, competitions: new Set() }))}
                  >
                    Rensa ligaval
                  </button>
                )}
              </div>
            )}
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

        {!loading && !error && gameCount === 0 && (
          <p className="empty">
            {focus === 'live'
              ? 'Inga matcher pågår just nu.'
              : focus === 'soon'
                ? 'Inga matcher inom två timmar.'
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
                style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
              />
            ))}
          </div>
        )}
      </section>

      <footer className="footer">
        <p>
          Matchdata visas via svenskfotboll.se. Detta är ett hobbyprojekt utan officiell
          koppling till SvFF — kontakta{' '}
          <a href="mailto:api-support@svenskfotboll.se">api-support@svenskfotboll.se</a>{' '}
          för licensierad API-åtkomst.
        </p>
      </footer>
    </div>
  )
}

function TimelineGame({
  game,
  now,
  style,
}: {
  game: FlatGame
  now: Date
  style?: CSSProperties
}) {
  const phase = matchPhase(game, now)
  return (
    <li className={`timeline-game phase-${phase}`} style={style}>
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
            {genderShort(game.genderName)} · {game.ageCategoryName}
          </span>
        </p>
        <div className="teams compact">
          <TeamSide team={game.homeTeam} align="end" />
          <div className="score" aria-label="Resultat">
            <span>{game.score.home}</span>
            <span className="sep">–</span>
            <span>{game.score.away}</span>
          </div>
          <TeamSide team={game.awayTeam} align="start" />
        </div>
        <div className="game-foot">
          <span>{game.location}</span>
          <a href={matchUrl(game.url)} target="_blank" rel="noreferrer">
            Detaljer
          </a>
        </div>
      </div>
    </li>
  )
}

function CompetitionBlock({
  competition,
  now,
  style,
}: {
  competition: Competition
  now: Date
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
          const phase = matchPhase(game, now)
          return (
            <li key={game.gameId} className={`game phase-${phase}`}>
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
                <TeamSide team={game.homeTeam} align="end" />
                <div className="score" aria-label="Resultat">
                  <span>{game.score.home}</span>
                  <span className="sep">–</span>
                  <span>{game.score.away}</span>
                </div>
                <TeamSide team={game.awayTeam} align="start" />
              </div>
              <div className="game-foot">
                <span>{game.location}</span>
                <a href={matchUrl(game.url)} target="_blank" rel="noreferrer">
                  Detaljer
                </a>
              </div>
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
}: {
  team: Competition['games'][number]['homeTeam']
  align: 'start' | 'end'
}) {
  return (
    <div className={`team team-${align}`}>
      <img src={team.teamImageUrl} alt="" width={36} height={36} loading="lazy" />
      <span>{team.name.trim()}</span>
    </div>
  )
}

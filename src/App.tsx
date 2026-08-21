import { format, isSameDay } from 'date-fns'
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
  uniqueAgeCategories,
  type Filters,
} from './filters'
import type { Competition, MatchesPayload } from './types'
import { matchUrl, statusLabel } from './types'
import './App.css'

type Mode = 'single' | 'range'

const MAX_RANGE_DAYS = 14

function toIsoDate(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

function rangeLength(range: DateRange | undefined) {
  if (!range?.from || !range?.to) return 0
  const ms = range.to.getTime() - range.from.getTime()
  return Math.floor(ms / 86400000) + 1
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
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [leagueOpen, setLeagueOpen] = useState(false)
  const [months, setMonths] = useState(1)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 720px)')
    const sync = () => setMonths(mq.matches ? 2 : 1)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const from = mode === 'single' ? single : (range?.from ?? single)
  const to = mode === 'single' ? single : (range?.to ?? range?.from ?? single)
  const fromIso = toIsoDate(from)
  const toIso = toIsoDate(to)
  const canFetch =
    mode === 'single' || Boolean(range?.from && range?.to && rangeLength(range) <= MAX_RANGE_DAYS)

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

  const filtered = useMemo(
    () => filterCompetitions(data?.competitions ?? [], filters),
    [data, filters],
  )

  const ages = useMemo(() => uniqueAgeCategories(data?.competitions ?? []), [data])
  const gameCount = countGames(filtered)
  const totalGames = countGames(data?.competitions ?? [])

  const dateHeadline =
    mode === 'single' || isSameDay(from, to)
      ? format(from, 'd MMMM yyyy', { locale: sv })
      : `${format(from, 'd MMM', { locale: sv })} – ${format(to, 'd MMM yyyy', { locale: sv })}`

  function toggleCompetition(id: number) {
    setFilters((prev) => {
      const next = new Set(prev.competitions)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...prev, competitions: next }
    })
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Fotboll · Sverige</p>
        <h1 className="brand">Svenska Matcher</h1>
        <p className="lede">
          Välj datum eller intervall och filtrera fram herr, dam och ligor från hela
          landet.
        </p>
      </header>

      <section className="controls" aria-label="Datum och filter">
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
              onSelect={(d) => d && setSingle(d)}
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
          {mode === 'range' && range?.from && !range?.to && (
            <p className="hint">Välj slutdatum i kalendern.</p>
          )}
        </div>

        <div className="panel filters-panel">
          <h2>Filter</h2>
          <label className="field">
            <span>Sök lag, arena eller liga</span>
            <input
              type="search"
              placeholder="t.ex. Sirius, Studenternas, Allsvenskan"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
          </label>

          <div className="chip-row" role="group" aria-label="Kön">
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
                {filters.competitions.size > 0
                  ? `${filters.competitions.size} valda`
                  : 'Alla'}
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
                        {c.genderName === 'Man' ? 'Herr' : c.genderName === 'Kvinna' ? 'Dam' : c.genderName} ·{' '}
                        {c.ageCategoryName} · {c.games.length} matcher
                      </small>
                    </span>
                  </label>
                ))}
                {filters.competitions.size > 0 && (
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() =>
                      setFilters((f) => ({ ...f, competitions: new Set() }))
                    }
                  >
                    Rensa ligaval
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="results" aria-live="polite">
        <div className="results-head">
          <div>
            <h2>{dateHeadline}</h2>
            <p>
              {loading
                ? 'Hämtar matcher…'
                : error
                  ? 'Kunde inte ladda'
                  : `${gameCount} matcher${gameCount !== totalGames ? ` av ${totalGames}` : ''} · ${filtered.length} tävlingar`}
            </p>
          </div>
          {loading && <div className="spinner" aria-hidden />}
        </div>

        {error && <p className="error-box">{error}</p>}

        {!loading && !error && filtered.length === 0 && (
          <p className="empty">Inga matcher matchar filtren för valt datum.</p>
        )}

        <div className="competition-stack">
          {filtered.map((competition, index) => (
            <CompetitionBlock
              key={competition.competitionId}
              competition={competition}
              style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
            />
          ))}
        </div>
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

function CompetitionBlock({
  competition,
  style,
}: {
  competition: Competition
  style?: CSSProperties
}) {
  return (
    <article className="competition" style={style}>
      <header className="competition-head">
        <h3>{competition.name}</h3>
        <p>
          {competition.genderName === 'Man'
            ? 'Herr'
            : competition.genderName === 'Kvinna'
              ? 'Dam'
              : competition.genderName}{' '}
          · {competition.ageCategoryName}
        </p>
      </header>
      <ul className="games-list">
        {competition.games.map((game) => (
          <li key={game.gameId} className="game">
            <div className="game-meta">
              <time dateTime={game.date}>{game.dateFormatted}</time>
              <span className={`status status-${game.status}`}>{statusLabel(game.status)}</span>
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
        ))}
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

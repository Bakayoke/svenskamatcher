import { useEffect, useState } from 'react'
import {
  fetchFixtureDetail,
  fetchTeamTransfers,
  type EnrichedFixture,
  type FixtureDetail,
  type TransferRow,
} from './api'

export function ScoutPanel({
  fixture,
  onClose,
}: {
  fixture: EnrichedFixture
  onClose: () => void
}) {
  const [detail, setDetail] = useState<FixtureDetail | null>(null)
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'lineup' | 'ratings' | 'events' | 'transfers'>('lineup')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      fetchFixtureDetail(fixture.fixtureId),
      fetchTeamTransfers(fixture.homeId).catch(() => [] as TransferRow[]),
    ])
      .then(([d, t]) => {
        if (cancelled) return
        setDetail(d)
        setTransfers(t)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Kunde inte hämta scoutdata')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fixture.fixtureId, fixture.homeId])

  const ratings = [...(detail?.players ?? [])]
    .filter((p) => p.rating)
    .sort((a, b) => Number(b.rating) - Number(a.rating))

  return (
    <div className="scout-overlay" role="dialog" aria-modal="true" aria-label="Scoutdata">
      <div className="scout-panel">
        <header className="scout-head">
          <div>
            <p className="scout-league">{fixture.leagueName}</p>
            <h3>
              {fixture.home} {fixture.goalsHome ?? '-'} – {fixture.goalsAway ?? '-'} {fixture.away}
            </h3>
            <p className="scout-meta">
              {fixture.statusLong}
              {fixture.elapsed != null ? ` · ${fixture.elapsed}'` : ''}
              {fixture.venue ? ` · ${fixture.venue}` : ''}
            </p>
          </div>
          <button type="button" className="chip" onClick={onClose}>
            Stäng
          </button>
        </header>

        <div className="chip-row tight">
          {(
            [
              ['lineup', 'Laguppställning'],
              ['ratings', 'Ratings'],
              ['events', 'Händelser'],
              ['transfers', 'Transfers (hem)'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && <p className="hint">Hämtar gratisdata från API-Football…</p>}
        {error && <p className="hint warn">{error}</p>}

        {!loading && !error && tab === 'lineup' && (
          <div className="scout-grid">
            {(detail?.lineups ?? []).map((l) => (
              <div key={l.team} className="scout-card">
                <h4>
                  {l.team}
                  {l.formation ? ` · ${l.formation}` : ''}
                </h4>
                <ol>
                  {l.startXI.map((p) => (
                    <li key={`${l.team}-${p.name}`}>
                      {p.number != null ? `${p.number}. ` : ''}
                      {p.name}
                      {p.pos ? ` (${p.pos})` : ''}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            {(detail?.lineups.length ?? 0) === 0 && (
              <p className="hint">Ingen laguppställning publicerad ännu.</p>
            )}
          </div>
        )}

        {!loading && !error && tab === 'ratings' && (
          <div className="scout-card">
            <table className="scout-table">
              <thead>
                <tr>
                  <th>Spelare</th>
                  <th>Lag</th>
                  <th>Rating</th>
                  <th>G</th>
                  <th>A</th>
                  <th>Min</th>
                </tr>
              </thead>
              <tbody>
                {ratings.map((p) => (
                  <tr key={`${p.team}-${p.name}`}>
                    <td>{p.name}</td>
                    <td>{p.team}</td>
                    <td>{p.rating}</td>
                    <td>{p.goals}</td>
                    <td>{p.assists}</td>
                    <td>{p.minutes ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ratings.length === 0 && <p className="hint">Inga ratings ännu (ofta efter match).</p>}
          </div>
        )}

        {!loading && !error && tab === 'events' && (
          <ul className="scout-events">
            {(detail?.events ?? []).map((e, i) => (
              <li key={`${e.time}-${e.player}-${i}`}>
                <strong>{e.time != null ? `${e.time}'` : '–'}</strong> {e.type}: {e.player}
                {e.assist ? ` (${e.assist})` : ''} · {e.team}
              </li>
            ))}
            {(detail?.events.length ?? 0) === 0 && <li>Inga händelser ännu.</li>}
          </ul>
        )}

        {!loading && !error && tab === 'transfers' && (
          <div className="scout-card">
            <table className="scout-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Spelare</th>
                  <th>Från</th>
                  <th>Till</th>
                  <th>Typ</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t, i) => (
                  <tr key={`${t.player}-${t.date}-${i}`}>
                    <td>{t.date ?? '–'}</td>
                    <td>{t.player}</td>
                    <td>{t.from ?? '–'}</td>
                    <td>{t.to ?? '–'}</td>
                    <td>{t.type ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {transfers.length === 0 && <p className="hint">Inga transfers hittades.</p>}
          </div>
        )}

        <p className="hint">
          Data via API-Football gratisplan (cachead). Täckning bäst för Allsvenskan / Superettan /
          Damallsvenskan / Elitettan.
        </p>
      </div>
    </div>
  )
}

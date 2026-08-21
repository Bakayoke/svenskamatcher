import type { ShortlistedMatch } from './agentStore'
import { matchUrl } from './types'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string) {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function buildShortlistCsv(items: ShortlistedMatch[]): string {
  const header = ['datum', 'hemmalag', 'bortalag', 'tavling', 'arena', 'url']
  const rows = items
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) =>
      [m.date, m.home, m.away, m.competitionName, m.location, matchUrl(m.url)]
        .map(csvEscape)
        .join(','),
    )
  return [header.join(','), ...rows].join('\n')
}

export function buildShortlistJson(items: ShortlistedMatch[]): string {
  const payload = items
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => ({
      gameId: m.gameId,
      date: m.date,
      home: m.home,
      away: m.away,
      competitionName: m.competitionName,
      location: m.location,
      url: matchUrl(m.url),
      savedAt: m.savedAt,
    }))
  return JSON.stringify(payload, null, 2)
}

export function downloadShortlistCsv(filename: string, items: ShortlistedMatch[]) {
  downloadBlob(filename, buildShortlistCsv(items), 'text/csv;charset=utf-8')
}

export function downloadShortlistJson(filename: string, items: ShortlistedMatch[]) {
  downloadBlob(filename, buildShortlistJson(items), 'application/json;charset=utf-8')
}

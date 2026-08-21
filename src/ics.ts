import type { ShortlistedMatch } from './agentStore'
import { parseKickoff } from './time'
import { matchUrl } from './types'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function toIcsUtc(date: Date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

function escapeIcs(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** Approx. 2h window for a football match. */
export function buildShortlistIcs(items: ShortlistedMatch[]): string {
  const stamp = toIcsUtc(new Date())
  const events = items
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => {
      const start = parseKickoff(m.date)
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
      const title = `${m.home} – ${m.away}`
      const desc = `${m.competitionName}\\n${matchUrl(m.url)}`
      return [
        'BEGIN:VEVENT',
        `UID:svenskamatcher-${m.gameId}@svenskamatcher.com`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${toIcsUtc(start)}`,
        `DTEND:${toIcsUtc(end)}`,
        `SUMMARY:${escapeIcs(title)}`,
        `LOCATION:${escapeIcs(m.location)}`,
        `DESCRIPTION:${escapeIcs(desc)}`,
        'END:VEVENT',
      ].join('\r\n')
    })

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Svenska Matcher//Scoutlista//SV',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ].join('\r\n')
}

export function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

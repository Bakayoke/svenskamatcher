import { format, parseISO } from 'date-fns'
import type { FocusMode } from './time'
import type { ScoutPreset } from './agentStore'

export type UrlState = {
  from?: string
  to?: string
  focus?: FocusMode
  preset?: ScoutPreset
  gender?: 'all' | 'Man' | 'Kvinna'
  age?: string
  q?: string
  district?: string
  layout?: 'timeline' | 'league'
  shortlist?: '1'
  lista?: string
}

export function readUrlState(): UrlState {
  const p = new URLSearchParams(window.location.search)
  const get = (k: string) => p.get(k) ?? undefined
  return {
    from: get('from'),
    to: get('to'),
    focus: get('focus') as FocusMode | undefined,
    preset: get('preset') as ScoutPreset | undefined,
    gender: get('gender') as UrlState['gender'],
    age: get('age'),
    q: get('q'),
    district: get('district'),
    layout: get('layout') as UrlState['layout'],
    shortlist: get('shortlist') as '1' | undefined,
    lista: get('lista'),
  }
}

export function writeUrlState(state: UrlState) {
  const p = new URLSearchParams()
  for (const [key, value] of Object.entries(state)) {
    if (value == null || value === '' || value === 'all') continue
    if (key === 'age' && value === 'all') continue
    if (key === 'preset' && value === 'all') continue
    if (key === 'focus' && value === 'overview') continue
    if (key === 'layout' && value === 'timeline') continue
    p.set(key, String(value))
  }
  const qs = p.toString()
  const next = qs ? `?${qs}` : window.location.pathname
  window.history.replaceState(null, '', next)
}

export function parseDateParam(value: string | undefined, fallback: Date) {
  if (!value) return fallback
  try {
    const d = parseISO(value)
    if (Number.isNaN(d.getTime())) return fallback
    return d
  } catch {
    return fallback
  }
}

export function toDateParam(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

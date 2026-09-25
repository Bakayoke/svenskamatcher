import { addDays, format } from 'date-fns'
import { parseSeoPath, teamPath, districtPath, datePath } from './seoRoutes'
import { districtName } from './districts'
import type { ScoutPreset } from './agentStore'
import type { FocusMode } from './time'
import type { Filters } from './filters'
import { emptyFilters } from './filters'

export type PathBoot = {
  from: Date
  to: Date
  mode: 'single' | 'range'
  teamFocus: string | null
  districtId: 'all' | number
  preset?: ScoutPreset
  focus?: FocusMode
  query?: string
}

export function bootFromPathname(pathname: string, today = new Date()): PathBoot {
  const route = parseSeoPath(pathname)
  const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  if (route.kind === 'today') {
    return {
      from: todayNoon,
      to: todayNoon,
      mode: 'single',
      teamFocus: null,
      districtId: 'all',
      focus: 'overview',
    }
  }
  if (route.kind === 'tomorrow') {
    const d = addDays(todayNoon, 1)
    return { from: d, to: d, mode: 'single', teamFocus: null, districtId: 'all', focus: 'all' }
  }
  if (route.kind === 'date') {
    const [y, m, d] = route.date.split('-').map(Number)
    const day = new Date(y, m - 1, d, 12)
    return { from: day, to: day, mode: 'single', teamFocus: null, districtId: 'all', focus: 'all' }
  }
  if (route.kind === 'team') {
    return {
      from: todayNoon,
      to: addDays(todayNoon, 6),
      mode: 'range',
      teamFocus: route.nameHint,
      districtId: 'all',
      preset: 'all',
      focus: 'all',
      query: '',
    }
  }
  if (route.kind === 'district') {
    return {
      from: todayNoon,
      to: addDays(todayNoon, 6),
      mode: 'range',
      teamFocus: null,
      districtId: route.id,
      focus: 'all',
    }
  }
  return {
    from: todayNoon,
    to: todayNoon,
    mode: 'single',
    teamFocus: null,
    districtId: 'all',
  }
}

export function navigateSeo(
  kind: 'home' | 'today' | 'tomorrow' | 'team' | 'district' | 'date',
  opts?: { team?: string; districtId?: number; date?: string },
) {
  let path = '/'
  if (kind === 'today') path = '/idag'
  else if (kind === 'tomorrow') path = '/imorgon'
  else if (kind === 'team' && opts?.team) path = teamPath(opts.team)
  else if (kind === 'district' && opts?.districtId != null) {
    path = districtPath(opts.districtId, districtName(opts.districtId))
  } else if (kind === 'date' && opts?.date) path = datePath(opts.date)
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function filtersWithDistrict(districtId: 'all' | number): Filters {
  return { ...emptyFilters(), districtId }
}

export function isoDay(d: Date) {
  return format(d, 'yyyy-MM-dd')
}

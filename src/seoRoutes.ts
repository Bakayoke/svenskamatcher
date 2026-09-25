/** Shared SEO path helpers — used by Worker and client. */

export type SeoRoute =
  | { kind: 'home' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'date'; date: string }
  | { kind: 'team'; slug: string; nameHint: string }
  | { kind: 'district'; id: number }

const DISTRICT_SLUGS: Record<string, number> = {
  blekinge: 2,
  gastrikland: 6,
  goteborg: 7,
  halland: 8,
  halsingland: 9,
  jamtland: 10,
  norrbotten: 12,
  orebro: 13,
  skane: 14,
  smaland: 15,
  stockholm: 16,
  uppland: 18,
  varmland: 19,
  vasterbotten: 20,
  vastergotland: 21,
  vastmanland: 22,
  ostergotland: 24,
  bohuslan: 28,
}

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function unslugToHint(slug: string): string {
  return slug.replace(/-/g, ' ').trim()
}

export function districtIdFromSlug(slug: string): number | null {
  return DISTRICT_SLUGS[slug] ?? (Number.isFinite(Number(slug)) ? Number(slug) : null)
}

export function districtSlugFromId(id: number, name: string): string {
  const hit = Object.entries(DISTRICT_SLUGS).find(([, v]) => v === id)
  if (hit) return hit[0]
  return slugify(name) || String(id)
}

export function parseSeoPath(pathname: string): SeoRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/' || path === '') return { kind: 'home' }
  if (path === '/idag') return { kind: 'today' }
  if (path === '/imorgon') return { kind: 'tomorrow' }

  const date = /^\/matcher\/(\d{4}-\d{2}-\d{2})$/.exec(path)
  if (date) return { kind: 'date', date: date[1] }

  const team = /^\/lag\/([^/]+)$/.exec(path)
  if (team) {
    const slug = decodeURIComponent(team[1])
    return { kind: 'team', slug, nameHint: unslugToHint(slug) }
  }

  const dist = /^\/distrikt\/([^/]+)$/.exec(path)
  if (dist) {
    const id = districtIdFromSlug(decodeURIComponent(dist[1]))
    if (id != null) return { kind: 'district', id }
  }

  return { kind: 'home' }
}

export function teamPath(teamName: string): string {
  return `/lag/${slugify(teamName)}`
}

export function districtPath(id: number, name: string): string {
  return `/distrikt/${districtSlugFromId(id, name)}`
}

export function datePath(iso: string): string {
  return `/matcher/${iso}`
}

/** Youth age tokens often appear in competition names, not ageCategory. */
export const YOUTH_AGE_CHIPS = ['U13', 'U14', 'U15', 'U16', 'U17', 'U19', 'P16', 'P17', 'F16', 'F17'] as const

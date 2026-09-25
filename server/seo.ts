import { format, addDays } from 'date-fns'
import { getMatches, type Competition, type Game } from './matches.ts'

const SITE = 'https://svenskamatcher.com'

const DISTRICT_NAMES: Record<number, string> = {
  2: 'Blekinge',
  6: 'Gästrikland',
  7: 'Göteborg',
  8: 'Halland',
  9: 'Hälsingland',
  10: 'Jämtland/Härjedalen',
  12: 'Norrbotten',
  13: 'Örebro län',
  14: 'Skåne',
  15: 'Småland',
  16: 'Stockholm',
  18: 'Uppland',
  19: 'Värmland',
  20: 'Västerbotten',
  21: 'Västergötland',
  22: 'Västmanland',
  24: 'Östergötland',
  28: 'Bohuslän',
}

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

type FlatGame = Game & {
  competitionId: number
  competitionName: string
  genderName: string
  ageCategoryName: string
}

type SeoRoute =
  | { kind: 'home' }
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'date'; date: string }
  | { kind: 'team'; slug: string; nameHint: string }
  | { kind: 'district'; id: number }

function esc(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function slugify(text: string): string {
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

function unslugToHint(slug: string) {
  return slug.replace(/-/g, ' ').trim()
}

function districtName(id: number) {
  return DISTRICT_NAMES[id] ?? `Distrikt ${id}`
}

function districtPath(id: number) {
  const hit = Object.entries(DISTRICT_SLUGS).find(([, v]) => v === id)
  return `/distrikt/${hit?.[0] ?? id}`
}

function teamPath(name: string) {
  return `/lag/${slugify(name)}`
}

function datePath(iso: string) {
  return `/matcher/${iso}`
}

function todayIso(d = new Date()) {
  return format(d, 'yyyy-MM-dd')
}

function flatten(competitions: Competition[]): FlatGame[] {
  return competitions.flatMap((c: Competition) =>
    c.games.map((g: Game) => ({
      ...g,
      competitionId: c.competitionId,
      competitionName: c.name,
      genderName: c.genderName,
      ageCategoryName: c.ageCategoryName,
    })),
  )
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
    const raw = decodeURIComponent(dist[1])
    const id = DISTRICT_SLUGS[raw] ?? (Number.isFinite(Number(raw)) ? Number(raw) : null)
    if (id != null) return { kind: 'district', id }
  }
  return { kind: 'home' }
}

function teamMatches(game: FlatGame, hint: string, slug: string) {
  const h = hint.toLowerCase()
  const home = game.homeTeam.name.trim()
  const away = game.awayTeam.name.trim()
  return (
    slugify(home) === slug ||
    slugify(away) === slug ||
    home.toLowerCase().includes(h) ||
    away.toLowerCase().includes(h)
  )
}

async function loadGamesForRoute(route: SeoRoute) {
  const today = new Date()
  const todayS = todayIso(today)
  const tomorrowS = todayIso(addDays(today, 1))

  let from = todayS
  let to = todayS
  if (route.kind === 'tomorrow') {
    from = tomorrowS
    to = tomorrowS
  } else if (route.kind === 'date') {
    from = route.date
    to = route.date
  } else if (route.kind === 'team' || route.kind === 'district') {
    from = todayS
    to = todayIso(addDays(today, 6))
  }

  let competitions: Competition[] = []
  try {
    const payload = await getMatches(from, to)
    competitions = payload.competitions ?? []
  } catch {
    competitions = []
  }

  let games = flatten(competitions)
  let title = 'Svenska Matcher – scouta fotbollsmatcher i Sverige'
  let description =
    'Scouta svenska fotbollsmatcher per datum – bevaka lag, bygg scoutlista och planera dagen.'
  let h1 = 'Svenska Matcher'
  let canonical = `${SITE}/`
  const dateLabel = from === to ? from : `${from} – ${to}`

  if (route.kind === 'today') {
    title = `Fotbollsmatcher idag ${from} | Svenska Matcher`
    description = `Svenska fotbollsmatcher idag ${from}. Filtrera herr, dam och ungdom – bevaka lag och planera scouting.`
    h1 = 'Fotbollsmatcher idag'
    canonical = `${SITE}/idag`
  } else if (route.kind === 'tomorrow') {
    title = `Fotbollsmatcher imorgon ${from} | Svenska Matcher`
    description = `Svenska fotbollsmatcher imorgon ${from}. Hitta matcher att scouta och bevaka lag.`
    h1 = 'Fotbollsmatcher imorgon'
    canonical = `${SITE}/imorgon`
  } else if (route.kind === 'date') {
    title = `Fotbollsmatcher ${route.date} | Svenska Matcher`
    description = `Svenska fotbollsmatcher ${route.date}. Spelprogram och scoutingverktyg.`
    h1 = `Matcher ${route.date}`
    canonical = `${SITE}${datePath(route.date)}`
  } else if (route.kind === 'team') {
    games = games.filter((g) => teamMatches(g, route.nameHint, route.slug))
    const label =
      games.find((g) => slugify(g.homeTeam.name) === route.slug)?.homeTeam.name.trim() ??
      games.find((g) => slugify(g.awayTeam.name) === route.slug)?.awayTeam.name.trim() ??
      route.nameHint.replace(/\b\w/g, (c) => c.toUpperCase())
    title = `${label} matcher – spelprogram | Svenska Matcher`
    description = `Matcher för ${label} de kommande dagarna. Kickoff, arena och liga.`
    h1 = `Matcher: ${label}`
    canonical = `${SITE}${teamPath(label)}`
  } else if (route.kind === 'district') {
    const name = districtName(route.id)
    games = games.filter(
      (g) =>
        g.homeTeamClubAssociationId === route.id ||
        g.awayTeamClubAssociationId === route.id,
    )
    title = `Fotbollsmatcher i ${name} | Svenska Matcher`
    description = `Matcher i ${name} de kommande dagarna. Scouta lag och filtrera ungdom.`
    h1 = `Matcher i ${name}`
    canonical = `${SITE}${districtPath(route.id)}`
  }

  games = games.slice().sort((a, b) => a.date.localeCompare(b.date))
  return { title, description, h1, canonical, games, dateLabel }
}

function topTeamNames(games: FlatGame[], limit = 40): string[] {
  const counts = new Map<string, number>()
  for (const g of games) {
    for (const name of [g.homeTeam.name.trim(), g.awayTeam.name.trim()]) {
      if (!name) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'sv'))
    .slice(0, limit)
    .map(([n]) => n)
}

function discoverLinksHtml(games: FlatGame[]): string {
  const teams = topTeamNames(games, 16)
  const teamLinks = teams
    .map((t) => `<li><a href="${esc(teamPath(t))}">${esc(t)}</a></li>`)
    .join('')
  const distLinks = Object.entries(DISTRICT_NAMES)
    .map(([id, name]) => `<li><a href="${esc(districtPath(Number(id)))}">${esc(name)}</a></li>`)
    .join('')
  return `
<nav class="seo-discover" aria-label="Upptäck">
  <h2>Populära lag</h2>
  <ul>${teamLinks || '<li>Inga lag just nu</li>'}</ul>
  <h2>Distrikt</h2>
  <ul>${distLinks}</ul>
</nav>`
}

function renderSeoBody(opts: {
  h1: string
  description: string
  games: FlatGame[]
  dateLabel: string
  discoverHtml: string
}): string {
  const rows =
    opts.games.length === 0
      ? `<p>Inga matcher hittades för valt urval just nu. Öppna appen för att välja annat datum.</p>`
      : `<ol class="seo-games">${opts.games
          .slice(0, 80)
          .map((g) => {
            const time = g.date.slice(11, 16)
            const day = g.date.slice(0, 10)
            return `<li><strong>${esc(day)} ${esc(time)}</strong> — ${esc(g.homeTeam.name.trim())} – ${esc(g.awayTeam.name.trim())} · ${esc(g.competitionName)} · ${esc(g.location)}</li>`
          })
          .join('')}</ol>`

  return `
<section id="seo-content" class="seo-content">
  <h1>${esc(opts.h1)}</h1>
  <p>${esc(opts.description)}</p>
  <p><em>Period: ${esc(opts.dateLabel)} · ${opts.games.length} matcher</em></p>
  ${rows}
  ${opts.discoverHtml}
  <p><a href="/">Öppna full scoutvy</a> · <a href="/idag">Idag</a> · <a href="/imorgon">Imorgon</a></p>
</section>`
}

export async function buildSitemapXml(): Promise<string> {
  const today = new Date()
  const todayS = todayIso(today)
  const tomorrowS = todayIso(addDays(today, 1))
  let games: FlatGame[] = []
  try {
    const payload = await getMatches(todayS, tomorrowS)
    games = flatten(payload.competitions ?? [])
  } catch {
    games = []
  }

  const urls = new Set<string>([
    `${SITE}/`,
    `${SITE}/idag`,
    `${SITE}/imorgon`,
    `${SITE}${datePath(todayS)}`,
    `${SITE}${datePath(tomorrowS)}`,
  ])
  for (const id of Object.keys(DISTRICT_NAMES)) {
    urls.add(`${SITE}${districtPath(Number(id))}`)
  }
  for (const name of topTeamNames(games, 60)) {
    urls.add(`${SITE}${teamPath(name)}`)
  }

  const body = [...urls]
    .map(
      (loc) => `  <url>
    <loc>${esc(loc)}</loc>
    <changefreq>hourly</changefreq>
    <priority>${loc === `${SITE}/` || loc.endsWith('/idag') ? '1.0' : '0.7'}</priority>
  </url>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`
}

export async function injectSeoHtml(indexHtml: string, pathname: string): Promise<string> {
  const route = parseSeoPath(pathname)
  const data = await loadGamesForRoute(route)
  const seoBlock = renderSeoBody({
    h1: data.h1,
    description: data.description,
    games: data.games,
    dateLabel: data.dateLabel,
    discoverHtml: discoverLinksHtml(data.games),
  })

  let html = indexHtml
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(data.title)}</title>`)
  html = html.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
    `<meta name="description" content="${esc(data.description)}" />`,
  )
  html = html.replace(
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/,
    `<link rel="canonical" href="${esc(data.canonical)}" />`,
  )
  html = html.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:title" content="${esc(data.title)}" />`,
  )
  html = html.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:description" content="${esc(data.description)}" />`,
  )
  html = html.replace(
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:url" content="${esc(data.canonical)}" />`,
  )
  html = html.replace('<div id="root"></div>', `${seoBlock}\n    <div id="root"></div>`)
  return html
}

export { SITE }

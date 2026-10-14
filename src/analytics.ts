/**
 * Lightweight view markers for Cloudflare Web Analytics (SPA mode).
 * CF WA has no custom events yet — route/query changes are what get measured.
 */
export type TrackView =
  | 'ask'
  | 'route'
  | 'along'
  | 'shortlist'
  | 'watch'
  | 'share'

export function trackView(view: TrackView) {
  try {
    const url = new URL(window.location.href)
    if (url.searchParams.get('view') === view) return
    url.searchParams.set('view', view)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  } catch {
    /* ignore */
  }
}

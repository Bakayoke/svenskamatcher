import { useEffect } from 'react'

const SITE = 'https://svenskamatcher.com'
const DEFAULT_DESC =
  'Scouta svenska fotbollsmatcher per datum – bevaka lag, bygg scoutlista och planera dagen. Herr, dam och ungdom.'

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.content = content
}

function setLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null
  if (!el) {
    el = document.createElement('link')
    el.rel = rel
    document.head.appendChild(el)
  }
  el.href = href
}

export function useDocumentMeta(opts: {
  title: string
  description?: string
  path?: string
}) {
  useEffect(() => {
    const title = opts.title
    const description = opts.description ?? DEFAULT_DESC
    const url = `${SITE}${opts.path ?? window.location.pathname}${window.location.search}`

    document.title = title
    setMeta('name', 'description', description)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', description)
    setMeta('property', 'og:url', url)
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', description)
    setLink('canonical', `${SITE}/`)
  }, [opts.title, opts.description, opts.path])
}

export { SITE, DEFAULT_DESC }

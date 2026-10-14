import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const BUILD_KEY = 'sm.buildId'
const CHECK_MS = 5 * 60 * 1000

function setupAutoUpdate() {
  let refreshing = false
  const reloadOnce = () => {
    if (refreshing) return
    refreshing = true
    window.location.reload()
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce)

    window.addEventListener('load', () => {
      void navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          const promote = (worker: ServiceWorker | null) => {
            if (!worker) return
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                worker.postMessage({ type: 'SKIP_WAITING' })
              }
            })
          }

          if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          promote(reg.installing)
          reg.addEventListener('updatefound', () => promote(reg.installing))

          const checkSw = () => void reg.update()
          checkSw()
          window.setInterval(checkSw, CHECK_MS)
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') checkSw()
          })
        })
        .catch(() => {
          /* ignore SW failures in unsupported/dev contexts */
        })
    })
  }

  void pollVersion(reloadOnce)
}

async function pollVersion(onNew: () => void) {
  let known = sessionStorage.getItem(BUILD_KEY)

  const tick = async () => {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { buildId?: string }
      if (!data.buildId) return
      if (known == null) {
        known = data.buildId
        sessionStorage.setItem(BUILD_KEY, known)
        return
      }
      if (data.buildId !== known) {
        known = data.buildId
        sessionStorage.setItem(BUILD_KEY, known)
        onNew()
      }
    } catch {
      /* offline / first deploy without version.json */
    }
  }

  await tick()
  window.setInterval(() => void tick(), CHECK_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tick()
  })
}

setupAutoUpdate()

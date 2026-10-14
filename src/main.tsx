import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        void reg.update()
        // New SW takes over immediately (pairs with skipWaiting in sw.js).
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      })
      .catch(() => {
        /* ignore SW failures in unsupported/dev contexts */
      })
  })
}

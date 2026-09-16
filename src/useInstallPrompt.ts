import { useEffect, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'sm.installDismissed'

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && Boolean((navigator as { standalone?: boolean }).standalone))
    setIsStandalone(standalone)
    if (standalone) return

    if (localStorage.getItem(DISMISS_KEY) === '1') return

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)

    // iOS / browsers without beforeinstallprompt: still show hint after a beat
    const t = window.setTimeout(() => {
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
      if (isIos && !standalone) setVisible(true)
    }, 2500)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.clearTimeout(t)
    }
  }, [])

  async function install() {
    if (deferred) {
      await deferred.prompt()
      const choice = await deferred.userChoice
      setDeferred(null)
      if (choice.outcome === 'accepted') setVisible(false)
      return
    }
    // iOS: cannot prompt — keep banner with instructions
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setVisible(false)
  }

  return {
    visible: visible && !isStandalone,
    canPrompt: Boolean(deferred),
    install,
    dismiss,
    isIos: typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent),
  }
}

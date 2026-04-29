'use client'

import { useEffect, useState } from 'react'
import { Download, Share2, Smartphone, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OnVibeLogo } from '@/components/onvibe-logo'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
}

const DISMISSED_AT_KEY = 'onvibe-pwa-install-dismissed-at'
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000
const PROMPT_DELAY_MS = 1500

export function PwaInstallPrompt() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [open, setOpen] = useState(false)
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production' && isLocalHost()) return

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app still works online if registration is blocked.
    })
  }, [])

  useEffect(() => {
    if (isInstalled()) return

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)

      if (!wasRecentlyDismissed()) {
        setOpen(true)
      }
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setOpen(false)
      markDismissed()
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    const timer = window.setTimeout(() => {
      if (!isInstalled() && !wasRecentlyDismissed()) {
        setOpen(true)
      }
    }, PROMPT_DELAY_MS)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt,
      )
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function handleInstall() {
    if (installPrompt) {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice

      setInstallPrompt(null)

      if (choice.outcome === 'accepted') {
        setOpen(false)
        markDismissed()
        return
      }
    }

    setShowFallback(true)
  }

  function handleDismiss() {
    markDismissed()
    setOpen(false)
  }

  if (!open || isInstalled()) {
    return null
  }

  const isAppleMobile = isIOS()

  return (
    <section
      aria-label="Install OnVibe"
      className="safe-fixed-bottom-3 fixed z-50 mx-auto max-w-md rounded-lg border border-border/80 bg-background/95 p-3 text-foreground shadow-2xl shadow-black/40 backdrop-blur md:left-auto md:mx-0"
    >
      <div className="flex items-start gap-3">
        <OnVibeLogo className="mt-0.5 h-11 w-11 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-black tracking-tight">
                Install OnVibe
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Launch from your home screen and keep offline tracks close.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className="ml-auto rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
              aria-label="Dismiss install prompt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {showFallback ? (
            <div className="mt-3 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
              {isAppleMobile
                ? 'Tap Share, then Add to Home Screen.'
                : 'Use your browser menu to install OnVibe.'}
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              onClick={handleInstall}
              className="h-9 flex-1 rounded-md font-black"
            >
              {isAppleMobile && !installPrompt ? (
                <Share2 className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isAppleMobile && !installPrompt ? 'Show how' : 'Install app'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleDismiss}
              className="h-9 rounded-md"
            >
              <Smartphone className="h-4 w-4" />
              Later
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function isInstalled() {
  if (typeof window === 'undefined') return false

  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as NavigatorWithStandalone).standalone === true
  )
}

function isIOS() {
  if (typeof window === 'undefined') return false

  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function isLocalHost() {
  return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
}

function wasRecentlyDismissed() {
  try {
    const dismissedAt = Number(window.localStorage.getItem(DISMISSED_AT_KEY))

    return Number.isFinite(dismissedAt)
      ? Date.now() - dismissedAt < DISMISS_TTL_MS
      : false
  } catch {
    return false
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()))
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

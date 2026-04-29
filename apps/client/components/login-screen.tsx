'use client'

import { LogIn } from 'lucide-react'
import { OnVibeLogo } from '@/components/onvibe-logo'
import { Button } from '@/components/ui/button'
import { startGoogleSignIn } from '@/lib/api'

export function LoginScreen() {
  return (
    <main className="safe-x-5 safe-top-5 safe-bottom-5 relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[60vh] w-[80vw] max-w-3xl -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <section className="relative w-full max-w-md rounded-2xl border border-border/40 bg-card/70 p-8 text-center shadow-2xl shadow-black/40 backdrop-blur">
        <OnVibeLogo className="mx-auto h-20 w-20 rounded-2xl shadow-lg shadow-primary/20" />
        <div className="mt-7 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
          OnVibe
        </div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Sign in to continue
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          Connect your Google account to sync your private music library across
          web, iOS, and Android.
        </p>
        <Button
          type="button"
          onClick={startGoogleSignIn}
          className="mt-7 h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:bg-primary/90 hover:scale-[1.01] active:scale-100"
        >
          <LogIn className="mr-2 h-4 w-4" />
          Continue with Google
        </Button>
        <p className="mt-5 text-xs text-muted-foreground">
          Your library stays on the OnVibe server you host.
        </p>
      </section>
    </main>
  )
}

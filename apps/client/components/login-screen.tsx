'use client'

import { LogIn } from 'lucide-react'
import { BroadsideLogo } from '@/components/broadside-logo'
import { Button } from '@/components/ui/button'
import { startGoogleSignIn } from '@/lib/api'

export function LoginScreen() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-5 text-foreground">
      <section className="w-full max-w-md rounded-xl bg-card p-8 text-center shadow-2xl shadow-black/30">
        <BroadsideLogo className="mx-auto h-20 w-20 rounded-2xl shadow-lg shadow-primary/10" />
        <div className="mt-6 text-xs font-black uppercase tracking-[0.24em] text-primary">
          Broadside
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">
          Sign in to continue
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
          Connect your Google account to sync your private music library across
          web, iOS, and Android.
        </p>
        <Button
          type="button"
          onClick={startGoogleSignIn}
          className="mt-7 h-12 w-full rounded-full bg-primary text-sm font-black text-primary-foreground hover:bg-primary/90"
        >
          <LogIn className="mr-2 h-4 w-4" />
          Continue with Google
        </Button>
        <p className="mt-5 text-xs text-muted-foreground">
          Your library stays on the Broadside server you host.
        </p>
      </section>
    </main>
  )
}

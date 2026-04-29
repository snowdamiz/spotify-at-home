'use client'

import { useState, type FormEvent } from 'react'
import { KeyRound, Loader2, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { logout, redeemEntryKey } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { toast } from '@/hooks/use-toast'

export function EntryKeyScreen() {
  const { setUser, user } = useAuth()
  const [key, setKey] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const keyReady = key.length === 5

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) return

    setSubmitting(true)

    try {
      const result = await redeemEntryKey(key)

      if (result.status === 'anonymous' || !result.user) {
        setUser(null)
        toast({
          title: 'Sign in again',
          description: 'Your session expired before the key could be used.',
          variant: 'destructive',
        })
        return
      }

      setUser(result.user)
      toast({
        title: 'Entry key accepted',
        description: 'This account can now use OnVibe.',
      })
    } catch (error) {
      toast({
        title: 'Could not use that key',
        description:
          error instanceof Error ? error.message : 'Check the key and try again.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogout() {
    await logout()
    setUser(null)
  }

  return (
    <main className="safe-x-5 safe-top-5 safe-bottom-5 relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[60vh] w-[80vw] max-w-3xl -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <section className="relative w-full max-w-md rounded-2xl border border-border/40 bg-card/70 p-8 shadow-2xl shadow-black/40 backdrop-blur">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/20">
          <KeyRound className="h-9 w-9" />
        </div>
        <div className="mt-7 text-center text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
          OnVibe
        </div>
        <h1 className="mt-3 text-center text-3xl font-bold tracking-tight">
          Enter your access key
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-center text-sm leading-6 text-muted-foreground">
          {user
            ? `${user.email} is signed in. Use a one-time entry key to finish setting up this account.`
            : 'Use a one-time entry key to finish setting up this account.'}
        </p>
        <form onSubmit={handleSubmit} className="mt-7 space-y-3">
          <Input
            value={key}
            onChange={(event) => setKey(formatEntryKey(event.target.value))}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            inputMode="text"
            maxLength={5}
            spellCheck={false}
            className="h-12 rounded-full text-center text-base font-bold uppercase tracking-[0.28em]"
            placeholder="A1B2C"
            required
          />
          <Button
            type="submit"
            disabled={submitting || !keyReady}
            className="h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-transform hover:bg-primary/90 hover:scale-[1.01] active:scale-100"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking key
              </>
            ) : (
              <>
                <KeyRound className="mr-2 h-4 w-4" />
                Unlock account
              </>
            )}
          </Button>
        </form>
        <Button
          type="button"
          variant="ghost"
          onClick={handleLogout}
          className="mt-3 h-11 w-full rounded-full text-muted-foreground"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Use another account
        </Button>
      </section>
    </main>
  )
}

function formatEntryKey(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5)
}

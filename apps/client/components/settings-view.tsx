'use client'

import { LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logout, startGoogleSignIn } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useImportPolicy } from '@/lib/library-hooks'

type SettingsViewProps = {
  onSignedOut: () => void
}

export function SettingsView({ onSignedOut }: SettingsViewProps) {
  const { setUser, user } = useAuth()
  const importPolicy = useImportPolicy()

  async function handleLogout() {
    await logout()
    setUser(null)
    onSignedOut()
  }

  return (
    <div className="px-4 pb-6 md:px-6">
      <header className="pt-2 pb-5">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Account, storage, and import controls for this Tunely client.
        </p>
      </header>

      {importPolicy.policy.mode === 'open_test' && (
        <section className="mb-4 rounded-lg bg-primary p-4 text-primary-foreground">
          <div className="text-xs font-black uppercase tracking-wider">
            {importPolicy.policy.copy.badge}
          </div>
          <p className="mt-1 text-sm font-semibold">
            {importPolicy.policy.copy.description}
          </p>
        </section>
      )}

      <div className="grid gap-3">
        <section className="rounded-lg bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">Account</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {user
                  ? `Signed in as ${user.displayName ?? user.email}`
                  : 'You are not signed in.'}
              </p>
              <Button
                type="button"
                onClick={user ? handleLogout : startGoogleSignIn}
                variant={user ? 'secondary' : 'default'}
                className="mt-4 rounded-full"
              >
                {user ? (
                  <>
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </>
                ) : (
                  'Continue with Google'
                )}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Storage</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Imported music syncs through your self-hosted Tunely server and
                streams back through authenticated requests.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg bg-card p-4">
          <h2 className="text-base font-bold">Import policy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {importPolicy.policy.copy.label}
          </p>
          {importPolicy.status === 'error' && (
            <p className="mt-2 text-xs text-destructive">
              Could not refresh the import policy from the server.
            </p>
          )}
        </section>
      </div>
    </div>
  )
}

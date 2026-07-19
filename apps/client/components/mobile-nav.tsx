'use client'

import { Home, Library, Search, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { View } from '@/lib/music-types'

type MobileNavProps = {
  view: View
  setView: (v: View) => void
}

const items: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <Home className="h-5 w-5" /> },
  { id: 'search', label: 'Search', icon: <Search className="h-5 w-5" /> },
  { id: 'library', label: 'Library', icon: <Library className="h-5 w-5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-5 w-5" /> },
]

export function MobileNav({ view, setView }: MobileNavProps) {
  // Admin is reachable via Settings → Admin section (settings-view.tsx) so
  // the mobile tab bar always renders the same four anchors regardless of
  // role, keeping muscle memory stable.
  const activeId = view === 'admin' ? 'settings' : view

  return (
    <nav
      className="safe-x md:hidden border-t border-border/60 bg-[var(--pwa-chrome)]"
      aria-label="Primary"
    >
      <ul className="safe-bottom-nav grid grid-cols-4">
        {items.map((item) => {
          const active = activeId === item.id
          return (
            <li key={item.id}>
              <button
                onClick={() => setView(item.id)}
                className={cn(
                  'relative flex w-full flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium tracking-tight transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-0 h-[2px] w-8 rounded-full bg-primary transition-all duration-300',
                    active ? 'scale-x-100 opacity-100' : 'scale-x-0 opacity-0',
                  )}
                />
                <span className={cn(active && 'ov-icon-pop')}>{item.icon}</span>
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

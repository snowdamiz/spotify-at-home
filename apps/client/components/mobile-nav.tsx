'use client'

import { Home, Library, Search, Settings, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { View } from '@/lib/music-types'

type MobileNavProps = {
  isAdmin: boolean
  view: View
  setView: (v: View) => void
}

const primaryItems: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <Home className="h-5 w-5" /> },
  { id: 'search', label: 'Search', icon: <Search className="h-5 w-5" /> },
  { id: 'library', label: 'Library', icon: <Library className="h-5 w-5" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-5 w-5" /> },
]

export function MobileNav({ isAdmin, view, setView }: MobileNavProps) {
  const items = isAdmin
    ? [
        ...primaryItems.slice(0, 3),
        { id: 'admin' as const, label: 'Admin', icon: <ShieldCheck className="h-5 w-5" /> },
        primaryItems[3],
      ]
    : primaryItems

  return (
    <nav
      className="safe-x md:hidden border-t border-border/60 bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/75"
      aria-label="Primary"
    >
      <ul
        className={
          isAdmin
            ? 'safe-bottom-nav grid grid-cols-5'
            : 'safe-bottom-nav grid grid-cols-4'
        }
      >
        {items.map((item) => {
          const active = view === item.id
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
                    'absolute top-0 h-[2px] w-8 rounded-full bg-primary transition-opacity',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
                {item.icon}
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

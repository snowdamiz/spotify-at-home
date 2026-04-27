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
  return (
    <nav
      className="md:hidden border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      aria-label="Primary"
    >
      <ul className="grid grid-cols-4 pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active = view === item.id
          return (
            <li key={item.id}>
              <button
                onClick={() => setView(item.id)}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
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

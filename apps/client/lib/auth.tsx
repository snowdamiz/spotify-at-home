'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchCurrentUser, type CurrentUser } from '@/lib/api'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

type AuthContextValue = {
  status: AuthStatus
  user: CurrentUser | null
  refresh: () => Promise<void>
  setUser: (user: CurrentUser | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)
const CACHED_USER_STORAGE_KEY = 'onvibe:auth-user:v1'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  const setUser = useCallback((next: CurrentUser | null) => {
    setUserState(next)
    setStatus(next ? 'authenticated' : 'anonymous')

    if (next) {
      writeCachedCurrentUser(next)
    } else {
      clearCachedCurrentUser()
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      setUser(await fetchCurrentUser())
    } catch {
      const cachedUser = readCachedCurrentUser()

      if (cachedUser) {
        setUserState(cachedUser)
        setStatus('authenticated')
        return
      }

      setUser(null)
    }
  }, [setUser])

  useEffect(() => {
    refresh()
  }, [refresh])

  const value = useMemo(
    () => ({ refresh, setUser, status, user }),
    [refresh, setUser, status, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function readCachedCurrentUser() {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(CACHED_USER_STORAGE_KEY)
    if (!raw) return null

    const value = JSON.parse(raw) as Partial<CurrentUser>

    if (
      typeof value.id !== 'string' ||
      typeof value.email !== 'string' ||
      typeof value.hasEntryAccess !== 'boolean' ||
      typeof value.isAdmin !== 'boolean'
    ) {
      return null
    }

    return {
      avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
      displayName:
        typeof value.displayName === 'string' ? value.displayName : null,
      email: value.email,
      entryKeyRedeemedAt:
        typeof value.entryKeyRedeemedAt === 'string'
          ? value.entryKeyRedeemedAt
          : null,
      hasEntryAccess: value.hasEntryAccess,
      id: value.id,
      isAdmin: value.isAdmin,
    } satisfies CurrentUser
  } catch {
    return null
  }
}

function writeCachedCurrentUser(user: CurrentUser) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CACHED_USER_STORAGE_KEY, JSON.stringify(user))
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

function clearCachedCurrentUser() {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(CACHED_USER_STORAGE_KEY)
  } catch {
    // Some browser privacy modes can disable local storage.
  }
}

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }

  return value
}

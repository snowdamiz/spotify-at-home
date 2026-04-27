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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<CurrentUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  const setUser = useCallback((next: CurrentUser | null) => {
    setUserState(next)
    setStatus(next ? 'authenticated' : 'anonymous')
  }, [])

  const refresh = useCallback(async () => {
    try {
      setUser(await fetchCurrentUser())
    } catch {
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

export function useAuth() {
  const value = useContext(AuthContext)

  if (!value) {
    throw new Error('useAuth must be used inside an AuthProvider')
  }

  return value
}

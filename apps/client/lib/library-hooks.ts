'use client'

import { useEffect, useState } from 'react'
import {
  defaultImportPolicy,
  emptyLibrarySummary,
  fetchImportPolicy,
  fetchLibrarySummary,
  fetchPlaylist,
  fetchSongs,
  searchLibrary,
  type LibrarySearchResults,
  type LibrarySummary,
  type ServerImportPolicy,
  type ServerPlaylistDetail,
  type ServerSong,
} from '@/lib/api'

export type SongsState =
  | { status: 'loading'; songs: ServerSong[] }
  | { status: 'anonymous'; songs: ServerSong[] }
  | { status: 'authenticated'; songs: ServerSong[] }
  | { status: 'error'; songs: ServerSong[] }

export function useSongs(revision = 0): SongsState {
  const [state, setState] = useState<SongsState>({
    songs: [],
    status: 'loading',
  })

  useEffect(() => {
    let mounted = true

    setState((current) => ({ songs: current.songs, status: 'loading' }))
    fetchSongs()
      .then((result) => {
        if (mounted) {
          setState(result)
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ songs: [], status: 'error' })
        }
      })

    return () => {
      mounted = false
    }
  }, [revision])

  return state
}

export type LibrarySummaryState =
  | { status: 'loading'; summary: LibrarySummary }
  | { status: 'anonymous'; summary: LibrarySummary }
  | { status: 'authenticated'; summary: LibrarySummary }
  | { status: 'error'; summary: LibrarySummary }

export function useLibrarySummary(revision = 0): LibrarySummaryState {
  const [state, setState] = useState<LibrarySummaryState>({
    status: 'loading',
    summary: emptyLibrarySummary(),
  })

  useEffect(() => {
    let mounted = true

    setState((current) => ({ status: 'loading', summary: current.summary }))
    fetchLibrarySummary()
      .then((result) => {
        if (mounted) {
          setState(result)
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ status: 'error', summary: emptyLibrarySummary() })
        }
      })

    return () => {
      mounted = false
    }
  }, [revision])

  return state
}

export type ImportPolicyState =
  | { status: 'loading'; policy: ServerImportPolicy }
  | { status: 'ready'; policy: ServerImportPolicy }
  | { status: 'error'; policy: ServerImportPolicy }

export function useImportPolicy(): ImportPolicyState {
  const [state, setState] = useState<ImportPolicyState>({
    policy: defaultImportPolicy(),
    status: 'loading',
  })

  useEffect(() => {
    let mounted = true

    fetchImportPolicy()
      .then((policy) => {
        if (mounted) {
          setState({ policy, status: 'ready' })
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ policy: defaultImportPolicy(), status: 'error' })
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  return state
}

export type LibrarySearchState =
  | { status: 'idle'; results: LibrarySearchResults }
  | { status: 'loading'; results: LibrarySearchResults }
  | { status: 'anonymous'; results: LibrarySearchResults }
  | { status: 'authenticated'; results: LibrarySearchResults }
  | { status: 'error'; results: LibrarySearchResults }

const emptySearchResults: LibrarySearchResults = {
  playlists: [],
  songs: [],
}

export function useLibrarySearch(query: string, revision = 0): LibrarySearchState {
  const [state, setState] = useState<LibrarySearchState>({
    results: emptySearchResults,
    status: 'idle',
  })
  const trimmedQuery = query.trim()

  useEffect(() => {
    let mounted = true

    if (!trimmedQuery) {
      setState({ results: emptySearchResults, status: 'idle' })
      return () => {
        mounted = false
      }
    }

    setState({ results: emptySearchResults, status: 'loading' })
    searchLibrary(trimmedQuery)
      .then((result) => {
        if (mounted) {
          setState({ results: result.results, status: result.status })
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ results: emptySearchResults, status: 'error' })
        }
      })

    return () => {
      mounted = false
    }
  }, [trimmedQuery, revision])

  return state
}

export type PlaylistState =
  | { status: 'loading'; playlist: ServerPlaylistDetail | null }
  | { status: 'anonymous'; playlist: ServerPlaylistDetail | null }
  | { status: 'authenticated'; playlist: ServerPlaylistDetail }
  | { status: 'not-found'; playlist: ServerPlaylistDetail | null }
  | { status: 'error'; playlist: ServerPlaylistDetail | null }

export function usePlaylist(playlistId?: string, revision = 0): PlaylistState {
  const [state, setState] = useState<PlaylistState>({
    playlist: null,
    status: 'loading',
  })

  useEffect(() => {
    let mounted = true

    if (!playlistId) {
      setState({ playlist: null, status: 'not-found' })
      return () => {
        mounted = false
      }
    }

    setState({ playlist: null, status: 'loading' })
    fetchPlaylist(playlistId)
      .then((result) => {
        if (mounted) {
          setState(result)
        }
      })
      .catch(() => {
        if (mounted) {
          setState({ playlist: null, status: 'error' })
        }
      })

    return () => {
      mounted = false
    }
  }, [playlistId, revision])

  return state
}

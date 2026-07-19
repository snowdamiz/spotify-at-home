// Resolves the media source for a track so the audio element can switch
// songs *synchronously*. Mobile browsers revoke background-playback
// permission when there is an async gap (IndexedDB read, network fetch)
// between a track ending and the next `play()` call, so the `ended`
// handler must be able to grab a ready-to-use URL without awaiting.
// Offline copies are resolved ahead of time via `preload`; anything not
// preloaded falls back to the credentialed stream URL.

export type PlaybackSourceKind = 'offline' | 'stream'

export type PlaybackSource = {
  kind: PlaybackSourceKind
  url: string
}

type TrackSourceDeps<T> = {
  getOfflineBlob: (track: T) => Promise<Blob | null>
  createObjectUrl: (blob: Blob) => string
  revokeObjectUrl: (url: string) => void
  streamUrl: (trackId: string) => string
}

type CacheEntry = {
  objectUrl: string | null
  pending: Promise<void> | null
}

export class TrackSourceCache<T extends { id: string }> {
  private readonly deps: TrackSourceDeps<T>
  private readonly entries = new Map<string, CacheEntry>()

  constructor(deps: TrackSourceDeps<T>) {
    this.deps = deps
  }

  /**
   * Returns the best source available right now, without awaiting:
   * a preloaded offline object URL when ready, else the stream URL.
   */
  getSync(track: T): PlaybackSource {
    const entry = this.entries.get(track.id)

    if (entry?.objectUrl) {
      return { kind: 'offline', url: entry.objectUrl }
    }

    return { kind: 'stream', url: this.deps.streamUrl(track.id) }
  }

  /** Resolves the track's offline copy so a later getSync can use it. */
  preload(track: T): Promise<void> {
    const existing = this.entries.get(track.id)

    if (existing) {
      return existing.pending ?? Promise.resolve()
    }

    const entry: CacheEntry = { objectUrl: null, pending: null }

    entry.pending = this.deps
      .getOfflineBlob(track)
      .then((blob) => {
        // Ignore results for entries pruned while the read was in flight.
        if (this.entries.get(track.id) !== entry) return
        if (blob) {
          entry.objectUrl = this.deps.createObjectUrl(blob)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        entry.pending = null
      })

    this.entries.set(track.id, entry)

    return entry.pending
  }

  /** Drops (and revokes) every cached entry not in keepIds. */
  prune(keepIds: Iterable<string>) {
    const keep = new Set(keepIds)

    for (const [trackId, entry] of this.entries) {
      if (keep.has(trackId)) continue
      if (entry.objectUrl) {
        this.deps.revokeObjectUrl(entry.objectUrl)
      }
      this.entries.delete(trackId)
    }
  }

  dispose() {
    this.prune([])
  }
}

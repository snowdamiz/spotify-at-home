# SQLite Library Schema

## Status

Accepted

## Context

Tunely stores private user libraries on the self-hosted API. The first durable schema needs to cover authentication-owned users and sessions, imported songs, playlists, likes, playback state, and import jobs while keeping all user-owned reads scoped by user ID.

## Decision

The API uses SQLite with foreign keys enabled on every connection and WAL mode for file-backed databases. The initial migration creates:

- `users`, `oauth_accounts`, `sessions`, and `pending_session_exchanges`
- `songs`, `external_sources`, `playlists`, `playlist_songs`, `likes`, `playback_state`, and `import_jobs`
- indexes for session lookup, user library reads, search inputs, playlist ordering, likes, and import job status

Repository methods for user-owned song data require `userId` alongside resource IDs. Playlist membership writes also verify that both the playlist and song belong to the same user.

## Delete Behavior

Deleting a song removes rows that only make sense while the song exists:

- `external_sources` cascades on song delete.
- `playlist_songs` cascades on song delete.
- `likes` cascades on song delete.
- `import_jobs` cascades on song delete.
- `playback_state.song_id` is set to `NULL` so the user's playback preferences and last position row can survive without referencing deleted media.

Deleting a user cascades through that user's OAuth accounts, sessions, songs, playlists, likes, playback state, and import jobs.

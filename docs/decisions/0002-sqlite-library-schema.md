# SQLite Library Schema

## Status

Accepted

## Context

Broadside stores private user libraries on the self-hosted API. The first durable schema needs to cover authentication-owned users and sessions, imported songs, playlists, likes, playback state, and import jobs while keeping all user-owned reads scoped by user ID.

## Decision

The API uses SQLite with foreign keys enabled on every connection and WAL mode for file-backed databases. The initial migration creates:

- `users`, `oauth_accounts`, `sessions`, and `pending_session_exchanges`
- `songs`, `external_sources`, `playlists`, `playlist_songs`, `likes`, `playback_state`, and `import_jobs`
- indexes for session lookup, user library reads, search inputs, playlist ordering, likes, and import job status

Repository methods for user-owned song data require `userId` alongside resource IDs. Playlist membership writes also verify that both the playlist and song belong to the same user.

## Delete Behavior

Deleting a song from a library soft-deletes the `songs` row with `deleted_at` so shared audio artifacts can remain reusable for future imports:

- `external_sources` stays attached to the soft-deleted song as reusable source metadata.
- `playlist_songs`, `likes`, and `import_jobs` for that user/song are removed.
- `playback_state.song_id` is set to `NULL` so the user's playback preferences and last position row can survive without referencing deleted media.
- R2/local audio storage is not deleted by the user-facing delete route.

Deleting a user cascades through that user's OAuth accounts, sessions, songs, playlists, likes, playback state, and import jobs.

# Tunely TDD Phased Build Plan

## 1. Project Overview

Tunely is a Spotify-like music app for a user's own imported songs. It will be built as an Expo app that exports to web, iOS, and Android. The app should match the existing UI mockups in `ui-imgs/`, including the dark visual system, green identity mark, Home/Search/Library navigation, responsive web sidebar, mobile bottom tabs, import-first empty states, playlist cards, and persistent playback controls.

The core product promise is:

- Users sign in with Google OAuth.
- Users import their own audio files.
- Imported songs are private to the importing user.
- A user's imported songs are available from both the mobile and web apps.
- Playback streams from the self-hosted backend and can be cached locally for repeat playback.
- There is no Spotify API, no global catalog, no Supabase, no Firebase, no R2, no S3, and no managed backend dependency in the initial architecture.

## 2. Final Architecture

### Client

- Expo app with TypeScript and Expo Router.
- One codebase for web, iOS, and Android.
- React Native Web for browser export.
- `expo-document-picker` for audio file imports.
- `expo-audio` for playback.
- Secure token storage on mobile.
- Browser session handled through secure cookies where practical.
- Local cache for downloaded or previously streamed audio.

### Backend

- Fastify TypeScript API running on a small VPS.
- Google OAuth Authorization Code with PKCE.
- SQLite database in WAL mode.
- Private audio files stored on VPS disk or an attached block volume.
- HTTP range streaming for performant playback and seeking.
- Caddy or Nginx terminates HTTPS and serves the web export.
- Docker Compose runs the app stack.

### Deployment Shape

Initial personal/beta deployment:

```text
VPS
├── caddy or nginx
│   ├── serves Expo web build
│   └── proxies /api/* to Fastify
├── fastify api
├── data
│   ├── tunely.sqlite
│   ├── tunely.sqlite-wal
│   ├── audio/<userId>/<songId>/original
│   └── backups/
└── docker-compose.yml
```

SQLite is chosen for lowest operational complexity. Audio storage uses local VPS disk first because it is cheap, fast, and avoids extra SaaS providers. If storage needs grow, move `data/audio` to an attached block volume without changing client behavior.

## 3. TDD Working Rules

Every feature phase should be implemented as vertical slices using red-green-refactor:

1. Write one failing test for one observable behavior through a public interface.
2. Run the test and confirm it fails for the expected reason.
3. Write the minimum code to make it pass.
4. Run the test and confirm it passes.
5. Refactor only while the suite is green.
6. Add the next behavior test.

Do not write all tests up front. Do not test private helpers directly unless they become a stable module boundary. Mock external I/O only when needed: Google OAuth, filesystem, network, clock, and native device APIs.

Suggested test stack:

- Vitest for API and shared TypeScript modules.
- Supertest or Fastify inject tests for HTTP routes.
- Drizzle, Kysely, or direct SQL migrations tested against temporary SQLite databases.
- React Native Testing Library for route/component behavior.
- Playwright for web smoke tests after the Expo web export exists.
- Manual device checks for import and playback APIs that depend on native OS behavior.

## 4. Phase 0: Repo Foundation

Goal: create a maintainable monorepo shape before app behavior exists.

Recommended structure:

```text
apps/
  app/       Expo app
  api/       Fastify API
packages/
  shared/    shared schemas, API types, validation
docs/
  decisions/
ui-imgs/
TUNELY-PHASED-PLAN.md
```

TDD slices:

1. RED: add a workspace health test that expects the shared package to export an app name constant.
   GREEN: create the shared package and export `APP_NAME = "Tunely"`.
   REFACTOR: set up path aliases and package boundaries cleanly.

2. RED: add an API health route test for `GET /api/health`.
   GREEN: create the Fastify app factory and return `{ ok: true }`.
   REFACTOR: separate app construction from server startup.

3. RED: add an Expo smoke test or static route test that expects the Home route to render "Tunely".
   GREEN: scaffold Expo Router and the Home screen.
   REFACTOR: extract a shared layout wrapper.

Acceptance:

- Root package scripts exist for typecheck, test, lint, and build.
- API can be tested without binding a real port.
- Expo app can run on web.
- No production database or OAuth dependency is needed for tests.

## 5. Phase 1: Mockup-Matched UI Shell

Goal: implement the user-facing screens from the mockups with local mock data.

Screens:

- Home
- Search
- Library
- Playlist detail
- Player or now-playing route
- Settings
- Login

UI requirements:

- Dark background.
- Green circular Tunely identity mark.
- Home/Search/Library navigation.
- Mobile bottom tabs.
- Web sidebar.
- Import buttons in Home and Library.
- Empty states from the mockups.
- Playlist cards and shortcut rows.
- Persistent mini-player area reserved above mobile tabs.

TDD slices:

1. RED: Home route renders the app header, greeting, import action, and playlist shortcuts with mock data.
   GREEN: implement Home with static mock collections.
   REFACTOR: extract reusable `AppHeader`, `ImportButton`, and `PlaylistShortcut`.

2. RED: navigation renders bottom tabs on narrow screens and a sidebar on wide screens.
   GREEN: implement responsive layout behavior.
   REFACTOR: centralize breakpoint and spacing tokens.

3. RED: Library route renders the "No songs yet" empty state when the mock library is empty.
   GREEN: implement Library empty state.
   REFACTOR: extract `EmptyLibraryPanel`.

4. RED: Search route filters mock songs/playlists by query.
   GREEN: implement local search state.
   REFACTOR: move search filtering into a shared pure function.

5. RED: mini-player renders nothing when there is no current track and renders title/controls when one is selected.
   GREEN: implement playback shell state with mock data.
   REFACTOR: extract player store interface without real audio yet.

Acceptance:

- UI visually tracks the mockups in `ui-imgs/`.
- App runs on Expo web and mobile simulator.
- All UI tests pass without backend.
- Layout does not overlap on common mobile and desktop widths.

## 6. Phase 2: Self-Hosted Google OAuth

Goal: users can sign in with Google through the self-hosted Fastify API.

Auth design:

- Google OAuth Authorization Code with PKCE.
- Server validates `state`, `iss`, `aud`, `exp`, and Google identity claims.
- Server creates or updates a local `users` row.
- Server issues Tunely access and refresh sessions.
- Refresh tokens are stored hashed in SQLite.
- Web uses secure HTTP-only cookies where possible.
- Mobile uses deep links and a one-time session exchange, then stores refresh credentials securely.

Public API:

- `GET /api/auth/google/start`
- `GET /api/auth/google/callback`
- `POST /api/auth/session/exchange`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/me`

TDD slices:

1. RED: `GET /api/auth/google/start` returns a redirect URL containing Google OAuth parameters and stores a state challenge.
   GREEN: implement OAuth start route with generated state and PKCE verifier.
   REFACTOR: isolate OAuth state storage behind an interface.

2. RED: callback rejects a missing or mismatched state.
   GREEN: validate state before token exchange.
   REFACTOR: standardize auth error responses.

3. RED: callback with a mocked valid Google token creates a user and OAuth account.
   GREEN: implement user upsert and account linking.
   REFACTOR: extract auth service.

4. RED: refresh rejects a reused or revoked refresh token.
   GREEN: hash refresh tokens and rotate on every refresh.
   REFACTOR: add session repository methods.

5. RED: `GET /api/me` returns 401 without a valid session and user profile with a valid session.
   GREEN: implement auth guard.
   REFACTOR: register route-level auth plugin.

Acceptance:

- OAuth callback is protected against CSRF through state.
- Refresh tokens rotate.
- Logout revokes the active session.
- Auth tests use mocked Google responses.
- No Google secret is required in local test runs.

## 7. Phase 3: SQLite Schema And Migrations

Goal: define durable local persistence for users, sessions, songs, playlists, likes, and playback state.

Recommended tables:

### `users`

- `id`
- `email`
- `display_name`
- `avatar_url`
- `created_at`
- `updated_at`

### `oauth_accounts`

- `id`
- `user_id`
- `provider`
- `provider_subject`
- `email`
- `created_at`
- unique provider plus provider subject

### `sessions`

- `id`
- `user_id`
- `refresh_token_hash`
- `user_agent`
- `ip_address`
- `expires_at`
- `revoked_at`
- `created_at`
- `rotated_at`

### `songs`

- `id`
- `user_id`
- `title`
- `artist`
- `album`
- `duration_ms`
- `mime_type`
- `size_bytes`
- `checksum`
- `storage_path`
- `import_status`
- `created_at`
- `updated_at`

### `playlists`

- `id`
- `user_id`
- `name`
- `description`
- `color`
- `created_at`
- `updated_at`

### `playlist_songs`

- `playlist_id`
- `song_id`
- `position`
- `added_at`

### `likes`

- `user_id`
- `song_id`
- `created_at`

### `playback_state`

- `user_id`
- `song_id`
- `position_ms`
- `shuffle_enabled`
- `repeat_mode`
- `updated_at`

### `import_jobs`

- `id`
- `user_id`
- `song_id`
- `status`
- `error_code`
- `created_at`
- `updated_at`

TDD slices:

1. RED: migration test creates all tables in a temporary SQLite database and verifies foreign keys are enabled.
   GREEN: add initial migration and SQLite connection setup.
   REFACTOR: make migration runner idempotent.

2. RED: user isolation test cannot query another user's songs through repository methods.
   GREEN: require `userId` in all song repository reads/writes.
   REFACTOR: remove any repository method that accepts only `songId` for user-owned data.

3. RED: playlist ordering test returns songs in `position` order.
   GREEN: implement playlist repository query.
   REFACTOR: add indexes for common user-scoped queries.

4. RED: delete song test removes playlist membership, likes, playback state references, and import jobs.
   GREEN: add foreign keys and cascade behavior where appropriate.
   REFACTOR: document delete behavior.

Acceptance:

- Migrations can run repeatedly.
- SQLite runs in WAL mode.
- Foreign keys are enforced.
- User-owned reads require user context.
- Indexes exist for library, search, playlist, and session lookup paths.

## 8. Phase 4: Audio Import And Private VPS Storage

Goal: users can import audio files from web or mobile and have them stored privately on the VPS.

Import behavior:

- User selects files with `expo-document-picker`.
- Client sends file metadata and upload content to the API.
- API validates auth, MIME type, extension, file size, and available quota.
- API creates a pending song/import job.
- API writes file to a private path outside the web root.
- API computes checksum and updates song status to ready.
- Failed imports leave a visible error and clean up partial files.

Recommended MVP limits:

- Max song file size: 100 MB.
- Allowed MIME types: MP3, M4A/AAC, WAV, FLAC, OGG where supported by platform playback.
- Per-user storage quota: configurable, default 2 GB for beta.

Public API:

- `POST /api/songs/import`
- `GET /api/songs`
- `GET /api/songs/:id`
- `PUT /api/songs/:id`
- `DELETE /api/songs/:id`

TDD slices:

1. RED: unauthenticated import request returns 401.
   GREEN: protect import route.
   REFACTOR: apply shared auth guard to all song routes.

2. RED: import rejects unsupported MIME types.
   GREEN: implement MIME and extension validation.
   REFACTOR: move validation into shared schema.

3. RED: import rejects files larger than the configured max.
   GREEN: enforce file size limit before writing full content.
   REFACTOR: centralize quota config.

4. RED: successful import creates a ready song row and stores the file under the authenticated user's directory.
   GREEN: implement storage write and database update.
   REFACTOR: extract `AudioStorage` interface for local disk.

5. RED: failed file write marks import as failed and does not leave a ready song.
   GREEN: add failure handling and cleanup.
   REFACTOR: wrap import in a transaction where possible.

6. RED: deleting a song removes metadata and the private file.
   GREEN: implement deletion flow.
   REFACTOR: make file cleanup idempotent.

Acceptance:

- Imported files are not publicly addressable.
- Files are scoped by user and song ID.
- Partial imports do not appear as playable songs.
- User can import from web and mobile.
- Import tests cover auth, validation, success, and failure cleanup.

## 9. Phase 5: Streaming Playback And Hybrid Cache

Goal: users can play imported songs across web and mobile, with local caching for smoother repeat playback.

Streaming behavior:

- Client requests stream for a song.
- API verifies the user owns the song.
- API serves the audio file with proper headers.
- API supports HTTP range requests for seeking.
- Client plays the stream through `expo-audio`.
- Client caches songs after successful playback or explicit cache/download action.
- Cached files are used before streaming when available.

Public API:

- `GET /api/songs/:id/stream`
- `GET /api/playback-state`
- `PUT /api/playback-state`
- `POST /api/songs/:id/cache-intent`

TDD slices:

1. RED: stream route returns 401 without auth and 404 for another user's song.
   GREEN: enforce owner-scoped lookup.
   REFACTOR: reuse song authorization helper.

2. RED: stream route returns correct content type, content length, and accepts range headers.
   GREEN: implement file streaming and byte-range support.
   REFACTOR: extract range parsing into a tested pure function.

3. RED: invalid range returns 416.
   GREEN: validate range bounds.
   REFACTOR: standardize streaming errors.

4. RED: player store loads a song, toggles play/pause, and exposes current track state.
   GREEN: implement player state wrapper around `expo-audio`.
   REFACTOR: separate platform audio adapter from app state.

5. RED: cache resolver returns local URI when a cached song exists and stream URL otherwise.
   GREEN: implement cache lookup.
   REFACTOR: extract cache repository for web/mobile differences.

6. RED: clear cache removes cached files and leaves cloud library intact.
   GREEN: implement cache settings action.
   REFACTOR: add cache size calculation.

Acceptance:

- Playback works on web and mobile.
- Seeking works through range requests.
- Users cannot stream another user's song.
- Cached songs play from local storage when available.
- Clearing cache does not delete imported songs from the account.

## 10. Phase 6: Library, Search, And Playlist Features

Goal: replace mock data with real user-owned library behavior while preserving the mockup UX.

Library behavior:

- Home shows import actions, recent songs, liked songs, and playlist shortcuts.
- Search searches only the user's imported songs and playlists.
- Library lists imported songs, playlists, liked songs, and empty state.
- Users can create, rename, delete, and reorder playlists.
- Users can add/remove songs from playlists.
- Liked Songs behaves like a system playlist backed by the `likes` table.

Public API:

- `GET /api/library/summary`
- `GET /api/search?query=&cursor=&limit=`
- `GET /api/playlists`
- `POST /api/playlists`
- `GET /api/playlists/:id`
- `PUT /api/playlists/:id`
- `DELETE /api/playlists/:id`
- `POST /api/playlists/:id/songs`
- `DELETE /api/playlists/:id/songs/:songId`
- `PUT /api/playlists/:id/order`
- `POST /api/songs/:id/like`
- `DELETE /api/songs/:id/like`

TDD slices:

1. RED: library summary returns empty-state data for a new user.
   GREEN: implement summary endpoint.
   REFACTOR: define shared response schema.

2. RED: after importing songs, library summary returns recent songs and counts.
   GREEN: query real songs.
   REFACTOR: add pagination defaults.

3. RED: search returns only matching songs/playlists owned by the authenticated user.
   GREEN: implement user-scoped search.
   REFACTOR: add indexes and normalize query handling.

4. RED: creating a playlist returns 201 and the playlist appears in Library.
   GREEN: implement playlist creation.
   REFACTOR: extract playlist service.

5. RED: adding songs to a playlist preserves order.
   GREEN: implement membership insert and ordering.
   REFACTOR: make reorder operation transactional.

6. RED: liking a song adds it to Liked Songs, unliking removes it.
   GREEN: implement likes endpoints.
   REFACTOR: make duplicate like operations idempotent.

7. RED: client Home/Search/Library render API data and loading/error states.
   GREEN: wire client data fetching.
   REFACTOR: extract typed API client hooks.

Acceptance:

- All screenshots' implied flows are functional.
- Search never returns non-owned songs.
- Playlist ordering is stable.
- Empty, loading, and error states are covered.
- Web and mobile show the same imported library after sign-in.

## 11. Phase 7: Deployment, Backups, Monitoring, And Cost Controls

Goal: ship a reliable personal/beta deployment on one small VPS.

Deployment components:

- Multi-stage Dockerfile for API.
- Expo web export served by Caddy or Nginx.
- Docker Compose with named volumes or host-mounted `data/`.
- HTTPS with automatic certificates.
- Environment variables for Google OAuth credentials, session secrets, storage paths, quotas, and public URLs.

Backups:

- Scheduled SQLite online backup to `data/backups`.
- Scheduled archive or rsync of `data/audio`.
- Backup restore procedure documented.
- Optional offsite copy to a machine you control.

Monitoring:

- `GET /api/health`
- disk usage checks
- structured API logs
- upload failure logs
- playback stream error logs
- auth callback error logs

Cost controls:

- per-user quota
- upload size limit
- supported MIME allowlist
- admin storage report
- graceful upload rejection when disk is low

TDD slices:

1. RED: health endpoint reports database connectivity and storage writability.
   GREEN: implement health checks.
   REFACTOR: separate shallow and deep health checks if needed.

2. RED: quota check rejects imports that would exceed user quota.
   GREEN: implement quota accounting.
   REFACTOR: centralize quota policy.

3. RED: low disk simulation rejects new imports with a stable error code.
   GREEN: add disk availability check.
   REFACTOR: isolate filesystem stats provider for tests.

4. RED: backup script dry-run verifies database and audio paths exist.
   GREEN: add backup script.
   REFACTOR: document restore command.

5. RED: Docker build test or CI job confirms the API image builds.
   GREEN: add Dockerfile and Compose config.
   REFACTOR: reduce image size and run as non-root.

Acceptance:

- VPS deploy can be recreated from repo docs.
- HTTPS works.
- Database and audio files are backed up.
- Disk exhaustion fails safely.
- The app can be updated without deleting user data.

## 12. API Error Shape

Every API error should use this shape:

```json
{
  "error": {
    "code": "song_not_found",
    "message": "Song not found",
    "details": {},
    "requestId": "req_123"
  }
}
```

Rules:

- `code` is stable and machine-readable.
- `message` can change and is for humans.
- `details` is structured and safe to expose.
- `requestId` is included in logs.
- Never return `200` with an error body.

## 13. Cross-Platform Acceptance Checklist

Before considering the MVP complete:

- Web, iOS, and Android builds run.
- Google login works on web and mobile.
- A song imported on web appears on mobile.
- A song imported on mobile appears on web.
- Playback works on web and mobile.
- Seeking works on streamed audio.
- Cached playback works after initial stream or explicit cache action.
- Search returns only imported user-owned music.
- Playlists persist across devices.
- Deleting a song removes file and metadata.
- Clearing local cache does not delete cloud library.
- Backups can be created and restored in a test environment.

## 14. Non-Goals For MVP

- Spotify API integration.
- Public music catalog.
- Public profiles.
- Social sharing.
- Collaborative playlists.
- Recommendations based on external catalog data.
- Full offline-first conflict resolution.
- Managed backend providers such as Supabase, Firebase, R2, S3, or managed Postgres.
- Multi-region deployment.
- Native background audio polish beyond what Expo supports in the first version.

## 15. Key Assumptions

- This is personal/beta scale first.
- SQLite is acceptable for the initial self-hosted app.
- Local VPS storage is the preferred performant default.
- If storage grows, `data/audio` can move to an attached block volume without changing the public API.
- Google OAuth is allowed as the only required external identity provider.
- Hybrid cache means server-backed sync plus local playback cache, not a fully offline-first system.
- Tests should pin behavior through public routes, repositories, UI routes, and client adapters rather than private implementation details.


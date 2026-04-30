# OnVibe

OnVibe is a self-hosted music library for importing, organizing, and streaming your own audio collection. It gives each user a private library with Google sign-in, entry-key access control, playlists, search, liked songs, playback state, offline-friendly PWA behavior, and optional external import workflows.

The public product name is OnVibe. Some package names, cookies, database names, and environment variables still use the earlier internal name `broadside`; keep those names as-is when configuring the app.

## Features

- Private per-user music libraries backed by SQLite.
- Google OAuth sign-in with admin users and one-time entry keys for additional accounts.
- Audio upload, metadata editing, byte-range streaming, liked songs, playlists, search, and saved playback state.
- Progressive web app shell with install prompts and offline-aware client behavior.
- CSV metadata imports for exported playlists, including queued matching/import status.
- Optional YouTube discovery/import pipeline for self-hosters who enable it.
- Local filesystem audio storage by default, with Cloudflare R2 support for object storage.
- FFmpeg loudness normalization for imported audio.
- Docker and Fly.io deployment support.

Only import or download media you have the rights to store and stream. If you do not need external imports, disable them with the import-related environment variables listed below.

## Architecture

OnVibe is a TypeScript npm workspace:

- `apps/client` is the Next.js web/PWA client.
- `apps/api` is the Fastify API.
- `packages/shared` contains shared constants, types, and validation helpers.

The API stores application data in SQLite. Imported audio is stored separately, either on local disk or in Cloudflare R2. In the default Docker deployment, the Next.js app and API run in one container, and the web app proxies `/api/*` to the internal API process.

## Requirements

- Node.js 22 and npm for local development.
- FFmpeg for audio normalization when running outside Docker. For local development without FFmpeg, set `BROADSIDE_AUDIO_NORMALIZATION_ENABLED=false`.
- Docker for the easiest production/self-hosted deployment.
- A Google OAuth 2.0 Web client for sign-in.
- Cloudflare R2 credentials only if you want object storage for audio.

## Local Development

Install dependencies:

```sh
npm install
```

Create the API environment file:

```sh
cp apps/api/.env.example apps/api/.env
```

Edit the copied file. For a normal local Next.js dev server, these values should look like this:

```env
PORT=3101
HOST=0.0.0.0
APP_WEB_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3101/api/auth/google/callback
ADMIN=you@example.com
BROADSIDE_ADMIN_USER_EMAILS=you@example.com
BROADSIDE_DATABASE_PATH=../../data/broadside.sqlite
BROADSIDE_AUDIO_STORAGE_DRIVER=local
BROADSIDE_AUDIO_STORAGE_PATH=../../data/audio
```

In Google Cloud Console, create an OAuth 2.0 Web client and add:

- Authorized JavaScript origin: `http://localhost:3000`
- Authorized redirect URI: `http://localhost:3101/api/auth/google/callback`

Run the API and web app together:

```sh
npm run dev
```

Open `http://localhost:3000`.

Useful development commands:

```sh
npm run typecheck
npm run test
npm run lint
npm run build
```

## Self-Hosting With Docker

Docker is the recommended self-hosting path. The image includes Node.js, FFmpeg, Python, the API, and the production Next.js server.

Create a production env file on the host:

```env
APP_WEB_ORIGIN=https://music.example.com
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://music.example.com/api/auth/google/callback
ADMIN=you@example.com
BROADSIDE_ADMIN_USER_EMAILS=you@example.com
BROADSIDE_DATABASE_PATH=/app/data/broadside.sqlite
BROADSIDE_AUDIO_STORAGE_DRIVER=local
BROADSIDE_AUDIO_STORAGE_PATH=/app/data/audio
BROADSIDE_AUDIO_NORMALIZATION_MODE=single-pass
```

In Google Cloud Console, add:

- Authorized JavaScript origin: `https://music.example.com`
- Authorized redirect URI: `https://music.example.com/api/auth/google/callback`

Build and run:

```sh
docker build -t onvibe .
docker run -d \
  --name onvibe \
  --restart unless-stopped \
  --env-file onvibe.env \
  -p 3000:3000 \
  -v onvibe-data:/app/data \
  onvibe
```

Put a reverse proxy in front of port `3000` and serve it over HTTPS. Production cookies are marked `Secure`, so real deployments should use HTTPS.

Check the app:

```sh
curl https://music.example.com/api/health
```

## Docker Compose

If you prefer Compose, this is enough for a single-node install:

```yaml
services:
  onvibe:
    build: .
    restart: unless-stopped
    env_file:
      - onvibe.env
    ports:
      - "3000:3000"
    volumes:
      - onvibe-data:/app/data

volumes:
  onvibe-data:
```

Run it with:

```sh
docker compose up -d --build
```

## Cloudflare R2 Audio Storage

SQLite still needs a persistent local volume, but audio can live in R2 instead of the container volume.

Set these in production:

```env
BROADSIDE_AUDIO_STORAGE_DRIVER=r2
R2_ACCOUNT_ID=your-cloudflare-account-id
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET=your-bucket
R2_REGION=auto
R2_KEY_PREFIX=onvibe/audio
```

You can also set `R2_ENDPOINT` instead of `R2_ACCOUNT_ID` if you need a custom S3-compatible endpoint.

## Fly.io Deployment

The repository includes a Fly.io configuration, but it contains project-specific defaults. Before deploying your own instance, change the app name, domain, volume name, region, bucket name, and OAuth URLs.

After updating the Fly configuration so the app name, environment, and mount source match your instance, a typical first deployment looks like:

```sh
fly apps create your-onvibe-app
fly volumes create onvibe_data --region ord --size 10
fly secrets set \
  GOOGLE_CLIENT_ID=your-google-client-id \
  GOOGLE_CLIENT_SECRET=your-google-client-secret \
  BROADSIDE_ADMIN_USER_EMAILS=you@example.com \
  R2_ACCOUNT_ID=your-cloudflare-account-id \
  R2_ACCESS_KEY_ID=your-r2-access-key \
  R2_SECRET_ACCESS_KEY=your-r2-secret-key
fly deploy
```

Use a Fly volume for the SQLite database. Use R2 for audio if you expect the library to grow beyond what you want to keep on the app machine.

## Manual Production Deployment

If you do not want Docker, run the API and client as two long-lived processes behind your own process manager:

```sh
npm ci
BROADSIDE_API_BASE_URL=http://127.0.0.1:3101 npm run build
PORT=3101 HOST=127.0.0.1 npm run start -w @broadside/api
PORT=3000 npm run start -w @broadside/client -- -H 0.0.0.0 -p 3000
```

Keep the API private to the machine when serving the web app and API through the same public origin. Point your reverse proxy at the client process and let the Next.js rewrites handle `/api/*`.

## First Login And Users

1. Set `ADMIN` or `BROADSIDE_ADMIN_USER_EMAILS` to your Google account email.
2. Sign in with Google.
3. Admin accounts get access immediately.
4. Create entry keys in the admin view for non-admin users.
5. Non-admin users can sign in, redeem an entry key, and then use the library.

If nobody can reach the admin view, confirm that the email returned by Google exactly matches one of the configured admin emails.

## Configuration Reference

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_WEB_ORIGIN` | Production | Public web origin used for CORS and safe OAuth returns, for example `https://music.example.com`. |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth Web client ID. |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth Web client secret. |
| `GOOGLE_REDIRECT_URI` | Yes | Exact callback URL registered with Google. |
| `ADMIN` | Recommended | Comma-separated admin emails. Kept for compatibility. |
| `BROADSIDE_ADMIN_USER_EMAILS` | Recommended | Comma-separated admin emails. |
| `BROADSIDE_ADMIN_USER_IDS` | Optional | Comma-separated admin user IDs. Useful after users exist. |
| `BROADSIDE_DATABASE_PATH` | Production | SQLite database location. Use a persistent volume. |
| `BROADSIDE_AUDIO_STORAGE_DRIVER` | Optional | `local` or `r2`. Defaults to `r2` when `R2_BUCKET` is set, otherwise `local`. |
| `BROADSIDE_AUDIO_STORAGE_PATH` | Local storage | Directory for local audio files. Use a persistent volume. |
| `R2_ACCOUNT_ID` | R2 | Cloudflare account ID. Not needed if `R2_ENDPOINT` is set. |
| `R2_ENDPOINT` | R2 optional | Custom S3-compatible endpoint. |
| `R2_ACCESS_KEY_ID` | R2 | R2/S3 access key ID. |
| `R2_SECRET_ACCESS_KEY` | R2 | R2/S3 secret access key. |
| `R2_BUCKET` | R2 | Bucket name for audio objects. |
| `R2_REGION` | R2 optional | Defaults to `auto`. |
| `R2_KEY_PREFIX` | R2 optional | Prefix for stored audio objects. |
| `BROADSIDE_AUDIO_NORMALIZATION_ENABLED` | Optional | Enable FFmpeg loudness normalization. Defaults to enabled outside tests. |
| `BROADSIDE_AUDIO_NORMALIZATION_MODE` | Optional | `single-pass` or `two-pass`. Docker/Fly commonly use `single-pass` to reduce CPU. |
| `BROADSIDE_FFMPEG_THREADS` | Optional | FFmpeg thread count. |
| `FFMPEG_PATH` | Optional | Custom FFmpeg binary path. |
| `BROADSIDE_IMPORT_POLICY_MODE` | Optional | `licensed_only`, `review_required`, or `open_test`. Defaults to `licensed_only`. |
| `BROADSIDE_EXTERNAL_DISCOVERY_ENABLED` | Optional | Set to `false` to disable external search/discovery. |
| `BROADSIDE_EXTERNAL_IMPORT_ENABLED` | Optional | Set to `false` to disable external imports. |
| `BROADSIDE_YOUTUBE_ADAPTER_ENABLED` | Optional | Set to `false` to disable the YouTube import adapter. |
| `BROADSIDE_CSV_IMPORT_CONCURRENCY` | Optional | Number of CSV import items processed concurrently. |
| `BROADSIDE_CSV_IMPORT_LOAD_BACKOFF_DELAY_MS` | Optional | Delay used when CSV imports encounter load/backoff conditions. |
| `BROADSIDE_CSV_IMPORT_LOAD_BACKOFF_THRESHOLD` | Optional | Threshold for applying CSV import backoff. |
| `BROADSIDE_API_BASE_URL` | Build/deploy | API URL used by the Next.js server rewrite. In the default container it is `http://127.0.0.1:3101`. |
| `NEXT_PUBLIC_API_BASE_URL` | Split-origin clients | Browser-visible API base URL when you are not serving API and client from the same origin. |

## Data, Backups, And Upgrades

Back up both the SQLite database and the audio storage.

For local audio storage, back up the whole persistent data volume. For R2, back up the SQLite database and rely on your bucket lifecycle/backup policy for audio objects.

SQLite migrations run automatically when the API starts. Before upgrading, stop the app and take a database backup. If you use local disk audio, back up the audio directory at the same time so database rows and stored objects stay in sync.

## Security Notes

- Serve production over HTTPS.
- Keep OAuth and R2 secrets out of git.
- Restrict admin emails carefully; admins can create entry keys and run admin storage/account operations.
- Disable external discovery/imports if your instance should only accept direct audio uploads.
- Keep Docker images, Node.js, FFmpeg, and reverse proxy packages patched.

## Contributing

Issues and pull requests are welcome once the project is published with an open-source license.

Before opening a PR, run:

```sh
npm run typecheck
npm run test
npm run lint
```

For larger changes, include a short note about the user-facing behavior, any new environment variables, and the self-hosting impact.

## License

No open-source license has been committed yet. Until a license is added, the code is source-available but not licensed for reuse. Choose and commit a `LICENSE` file before accepting outside contributions.

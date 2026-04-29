import type { SqliteDatabase } from "./connection.js";

interface Migration {
  version: number;
  name: string;
  up: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_library_schema",
    up: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        avatar_url TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE oauth_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE (provider, provider_subject)
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        access_token_hash TEXT NOT NULL UNIQUE,
        refresh_token_hash TEXT NOT NULL UNIQUE,
        user_agent TEXT,
        ip_address TEXT,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        rotated_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE pending_session_exchanges (
        code_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_agent TEXT,
        ip_address TEXT,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE songs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        duration_ms INTEGER,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        checksum TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        import_status TEXT NOT NULL CHECK (import_status IN ('pending', 'ready', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE playlists (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE playlist_songs (
        playlist_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        added_at TEXT NOT NULL,
        PRIMARY KEY (playlist_id, song_id),
        UNIQUE (playlist_id, position),
        FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
      );

      CREATE TABLE likes (
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, song_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
      );

      CREATE TABLE playback_state (
        user_id TEXT PRIMARY KEY,
        song_id TEXT,
        position_ms INTEGER NOT NULL DEFAULT 0 CHECK (position_ms >= 0),
        shuffle_enabled INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_enabled IN (0, 1)),
        repeat_mode TEXT NOT NULL DEFAULT 'off' CHECK (repeat_mode IN ('off', 'one', 'all')),
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE SET NULL
      );

      CREATE TABLE import_jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_users_email ON users(email);
      CREATE INDEX idx_oauth_accounts_user_id ON oauth_accounts(user_id);
      CREATE INDEX idx_sessions_user_expires ON sessions(user_id, expires_at);
      CREATE INDEX idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
      CREATE INDEX idx_sessions_access_token_hash ON sessions(access_token_hash);
      CREATE INDEX idx_pending_session_exchanges_user_id ON pending_session_exchanges(user_id);
      CREATE INDEX idx_songs_user_library ON songs(user_id, import_status, created_at DESC);
      CREATE INDEX idx_songs_user_search ON songs(user_id, title, artist, album);
      CREATE INDEX idx_playlists_user_updated ON playlists(user_id, updated_at DESC);
      CREATE INDEX idx_playlist_songs_playlist_position ON playlist_songs(playlist_id, position);
      CREATE INDEX idx_playlist_songs_song_id ON playlist_songs(song_id);
      CREATE INDEX idx_likes_user_created ON likes(user_id, created_at DESC);
      CREATE INDEX idx_import_jobs_user_status ON import_jobs(user_id, status, created_at DESC);
    `
  },
  {
    version: 2,
    name: "external_import_sources",
    up: `
      CREATE TABLE external_sources (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        song_id TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL CHECK (provider IN ('youtube')),
        source_id TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        original_title TEXT NOT NULL,
        original_uploader TEXT,
        thumbnail_url TEXT,
        import_policy_mode TEXT NOT NULL CHECK (import_policy_mode IN ('open_test', 'review_required', 'licensed_only')),
        provenance_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE
      );

      ALTER TABLE import_jobs
        ADD COLUMN source_id TEXT REFERENCES external_sources(id) ON DELETE SET NULL;
      ALTER TABLE import_jobs
        ADD COLUMN import_policy_mode TEXT NOT NULL DEFAULT 'licensed_only'
          CHECK (import_policy_mode IN ('open_test', 'review_required', 'licensed_only'));
      ALTER TABLE import_jobs
        ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0);
      ALTER TABLE import_jobs
        ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';

      CREATE INDEX idx_external_sources_user_source ON external_sources(user_id, provider, source_id);
      CREATE INDEX idx_external_sources_song_id ON external_sources(song_id);
      CREATE INDEX idx_import_jobs_source_id ON import_jobs(source_id);
    `
  },
  {
    version: 3,
    name: "external_source_policies",
    up: `
      CREATE TABLE source_policies (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('youtube')),
        scope_type TEXT NOT NULL CHECK (scope_type IN ('provider', 'domain', 'channel', 'source')),
        scope_value TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('allow', 'block', 'review')),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        reason TEXT,
        license_type TEXT,
        license_url TEXT,
        attribution_text TEXT,
        created_by_user_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE TABLE source_policy_audit_entries (
        id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (policy_id) REFERENCES source_policies(id) ON DELETE CASCADE,
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_source_policies_lookup ON source_policies(provider, scope_type, scope_value, enabled);
      CREATE INDEX idx_source_policy_audit_policy ON source_policy_audit_entries(policy_id, created_at DESC);
      CREATE INDEX idx_import_jobs_failed ON import_jobs(status, updated_at DESC);
    `
  },
  {
    version: 4,
    name: "soft_deleted_song_library_entries",
    up: `
      ALTER TABLE songs
        ADD COLUMN deleted_at TEXT;

      CREATE INDEX idx_songs_user_deleted_library
        ON songs(user_id, deleted_at, import_status, created_at DESC);
    `
  },
  {
    version: 5,
    name: "entry_keys",
    up: `
      ALTER TABLE users
        ADD COLUMN entry_key_redeemed_at TEXT;

      CREATE TABLE entry_keys (
        id TEXT PRIMARY KEY,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        label TEXT,
        created_by_user_id TEXT,
        created_at TEXT NOT NULL,
        consumed_by_user_id TEXT,
        consumed_at TEXT,
        FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (consumed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      );

      CREATE INDEX idx_entry_keys_created_at
        ON entry_keys(created_at DESC);
      CREATE INDEX idx_entry_keys_consumed_by_user_id
        ON entry_keys(consumed_by_user_id);
    `
  },
  {
    version: 6,
    name: "reserved_removed_metadata_import_queue",
    up: `
      SELECT 1;
    `
  },
  {
    version: 7,
    name: "csv_metadata_import_queue",
    up: `
      DROP TABLE IF EXISTS spotify_import_items;
      DROP TABLE IF EXISTS spotify_import_batches;
      DROP TABLE IF EXISTS spotify_playlist_tracks;
      DROP TABLE IF EXISTS spotify_playlists;
      DROP TABLE IF EXISTS spotify_tracks;
      DROP TABLE IF EXISTS spotify_connections;
      DROP TABLE IF EXISTS spotify_oauth_states;

      CREATE TABLE csv_import_batches (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        import_policy_mode TEXT NOT NULL CHECK (import_policy_mode IN ('open_test', 'review_required', 'licensed_only')),
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
        completed_items INTEGER NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
        failed_items INTEGER NOT NULL DEFAULT 0 CHECK (failed_items >= 0),
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE csv_import_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        playlist_name TEXT NOT NULL,
        source_key TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        duration_ms INTEGER,
        artwork_url TEXT,
        source_url TEXT,
        isrc TEXT,
        search_query TEXT NOT NULL,
        like_after_import INTEGER NOT NULL DEFAULT 0 CHECK (like_after_import IN (0, 1)),
        playlist_targets_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
        song_id TEXT,
        youtube_source_id TEXT,
        error_code TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES csv_import_batches(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE SET NULL,
        UNIQUE (batch_id, source_key)
      );

      CREATE INDEX idx_csv_import_batches_user_status
        ON csv_import_batches(user_id, status, created_at DESC);
      CREATE INDEX idx_csv_import_items_batch_status
        ON csv_import_items(batch_id, status, created_at ASC);
      CREATE INDEX idx_csv_import_items_user_source
        ON csv_import_items(user_id, source_key);
    `
  }
];

export function runMigrations(db: SqliteDatabase) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const appliedVersions = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((row) => Number(row.version))
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    db.exec("BEGIN;");

    try {
      db.exec(migration.up);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        migration.version,
        migration.name
      );
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
}

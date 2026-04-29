import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqliteDatabase = DatabaseSync;

export function openBroadsideDatabase(path = process.env.BROADSIDE_DATABASE_PATH ?? ":memory:") {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);
  configureBroadsideDatabase(db, path);

  return db;
}

export function configureBroadsideDatabase(db: SqliteDatabase, path = ":memory:") {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA temp_store = MEMORY;
  `);

  if (path !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
  }
}

export function closeBroadsideDatabase(db: SqliteDatabase) {
  if (db.isOpen) {
    db.close();
  }
}

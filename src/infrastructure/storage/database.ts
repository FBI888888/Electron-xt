import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA_VERSION = 1;

export type AppDatabase = Database.Database;

export const openDatabase = (filePath: string): AppDatabase => {
  mkdirSync(dirname(filePath), { recursive: true });
  const database = new Database(filePath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');

  database.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      remark TEXT NOT NULL,
      nickname TEXT NOT NULL DEFAULT '',
      grade INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unchecked',
      cookie_cipher BLOB NOT NULL,
      collected_count INTEGER NOT NULL DEFAULT 0,
      quota_date TEXT NOT NULL,
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      total INTEGER NOT NULL DEFAULT 0,
      processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0,
      partial INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES collection_jobs(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      source_type TEXT NOT NULL,
      author_id TEXT,
      nickname TEXT NOT NULL DEFAULT '',
      fans TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      account_remark TEXT NOT NULL DEFAULT '',
      collected_at TEXT,
      errors_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_job_source
      ON collection_items(job_id, source_url);
    CREATE INDEX IF NOT EXISTS idx_collection_items_job_status
      ON collection_items(job_id, status);

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES collection_items(id) ON DELETE CASCADE,
      author_id TEXT NOT NULL,
      data_json TEXT NOT NULL,
      errors_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_author_created
      ON snapshots(author_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS blogger_rows (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS link_items (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  database
    .prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)')
    .run('schema_version', String(SCHEMA_VERSION));

  return database;
};
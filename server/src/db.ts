import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, settingDefaults } from './config.ts';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'bellhop.db'));
// The busy timeout goes first: switching a new database to WAL needs a lock, and another process
// opening it at the same moment (the test files run in parallel) would otherwise fail straight away.
db.exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

// schema.sql can't add columns to a table an older version already created.
const hasColumn = (table: string, column: string) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c: any) => c.name === column);

if (!hasColumn('users', 'last_seen_at')) db.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT');
if (!hasColumn('wiki_pages', 'category')) db.exec("ALTER TABLE wiki_pages ADD COLUMN category TEXT NOT NULL DEFAULT ''");
if (!hasColumn('wiki_pages', 'created_by')) {
  // Who created older pages was never kept; their last editor is the best guess.
  db.exec(`ALTER TABLE wiki_pages ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
           UPDATE wiki_pages SET created_by = updated_by;`);
}

type Row = Record<string, any>;

export const one = <T = Row>(sql: string, ...params: any[]) =>
  db.prepare(sql).get(...params) as T | undefined;

export const all = <T = Row>(sql: string, ...params: any[]) =>
  db.prepare(sql).all(...params) as T[];

export const run = (sql: string, ...params: any[]) => db.prepare(sql).run(...params);

export function getSetting(key: string): string {
  const row = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? settingDefaults[key] ?? '';
}

export function setSetting(key: string, value: string) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value,
  );
}

export const now = () => new Date().toISOString();

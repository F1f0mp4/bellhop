import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, settingDefaults } from './config.ts';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, 'bellhop.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

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

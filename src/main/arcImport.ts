// Copy Claude and Notion login cookies from Arc into Rail's panes.
//
// Arc is Chromium-based: cookies live in an SQLite DB per profile, with values
// encrypted (AES-128-CBC) under a key derived from the "Arc Safe Storage"
// Keychain password. Reading that password makes macOS ask the user to allow it.
// Only cookies for the hosts asked for are read; nothing else leaves Arc's DB.

import { app, Session } from 'electron';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ARC_DATA = path.join(os.homedir(), 'Library/Application Support/Arc/User Data');

export interface ImportTarget {
  session: Session;
  hosts: string[]; // e.g. ['claude.ai'] matches claude.ai and *.claude.ai
}

interface Row {
  host_key: string;
  name: string;
  enc: string; // hex of encrypted_value
  value: string;
  path: string;
  expires_utc: number;
  is_secure: number;
  is_httponly: number;
  samesite: number;
  last_access_utc: number;
}

export function arcInstalled() {
  return fs.existsSync(ARC_DATA);
}

function cookieDbs(): string[] {
  const out: string[] = [];
  for (const dir of fs.readdirSync(ARC_DATA)) {
    if (dir !== 'Default' && !/^Profile \d+$/.test(dir)) continue;
    for (const rel of ['Network/Cookies', 'Cookies']) {
      const f = path.join(ARC_DATA, dir, rel);
      if (fs.existsSync(f)) { out.push(f); break; }
    }
  }
  return out;
}

async function keychainKey(): Promise<Buffer> {
  const { stdout } = await run('/usr/bin/security', [
    'find-generic-password', '-w', '-s', 'Arc Safe Storage', '-a', 'Arc',
  ]);
  const password = stdout.trim();
  if (!password) throw new Error('Arc Safe Storage password was empty');
  return crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
}

function decrypt(hex: string, key: Buffer, dbVersion: number): string | null {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length === 0) return null;
  const prefix = buf.subarray(0, 3).toString();
  if (prefix !== 'v10' && prefix !== 'v11') return null;
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '));
  let plain = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
  // DB version 24+ prefixes the plaintext with SHA-256(host_key).
  if (dbVersion >= 24) plain = plain.subarray(32);
  return plain.toString('utf8');
}

async function query(dbFile: string, hosts: string[]): Promise<{ version: number; rows: Row[] }> {
  // Work on a copy so Arc's open database is never touched or locked.
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'rail-arc-'));
  try {
    for (const suffix of ['', '-wal']) {
      if (fs.existsSync(dbFile + suffix)) fs.copyFileSync(dbFile + suffix, path.join(tmp, 'Cookies' + suffix));
    }
    const db = path.join(tmp, 'Cookies');
    const where = hosts
      .map((h) => `host_key = '${h}' OR host_key LIKE '%.${h}'`)
      .join(' OR ');
    const sql =
      `SELECT host_key, name, hex(encrypted_value) AS enc, value, path, expires_utc, ` +
      `is_secure, is_httponly, samesite, last_access_utc FROM cookies WHERE ${where};`;
    const [{ stdout: v }, { stdout: rows }] = await Promise.all([
      run('/usr/bin/sqlite3', [db, "SELECT value FROM meta WHERE key='version';"]),
      run('/usr/bin/sqlite3', ['-json', db, sql], { maxBuffer: 16 * 1024 * 1024 }),
    ]);
    return { version: Number(v.trim()) || 0, rows: rows.trim() ? JSON.parse(rows) : [] };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const SAMESITE = ['no_restriction', 'lax', 'strict'] as const;

/** Returns how many cookies were imported per target, in order. */
export async function importFromArc(targets: ImportTarget[]): Promise<number[]> {
  const dbs = cookieDbs();
  if (dbs.length === 0) throw new Error('No Arc cookie database found.');
  const allHosts = targets.flatMap((t) => t.hosts);

  // Read every profile; keep the most recently used copy of each cookie.
  const best = new Map<string, { row: Row; version: number }>();
  for (const db of dbs) {
    const { version, rows } = await query(db, allHosts);
    for (const row of rows) {
      const id = `${row.host_key}\t${row.name}\t${row.path}`;
      const prev = best.get(id);
      if (!prev || row.last_access_utc > prev.row.last_access_utc) best.set(id, { row, version });
    }
  }
  if (best.size === 0) return targets.map(() => 0);

  const key = await keychainKey();
  const counts = targets.map(() => 0);
  const nowSec = Date.now() / 1000;

  for (const { row, version } of best.values()) {
    const ti = targets.findIndex((t) =>
      t.hosts.some((h) => {
        const host = row.host_key.replace(/^\./, '');
        return host === h || host.endsWith('.' + h);
      }),
    );
    if (ti < 0) continue;

    const value = row.value || decrypt(row.enc, key, version);
    if (value == null) continue;

    const expirationDate = row.expires_utc ? row.expires_utc / 1e6 - 11644473600 : undefined;
    if (expirationDate !== undefined && expirationDate < nowSec) continue;

    const host = row.host_key.replace(/^\./, '');
    const secure = !!row.is_secure;
    const sameSite = row.samesite >= 0 ? SAMESITE[row.samesite] : 'unspecified';
    try {
      await targets[ti].session.cookies.set({
        url: `${secure ? 'https' : 'http'}://${host}${row.path || '/'}`,
        name: row.name,
        value,
        // Host-only cookies (no leading dot) and __Host- cookies take no domain.
        domain: row.host_key.startsWith('.') && !row.name.startsWith('__Host-') ? row.host_key : undefined,
        path: row.path || '/',
        secure,
        httpOnly: !!row.is_httponly,
        expirationDate,
        sameSite: sameSite === 'no_restriction' && !secure ? 'unspecified' : sameSite,
      });
      counts[ti]++;
    } catch (err) {
      console.warn('[rail] skipped cookie', row.host_key, row.name, (err as Error).message);
    }
  }
  await Promise.all(targets.map((t) => t.session.cookies.flushStore()));
  return counts;
}

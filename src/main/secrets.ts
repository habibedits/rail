import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// API keys, encrypted with Electron safeStorage (backed by the macOS Keychain).
// The file on disk only ever holds ciphertext.

type Name = 'fireflies' | 'notion-calendar';
const file = () => path.join(app.getPath('userData'), 'secrets.json');

function readAll(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {
    return {};
  }
}

export function getSecret(name: Name): string | null {
  const enc = readAll()[name];
  if (!enc || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch {
    return null;
  }
}

export function setSecret(name: Name, value: string | null) {
  const all = readAll();
  if (value) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Keychain encryption is not available');
    all[name] = safeStorage.encryptString(value).toString('base64');
  } else {
    delete all[name];
  }
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(all), { mode: 0o600 });
}

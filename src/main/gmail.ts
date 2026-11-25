// Mail space: every Gmail account in one feed, through the Gmail API.
//
// Sign-in is Google's installed-app OAuth flow: the consent page opens in the
// user's normal browser (Google blocks its sign-in inside embedded views),
// and Google redirects back to a one-shot server on 127.0.0.1 (PKCE). Google
// needs an OAuth client for that, which the user creates once in their own
// Google Cloud project and pastes into the Mail space (see README). The
// client and each account's refresh token are stored with safeStorage
// (Keychain). Mail itself never leaves this Mac except to Google.
//
// The feed is the newest inbox conversations of every account, merged and
// sorted by date. Rail checks every minute and keeps a per-conversation cache
// keyed by Gmail's historyId, so only changed conversations are fetched again.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { shell } from 'electron';
import { getSecret, setSecret } from './secrets';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
// modify: read, label, archive, trash and send (no permanent delete).
// settings.basic: create and remove the filters that block senders.
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.settings.basic'];
const PER_ACCOUNT = 30; // conversations per account in the feed
const POLL_MS = 60 * 1000;

export class MailError extends Error {
  constructor(message: string, readonly needsSignIn = false) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Types shared with the renderer (mirrored in src/renderer/rail.ts)
// ---------------------------------------------------------------------------

export interface MailThread {
  key: string; // `${account} ${id}`
  account: string;
  id: string;
  from: string; // display name
  fromEmail: string;
  subject: string;
  snippet: string;
  date: number; // epoch ms of the newest message
  unread: boolean;
  count: number; // messages in the conversation
  list: boolean; // has a List-Unsubscribe header (newsletters, marketing)
}

export interface MailAccount { email: string; on: boolean; unread: number; error: string | null; needsSignIn: boolean }

export interface MailSnapshot {
  hasClient: boolean;
  builtIn: boolean; // the Google client is built into this copy of Rail
  accounts: MailAccount[];
  threads: MailThread[];
  loading: boolean;
  updatedAt: number;
  error: string | null;
}

export interface MailMessage {
  id: string;
  from: string;
  fromEmail: string;
  to: string;
  cc: string;
  date: number;
  html: string | null;
  text: string | null;
  attachments: { name: string; size: number }[];
  mine: boolean;
}

export interface MailDetail {
  account: string;
  id: string;
  subject: string;
  messages: MailMessage[];
  unsubscribe: boolean;
  webUrl: string;
}

export type Undo =
  | { kind: 'archive' | 'trash'; account: string; ids: string[] }
  | { kind: 'block'; account: string; ids: string[]; filterId: string | null };

// ---------------------------------------------------------------------------
// Stored client and accounts
// ---------------------------------------------------------------------------

interface Client { id: string; secret: string }
interface Account { email: string; refresh: string; access?: string; exp?: number }

// The client built into this copy of Rail (scripts/build-main.mjs), else one pasted in the Mail space.
let bundled: Client | null | undefined;
function builtInClient(): Client | null {
  if (bundled === undefined) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(__dirname, 'google-client.json'), 'utf8'));
      bundled = j.id && j.secret ? { id: String(j.id), secret: String(j.secret) } : null;
    } catch {
      bundled = null;
    }
  }
  return bundled;
}
const loadClient = (): Client | null => {
  const built = builtInClient();
  if (built) return built;
  const raw = getSecret('gmail-client');
  return raw ? (JSON.parse(raw) as Client) : null;
};
export const hasBuiltInClient = () => !!builtInClient();
const loadAccounts = (): Account[] => {
  const raw = getSecret('gmail-accounts');
  return raw ? (JSON.parse(raw) as Account[]) : [];
};
const storeAccounts = (list: Account[]) => setSecret('gmail-accounts', list.length ? JSON.stringify(list) : null);

function updateAccount(email: string, patch: Partial<Account>) {
  const list = loadAccounts();
  const i = list.findIndex((a) => a.email === email);
  if (i < 0) return;
  list[i] = { ...list[i], ...patch };
  storeAccounts(list);
}

/** Accepts the client JSON file Google offers to download, or the ID and secret on their own. */
export function setClient(idOrJson: string, secret: string) {
  let id = idOrJson.trim();
  let sec = secret.trim();
  if (id.startsWith('{')) {
    try {
      const j = JSON.parse(id);
      const c = j.installed ?? j.web ?? j;
      id = String(c.client_id ?? '');
      sec = String(c.client_secret ?? sec);
    } catch {
      throw new MailError('That isn’t the client file from Google. Paste the Client ID instead.');
    }
  }
  if (!/\.apps\.googleusercontent\.com$/.test(id)) throw new MailError('The Client ID ends in .apps.googleusercontent.com. Copy it from Google Cloud → Credentials.');
  if (!sec) throw new MailError('Paste the Client secret too.');
  setSecret('gmail-client', JSON.stringify({ id, secret: sec }));
}

export function clearClient() {
  setSecret('gmail-client', null);
  storeAccounts([]);
  cache.clear();
  errors.clear();
  emit();
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

async function postForm(body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  } catch {
    throw new MailError('Can’t reach Google. Check your connection.');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (j.error === 'invalid_grant') throw new MailError('Google signed Rail out of this account. Sign in again.', true);
    if (j.error === 'invalid_client') throw new MailError('Google doesn’t recognize the OAuth client. Check the Client ID and secret.');
    throw new MailError(j.error_description || j.error || `Google sign-in error (${res.status}).`);
  }
  return j as { access_token: string; refresh_token?: string; expires_in?: number };
}

let pending: Promise<string> | null = null;
/** Opens Google's sign-in in the browser and adds (or refreshes) that account. Resolves to its address. */
export function connect(): Promise<string> {
  pending ??= doConnect().finally(() => { pending = null; });
  return pending;
}

async function doConnect(): Promise<string> {
  const client = loadClient();
  if (!client) throw new MailError('Add your Google OAuth client first.');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  let redirect = '';

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Rail</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;color:#333">
        <p>${ok ? 'Rail can read this Gmail account now. You can close this tab.' : 'Signing in didn’t finish. Go back to Rail and try again.'}</p>`);
      clearTimeout(timer);
      server.close();
      if (ok) resolve(u.searchParams.get('code')!);
      else reject(new MailError(u.searchParams.get('error') === 'access_denied' ? 'Signing in was cancelled.' : 'Signing in to Google failed.'));
    });
    const timer = setTimeout(() => { server.close(); reject(new MailError('Signing in timed out.')); }, 5 * 60 * 1000);
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`;
      const auth = new URL(AUTH_URL);
      auth.search = new URLSearchParams({
        response_type: 'code',
        client_id: client.id,
        redirect_uri: redirect,
        scope: SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'select_account consent', // always ask which account, always return a refresh token
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();
      shell.openExternal(auth.toString()).catch(() => {
        clearTimeout(timer);
        server.close();
        reject(new MailError('Couldn’t open your browser.'));
      });
    });
  });

  const tok = await postForm({
    grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: client.id, client_secret: client.secret, code_verifier: verifier,
  });
  if (!tok.refresh_token) throw new MailError('Google didn’t return a refresh token. Try again.');
  const granted = String((tok as { scope?: string }).scope ?? SCOPES.join(' '));
  if (!SCOPES.every((s) => granted.includes(s))) throw new MailError('Rail needs both Gmail permissions. Sign in again and tick every box.');

  const res = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  const prof = await res.json().catch(() => ({}));
  if (!res.ok || !prof.emailAddress) throw new MailError(prof.error?.message || 'Couldn’t read the account’s address.');
  const email = String(prof.emailAddress).toLowerCase();

  const list = loadAccounts().filter((a) => a.email !== email);
  list.push({ email, refresh: tok.refresh_token, access: tok.access_token, exp: Date.now() + ((tok.expires_in ?? 3600) - 60) * 1000 });
  storeAccounts(list);
  errors.delete(email);
  void refresh();
  return email;
}

export function removeAccount(email: string) {
  storeAccounts(loadAccounts().filter((a) => a.email !== email));
  for (const k of [...cache.keys()]) if (k.startsWith(email + ' ')) cache.delete(k);
  errors.delete(email);
  emit();
}

async function accessToken(email: string): Promise<string> {
  const a = loadAccounts().find((x) => x.email === email);
  if (!a) throw new MailError(`${email} isn’t signed in.`, true);
  if (a.access && a.exp && a.exp > Date.now()) return a.access;
  const client = loadClient();
  if (!client) throw new MailError('Add your Google OAuth client first.');
  const tok = await postForm({ grant_type: 'refresh_token', refresh_token: a.refresh, client_id: client.id, client_secret: client.secret });
  updateAccount(email, { access: tok.access_token, exp: Date.now() + ((tok.expires_in ?? 3600) - 60) * 1000, ...(tok.refresh_token ? { refresh: tok.refresh_token } : {}) });
  return tok.access_token;
}

// ---------------------------------------------------------------------------
// Gmail REST
// ---------------------------------------------------------------------------

async function api<T = any>(email: string, path: string, init?: { method?: string; body?: unknown }, retried = false): Promise<T> {
  const token = await accessToken(email);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: init?.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new MailError('Can’t reach Gmail. Check your connection.');
  }
  if (res.status === 401 && !retried) {
    updateAccount(email, { access: undefined, exp: 0 });
    return api(email, path, init, true);
  }
  if (res.status === 204) return undefined as T;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new MailError('Google signed Rail out of this account. Sign in again.', true);
    const msg = j.error?.message as string | undefined;
    if (res.status === 403 && /has not been used|is disabled/i.test(msg ?? '')) throw new MailError('Turn on the Gmail API in your Google Cloud project, then try again.');
    throw new MailError(msg || `Gmail error (${res.status}).`);
  }
  return j as T;
}

/** Runs fn over items, a few at a time. */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

interface GHeader { name: string; value: string }
interface GPart { mimeType?: string; filename?: string; headers?: GHeader[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GPart[] }
interface GMessage { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: GPart }
interface GThread { id: string; historyId?: string; messages?: GMessage[] }

const header = (m: GMessage | GPart | undefined, name: string) => {
  const hs = (m && 'payload' in m ? m.payload?.headers : (m as GPart | undefined)?.headers) ?? [];
  return hs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
};

export function parseAddress(v: string): { name: string; email: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>/.exec(v);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  const e = v.trim().toLowerCase();
  return { name: e, email: e };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unescapeHtml(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

const cache = new Map<string, { historyId: string; thread: MailThread }>();
const errors = new Map<string, { message: string; needsSignIn: boolean }>();
const unreadCounts = new Map<string, number>();
let feed: string[] = []; // keys in the inbox right now, per the last check
let loading = false;
let lastError: string | null = null;
let updatedAt = 0;
let listener: ((s: MailSnapshot) => void) | null = null;
let isHidden: (email: string) => boolean = () => false;
let timer: NodeJS.Timeout | undefined;

function summarize(account: string, t: GThread): MailThread {
  const msgs = t.messages ?? [];
  const last = msgs[msgs.length - 1];
  // Show who wrote to you: the newest message that isn't your own.
  const theirs = [...msgs].reverse().find((m) => parseAddress(header(m, 'From')).email !== account);
  const who = theirs ? parseAddress(header(theirs, 'From')) : { name: 'Me', email: account };
  return {
    key: `${account} ${t.id}`,
    account,
    id: t.id,
    from: who.name,
    fromEmail: who.email,
    subject: header(msgs[0], 'Subject') || '(no subject)',
    snippet: unescapeHtml(last?.snippet ?? ''),
    date: Number(last?.internalDate ?? 0),
    unread: msgs.some((m) => m.labelIds?.includes('UNREAD')),
    count: msgs.length,
    list: msgs.some((m) => !!header(m, 'List-Unsubscribe')),
  };
}

async function loadThreads(account: string, q: string | null): Promise<string[]> {
  const params = new URLSearchParams({ maxResults: String(PER_ACCOUNT) });
  if (q) params.set('q', q);
  else params.set('labelIds', 'INBOX');
  const list = await api<{ threads?: { id: string; historyId: string }[] }>(account, `/threads?${params}`);
  const items = list.threads ?? [];
  await pool(items, 6, async (it) => {
    const key = `${account} ${it.id}`;
    if (cache.get(key)?.historyId === it.historyId) return;
    const t = await api<GThread>(account, `/threads/${it.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`);
    cache.set(key, { historyId: it.historyId, thread: summarize(account, t) });
  });
  return items.map((it) => `${account} ${it.id}`);
}

export async function refresh() {
  const accounts = loadAccounts().map((a) => a.email);
  if (!loadClient() || !accounts.length) { emit(); return; }
  loading = true;
  emit();
  const keys: string[] = [];
  await Promise.all(accounts.map(async (email) => {
    try {
      const [k, label] = await Promise.all([
        loadThreads(email, null),
        api<{ threadsUnread?: number }>(email, '/labels/INBOX'),
      ]);
      keys.push(...k);
      unreadCounts.set(email, label.threadsUnread ?? 0);
      errors.delete(email);
    } catch (e) {
      const me = e instanceof MailError ? e : null;
      errors.set(email, { message: (e as Error).message, needsSignIn: me?.needsSignIn ?? false });
      keys.push(...feed.filter((k) => k.startsWith(email + ' '))); // keep what we had
    }
  }));
  feed = keys;
  // Forget conversations that left every inbox (keeps the cache small).
  const live = new Set(keys);
  for (const k of [...cache.keys()]) if (!live.has(k)) cache.delete(k);
  loading = false;
  lastError = null;
  updatedAt = Date.now();
  emit();
}

export async function search(q: string): Promise<MailThread[]> {
  const accounts = loadAccounts().map((a) => a.email).filter((e) => !isHidden(e));
  const out: MailThread[] = [];
  await Promise.all(accounts.map(async (email) => {
    const keys = await loadThreads(email, q).catch(() => [] as string[]);
    for (const k of keys) { const c = cache.get(k); if (c) out.push(c.thread); }
  }));
  return out.sort((a, b) => b.date - a.date);
}

export function snapshot(): MailSnapshot {
  const accounts = loadAccounts().map((a) => ({
    email: a.email,
    on: !isHidden(a.email),
    unread: unreadCounts.get(a.email) ?? 0,
    error: errors.get(a.email)?.message ?? null,
    needsSignIn: errors.get(a.email)?.needsSignIn ?? false,
  }));
  const on = new Set(accounts.filter((a) => a.on).map((a) => a.email));
  const threads = feed
    .map((k) => cache.get(k)?.thread)
    .filter((t): t is MailThread => !!t && on.has(t.account))
    .sort((a, b) => b.date - a.date);
  return { hasClient: !!loadClient(), builtIn: hasBuiltInClient(), accounts, threads, loading, updatedAt, error: lastError };
}

/** Unread inbox conversations across the accounts shown in the feed (the Mail tab's count). */
export function unreadTotal() {
  return loadAccounts().filter((a) => !isHidden(a.email)).reduce((n, a) => n + (unreadCounts.get(a.email) ?? 0), 0);
}

function emit() { listener?.(snapshot()); }

export function start(opts: { onChange: (s: MailSnapshot) => void; isHidden: (email: string) => boolean }) {
  listener = opts.onChange;
  isHidden = opts.isHidden;
  clearInterval(timer);
  timer = setInterval(() => { if (!loading) void refresh(); }, POLL_MS);
  void refresh();
}

export const changed = () => emit();

// Local edits, so the feed and counts change at once (the next check confirms).
function dropFromFeed(account: string, ids: string[]) {
  const gone = new Set(ids.map((id) => `${account} ${id}`));
  let unreadGone = 0;
  for (const k of gone) if (cache.get(k)?.thread.unread) unreadGone++;
  feed = feed.filter((k) => !gone.has(k));
  if (unreadGone) unreadCounts.set(account, Math.max(0, (unreadCounts.get(account) ?? 0) - unreadGone));
  emit();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function decodeBody(data: string, contentType: string) {
  const buf = Buffer.from(data, 'base64url');
  const charset = /charset="?([^";\s]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset || 'utf-8').decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

function walk(part: GPart | undefined, out: { html: string | null; text: string | null; attachments: { name: string; size: number }[] }) {
  if (!part) return;
  const type = (part.mimeType ?? '').toLowerCase();
  if (part.filename) {
    out.attachments.push({ name: part.filename, size: part.body?.size ?? 0 });
    return;
  }
  if (part.parts?.length) { for (const p of part.parts) walk(p, out); return; }
  const data = part.body?.data;
  if (!data) return;
  const ct = header(part, 'Content-Type') || type;
  if (type === 'text/html' && out.html === null) out.html = decodeBody(data, ct);
  else if (type === 'text/plain' && out.text === null) out.text = decodeBody(data, ct);
}

export async function open(account: string, id: string): Promise<MailDetail> {
  const t = await api<GThread>(account, `/threads/${id}?format=full`);
  const msgs = t.messages ?? [];
  const messages: MailMessage[] = msgs.map((m) => {
    const body = { html: null as string | null, text: null as string | null, attachments: [] as { name: string; size: number }[] };
    walk(m.payload, body);
    const from = parseAddress(header(m, 'From'));
    return {
      id: m.id,
      from: from.name,
      fromEmail: from.email,
      to: header(m, 'To'),
      cc: header(m, 'Cc'),
      date: Number(m.internalDate ?? 0),
      html: body.html,
      text: body.text,
      attachments: body.attachments,
      mine: from.email === account,
    };
  });
  // Opening a conversation reads it.
  if (msgs.some((m) => m.labelIds?.includes('UNREAD'))) {
    void api(account, `/threads/${id}/modify`, { method: 'POST', body: { removeLabelIds: ['UNREAD'] } })
      .then(() => {
        const c = cache.get(`${account} ${id}`);
        if (c?.thread.unread) {
          c.thread.unread = false;
          unreadCounts.set(account, Math.max(0, (unreadCounts.get(account) ?? 0) - 1));
          emit();
        }
      })
      .catch(() => {});
  }
  return {
    account,
    id,
    subject: header(msgs[0], 'Subject') || '(no subject)',
    messages,
    unsubscribe: msgs.some((m) => !!header(m, 'List-Unsubscribe')),
    webUrl: `https://mail.google.com/mail/u/${encodeURIComponent(account)}/#all/${id}`,
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const encodeWord = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

function mime(h: Record<string, string>, text: string) {
  const lines = Object.entries(h).filter(([, v]) => v).map(([k, v]) => `${k}: ${oneLine(v)}`);
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '');
  const body = Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return Buffer.from(lines.join('\r\n') + '\r\n' + body, 'utf8').toString('base64url');
}

export async function reply(account: string, id: string, text: string) {
  if (!text.trim()) throw new MailError('Write something first.');
  const t = await api<GThread>(account, `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`);
  const msgs = t.messages ?? [];
  if (!msgs.length) throw new MailError('That conversation is empty.');
  const target = [...msgs].reverse().find((m) => parseAddress(header(m, 'From')).email !== account) ?? msgs[msgs.length - 1];
  const fromMe = parseAddress(header(target, 'From')).email === account;
  const to = fromMe ? header(target, 'To') : header(target, 'Reply-To') || header(target, 'From');
  if (!to) throw new MailError('Couldn’t find who to reply to.');
  const subject = header(msgs[0], 'Subject');
  const msgId = header(target, 'Message-ID');
  await api(account, '/messages/send', {
    method: 'POST',
    body: {
      threadId: id,
      raw: mime({
        From: account,
        To: to,
        Subject: encodeWord(/^re:/i.test(subject) ? subject : `Re: ${subject}`),
        'In-Reply-To': msgId,
        References: [header(target, 'References'), msgId].filter(Boolean).join(' '),
      }, text),
    },
  });
  void refresh();
}

export async function compose(account: string, to: string, subject: string, text: string) {
  if (!loadAccounts().some((a) => a.email === account)) throw new MailError(`${account} isn’t signed in.`);
  if (!/@/.test(to)) throw new MailError('Add who it’s to.');
  await api(account, '/messages/send', { method: 'POST', body: { raw: mime({ From: account, To: to, Subject: encodeWord(subject) }, text) } });
}

// ---------------------------------------------------------------------------
// Archive, Trash, Block
// ---------------------------------------------------------------------------

export async function archive(account: string, id: string): Promise<Undo> {
  dropFromFeed(account, [id]);
  await api(account, `/threads/${id}/modify`, { method: 'POST', body: { removeLabelIds: ['INBOX'] } }).catch((e) => { void refresh(); throw e; });
  return { kind: 'archive', account, ids: [id] };
}

export async function trash(account: string, id: string): Promise<Undo> {
  dropFromFeed(account, [id]);
  await api(account, `/threads/${id}/trash`, { method: 'POST' }).catch((e) => { void refresh(); throw e; });
  return { kind: 'trash', account, ids: [id] };
}

/** Everything from this sender in the inbox (what "delete their earlier emails" covers). */
export async function fromSender(account: string, email: string): Promise<string[]> {
  const params = new URLSearchParams({ q: `from:${email} in:inbox`, maxResults: '100' });
  const r = await api<{ threads?: { id: string }[] }>(account, `/threads?${params}`);
  return (r.threads ?? []).map((t) => t.id);
}

export interface BlockResult { undo: Undo; unsubscribed: 'done' | 'browser' | 'none' }

export async function block(account: string, id: string, email: string, opts: { trashAll: boolean; unsubscribe: boolean }): Promise<BlockResult> {
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new MailError('That sender has no address to block.');
  let unsubscribed: BlockResult['unsubscribed'] = 'none';
  if (opts.unsubscribe) unsubscribed = await unsubscribe(account, id).catch(() => 'none' as const);

  // A Gmail filter does the blocking, so it holds on every device.
  let filterId: string | null = null;
  try {
    const f = await api<{ id: string }>(account, '/settings/filters', { method: 'POST', body: { criteria: { from: email }, action: { addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] } } });
    filterId = f.id;
  } catch (e) {
    if (!/exists/i.test((e as Error).message)) throw e; // already blocked: fine
  }

  const ids = opts.trashAll ? [...new Set([id, ...(await fromSender(account, email))])] : [];
  if (ids.length) {
    dropFromFeed(account, ids);
    await pool(ids, 5, (tid) => api(account, `/threads/${tid}/trash`, { method: 'POST' }));
  }
  return { undo: { kind: 'block', account, ids, filterId }, unsubscribed };
}

export async function undo(u: Undo) {
  if (u.kind === 'archive') await pool(u.ids, 5, (id) => api(u.account, `/threads/${id}/modify`, { method: 'POST', body: { addLabelIds: ['INBOX'] } }));
  else {
    if (u.kind === 'block' && u.filterId) await api(u.account, `/settings/filters/${u.filterId}`, { method: 'DELETE' });
    await pool(u.ids, 5, async (id) => {
      await api(u.account, `/threads/${id}/untrash`, { method: 'POST' });
      await api(u.account, `/threads/${id}/modify`, { method: 'POST', body: { addLabelIds: ['INBOX'] } });
    });
  }
  await refresh();
}

export interface Blocked { account: string; email: string; filterId: string }

/** The senders Rail (or you, in Gmail) set to go straight to Trash. */
export async function blocked(): Promise<Blocked[]> {
  const out: Blocked[] = [];
  await Promise.all(loadAccounts().map(async (a) => {
    const r = await api<{ filter?: { id: string; criteria?: { from?: string; query?: string }; action?: { addLabelIds?: string[] } }[] }>(a.email, '/settings/filters').catch(() => ({ filter: [] }));
    for (const f of r.filter ?? []) {
      const from = f.criteria?.from;
      if (from && !f.criteria?.query && f.action?.addLabelIds?.includes('TRASH')) out.push({ account: a.email, email: from, filterId: f.id });
    }
  }));
  return out.sort((x, y) => x.email.localeCompare(y.email));
}

export async function unblock(account: string, filterId: string) {
  await api(account, `/settings/filters/${filterId}`, { method: 'DELETE' });
}

// List-Unsubscribe (RFC 2369) and one-click unsubscribe (RFC 8058).
async function unsubscribe(account: string, id: string): Promise<BlockResult['unsubscribed']> {
  const r = await unsubscribeQuietly(account, id);
  if (r.status === 'link') { await shell.openExternal(r.url); return 'browser'; }
  return r.status;
}

// Unsubscribes where it can be done from here (one-click POST, or an email to
// the list's unsubscribe address). A sender that only offers a web page comes
// back as a link to open, so a bulk clean-up doesn't open dozens of tabs.
async function unsubscribeQuietly(account: string, id: string): Promise<{ status: 'done' | 'none' } | { status: 'link'; url: string }> {
  const t = await api<GThread>(account, `/threads/${id}?format=metadata&metadataHeaders=List-Unsubscribe&metadataHeaders=List-Unsubscribe-Post`);
  const m = [...(t.messages ?? [])].reverse().find((x) => header(x, 'List-Unsubscribe'));
  if (!m) return { status: 'none' };
  const links = [...header(m, 'List-Unsubscribe').matchAll(/<([^>]+)>/g)].map((x) => x[1].trim());
  const https = links.find((l) => /^https:\/\//i.test(l));
  const mailto = links.find((l) => /^mailto:/i.test(l));
  if (https && /One-Click/i.test(header(m, 'List-Unsubscribe-Post'))) {
    const r = await fetch(https, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }).catch(() => null);
    if (r?.ok) return { status: 'done' };
  }
  if (mailto) {
    const u = new URL(mailto);
    const to = decodeURIComponent(u.pathname);
    if (/@/.test(to)) {
      await compose(account, to, u.searchParams.get('subject') ?? 'unsubscribe', u.searchParams.get('body') ?? 'unsubscribe');
      return { status: 'done' };
    }
  }
  if (https) return { status: 'link', url: https };
  return { status: 'none' };
}

// ---------------------------------------------------------------------------
// Inbox clean-up: who fills the inbox, and clearing them out in bulk
// ---------------------------------------------------------------------------

export interface CleanupSender {
  id: string; // `${account} ${email}`
  account: string;
  email: string;
  name: string;
  emails: number; // inbox conversations in the window
  unread: number;
  category: 'promotions' | 'social' | 'updates' | 'forums' | 'primary';
  unsubscribe: boolean; // has a List-Unsubscribe header
  wrote: boolean; // you've emailed them
  starred: boolean;
  last: number;
  subjects: string[];
  threads: string[];
}

const SCAN_DAYS = 90;
const SCAN_MAX = 400; // inbox conversations per account

/** Every sender in the inbox over the last 90 days, with how much of their mail you read. */
export async function scanSenders(onProgress: (done: number, total: number) => void): Promise<CleanupSender[]> {
  const accounts = loadAccounts().map((a) => a.email).filter((e) => !isHidden(e));
  const ids: { account: string; id: string }[] = [];
  for (const account of accounts) {
    let pageToken = '';
    let n = 0;
    do {
      const params = new URLSearchParams({ q: `in:inbox newer_than:${SCAN_DAYS}d`, maxResults: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await api<{ threads?: { id: string }[]; nextPageToken?: string }>(account, `/threads?${params}`);
      for (const t of r.threads ?? []) { if (n++ < SCAN_MAX) ids.push({ account, id: t.id }); }
      pageToken = n < SCAN_MAX ? r.nextPageToken ?? '' : '';
    } while (pageToken);
  }

  const by = new Map<string, CleanupSender>();
  let done = 0;
  onProgress(0, ids.length);
  await pool(ids, 8, async ({ account, id }) => {
    const t = await api<GThread>(account, `/threads/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`).catch(() => null);
    done += 1;
    if (done % 10 === 0 || done === ids.length) onProgress(done, ids.length);
    const msgs = t?.messages ?? [];
    const theirs = [...msgs].reverse().find((m) => !m.labelIds?.includes('SENT'));
    if (!theirs) return;
    const from = parseAddress(header(theirs, 'From'));
    if (!/@/.test(from.email)) return;
    const key = `${account} ${from.email}`;
    let x = by.get(key);
    if (!x) {
      x = { id: key, account, email: from.email, name: from.name, emails: 0, unread: 0, category: 'primary', unsubscribe: false, wrote: false, starred: false, last: 0, subjects: [], threads: [] };
      by.set(key, x);
    }
    const labels = new Set(msgs.flatMap((m) => m.labelIds ?? []));
    x.emails += 1;
    x.threads.push(id);
    if (labels.has('UNREAD')) x.unread += 1;
    if (labels.has('STARRED')) x.starred = true;
    if (header(theirs, 'List-Unsubscribe')) x.unsubscribe = true;
    const cat = labels.has('CATEGORY_PROMOTIONS') ? 'promotions' : labels.has('CATEGORY_SOCIAL') ? 'social' : labels.has('CATEGORY_UPDATES') ? 'updates' : labels.has('CATEGORY_FORUMS') ? 'forums' : null;
    if (cat) x.category = cat;
    const date = Number(theirs.internalDate ?? 0);
    if (date > x.last) x.last = date;
    const subj = header(theirs, 'Subject').trim();
    if (subj && x.subjects.length < 4 && !x.subjects.includes(subj)) x.subjects.push(subj.slice(0, 120));
  });

  // Have you ever written to them? Asked only for senders that could be clutter.
  const maybe = [...by.values()].filter((x) => !x.starred && (x.unsubscribe || x.category !== 'primary' || x.emails >= 3));
  await pool(maybe, 6, async (x) => {
    const params = new URLSearchParams({ q: `in:sent to:${x.email}`, maxResults: '1' });
    const r = await api<{ messages?: unknown[] }>(x.account, `/messages?${params}`).catch(() => ({ messages: [] }));
    x.wrote = (r.messages?.length ?? 0) > 0;
  });
  return [...by.values()].sort((a, b) => b.emails - a.emails);
}

export interface CleanupDone {
  unsubscribed: number;
  archived: number;
  links: { name: string; url: string }[]; // senders whose unsubscribe is a web page
  undo: Undo[];
}

/** Unsubscribes (where asked) and takes each sender's mail out of the inbox. */
export async function cleanupApply(
  items: { account: string; email: string; name: string; threads: string[]; unsubscribe: boolean }[],
  onProgress: (done: number, total: number) => void,
): Promise<CleanupDone> {
  const out: CleanupDone = { unsubscribed: 0, archived: 0, links: [], undo: [] };
  const archivedBy = new Map<string, string[]>();
  let done = 0;
  onProgress(0, items.length);
  for (const it of items) {
    if (it.unsubscribe && it.threads[0]) {
      const r = await unsubscribeQuietly(it.account, it.threads[0]).catch(() => ({ status: 'none' as const }));
      if (r.status === 'done') out.unsubscribed += 1;
      else if (r.status === 'link') out.links.push({ name: it.name, url: r.url });
    }
    const ids = [...new Set([...it.threads, ...(await fromSender(it.account, it.email).catch(() => []))])];
    if (ids.length) {
      dropFromFeed(it.account, ids);
      await pool(ids, 5, (tid) => api(it.account, `/threads/${tid}/modify`, { method: 'POST', body: { removeLabelIds: ['INBOX'] } }).catch(() => undefined));
      archivedBy.set(it.account, [...(archivedBy.get(it.account) ?? []), ...ids]);
      out.archived += ids.length;
    }
    onProgress(++done, items.length);
  }
  for (const [account, ids] of archivedBy) out.undo.push({ kind: 'archive', account, ids });
  void refresh();
  return out;
}

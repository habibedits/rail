// Calendar space data (PRD §6.6), read through Notion's hosted MCP server.
// Notion Calendar already has the user's Google accounts connected, and
// Notion's `notion-calendar-list-events` tool returns events across all of
// them, so Rail never talks to Google directly.
//
// Sign-in is standard MCP OAuth: Rail registers itself as a public client
// (dynamic client registration), the consent page opens in the user's normal
// browser, and Notion redirects back to a one-shot server on 127.0.0.1
// (PKCE). Tokens are stored with safeStorage (Keychain). Rail reads today's
// events and, when the user asks, moves or adds events and opens meeting notes.

import crypto from 'node:crypto';
import http from 'node:http';
import { shell } from 'electron';
import { getSecret, setSecret } from './secrets';

const AS = 'https://mcp.notion.com';
const MCP_URL = 'https://mcp.notion.com/mcp';
const RESOURCE = 'https://mcp.notion.com/mcp';

export class CalError extends Error {
  constructor(message: string, readonly needsSignIn = false) {
    super(message);
  }
}

interface Stored { clientId: string; refresh: string; access?: string; exp?: number }
const load = (): Stored | null => {
  const raw = getSecret('notion-calendar');
  return raw ? (JSON.parse(raw) as Stored) : null;
};
const store = (s: Stored | null) => setSecret('notion-calendar', s ? JSON.stringify(s) : null);

export const isConnected = () => !!load();
export function disconnect() {
  store(null);
  session = null;
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

let pending: Promise<void> | null = null;
export function connect(): Promise<void> {
  pending ??= doConnect().finally(() => { pending = null; });
  return pending;
}

async function postForm(url: string, body: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  } catch {
    throw new CalError('Can’t reach Notion. Check your connection.');
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (j.error === 'invalid_grant') throw new CalError('Notion signed Rail out. Connect again.', true);
    throw new CalError(j.error_description || j.error || `Notion sign-in error (${res.status}).`);
  }
  return j as { access_token: string; refresh_token?: string; expires_in?: number };
}

async function doConnect() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');

  let redirect = '';
  let clientId = '';
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (u.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Rail</title><body style="font:15px -apple-system,sans-serif;display:grid;place-items:center;height:90vh;color:#333">
        <p>${ok ? 'Rail is connected to Notion Calendar. You can close this tab.' : 'Connecting didn’t finish. Go back to Rail and try again.'}</p>`);
      clearTimeout(timer);
      server.close();
      if (ok) resolve(u.searchParams.get('code')!);
      else reject(new CalError(u.searchParams.get('error') === 'access_denied' ? 'Connecting was cancelled.' : 'Connecting to Notion failed.'));
    });
    const timer = setTimeout(() => { server.close(); reject(new CalError('Connecting timed out.')); }, 5 * 60 * 1000);
    server.listen(0, '127.0.0.1', async () => {
      try {
        redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`;
        const reg = await fetch(`${AS}/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_name: 'Rail',
            redirect_uris: [redirect],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
          }),
        });
        const rj = await reg.json().catch(() => ({}));
        if (!reg.ok || !rj.client_id) throw new CalError(rj.error_description || 'Notion wouldn’t register Rail.');
        clientId = rj.client_id;
        const auth = new URL(`${AS}/authorize`);
        auth.search = new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirect,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
          resource: RESOURCE,
        }).toString();
        await shell.openExternal(auth.toString());
      } catch (e) {
        clearTimeout(timer);
        server.close();
        reject(e instanceof CalError ? e : new CalError('Can’t reach Notion. Check your connection.'));
      }
    });
  });

  const tok = await postForm(`${AS}/token`, {
    grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: RESOURCE,
  });
  if (!tok.refresh_token) throw new CalError('Notion didn’t return a refresh token.');
  store({ clientId, refresh: tok.refresh_token, access: tok.access_token, exp: Date.now() + ((tok.expires_in ?? 3600) - 60) * 1000 });
  session = null;
}

async function accessToken(): Promise<string> {
  const s = load();
  if (!s) throw new CalError('Connect Notion Calendar first.', true);
  if (s.access && s.exp && s.exp > Date.now()) return s.access;
  const tok = await postForm(`${AS}/token`, { grant_type: 'refresh_token', refresh_token: s.refresh, client_id: s.clientId, resource: RESOURCE })
    .catch((e) => { if (e instanceof CalError && e.needsSignIn) store(null); throw e; });
  store({ ...s, refresh: tok.refresh_token ?? s.refresh, access: tok.access_token, exp: Date.now() + ((tok.expires_in ?? 3600) - 60) * 1000 });
  return tok.access_token;
}

// ---------------------------------------------------------------------------
// MCP (Streamable HTTP)
// ---------------------------------------------------------------------------

let session: string | null = null;
let rpcId = 0;

async function rpc(method: string, params: unknown, notify = false): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (session) headers['Mcp-Session-Id'] = session;
  const id = ++rpcId;
  let res: Response;
  try {
    res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }) });
  } catch {
    throw new CalError('Can’t reach Notion. Check your connection.');
  }
  if (res.status === 401) {
    const s = load();
    if (s) store({ ...s, access: undefined, exp: 0 });
    throw new CalError('Notion needs you to connect again.', true);
  }
  if (res.status === 404 && session) { session = null; throw new CalError('session-expired'); }
  const sid = res.headers.get('mcp-session-id');
  if (sid) session = sid;
  if (notify) return null;
  if (!res.ok) throw new CalError(`Notion error (${res.status}).`);
  const text = await res.text();
  let msg: any = null;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try { const m = JSON.parse(line.slice(5)); if (m.id === id) msg = m; } catch { /* keep scanning */ }
    }
  } else {
    msg = JSON.parse(text);
  }
  if (!msg) throw new CalError('Notion sent an empty reply.');
  if (msg.error) throw new CalError(msg.error.message ?? 'Notion error.');
  return msg.result;
}

async function ensureSession() {
  if (session) return;
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Rail', version: '1.0' } });
  await rpc('notifications/initialized', {}, true);
}

async function callTool(name: string, args: Record<string, unknown>) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await ensureSession();
    try {
      const r = await rpc('tools/call', { name, arguments: args });
      const text = (r?.content ?? []).find((c: { type: string }) => c.type === 'text')?.text ?? '';
      if (r?.isError) throw new CalError(text || 'Notion Calendar returned an error.');
      try { return JSON.parse(text); } catch { return text; }
    } catch (e) {
      if (e instanceof CalError && e.message === 'session-expired' && attempt === 0) continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Today's events
// ---------------------------------------------------------------------------

export interface CalInfo {
  key: string; // accountId|calendarId
  account: string; // email
  name: string;
  defaultOn: boolean;
  count: number; // events today
  writable: boolean;
  primary: boolean;
  work: boolean; // the account Notion Calendar marks as work
}

export interface CalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  calendar: string; // CalInfo.key
  account: string;
  joinUrl: string | null;
  webUrl: string | null;
  people: number;
  response: 'accepted' | 'tentative' | 'needsAction' | 'declined' | null;
  canMove: boolean; // the user can change its time
  recurring: boolean;
  canRsvp: boolean; // an invite from someone else
}

const MEETING_LINK = /https:\/\/[^\s"<>]*(zoom\.us\/(j|my|w)\/|meet\.google\.com\/|teams\.microsoft\.com\/l\/meetup-join|whereby\.com\/|around\.co\/)[^\s"<>)]*/i;

const localDay = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd).getTime(); };
function when(p: any): number {
  if (p?.dateTime) return Date.parse(p.dateTime);
  if (p?.date) return localDay(p.date);
  return NaN;
}

export async function todayEvents(): Promise<{ events: CalEvent[]; calendars: CalInfo[] }> {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const data = await callTool('notion-calendar-list-events', {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    includeDeclinedInvites: false,
  });

  const events: CalEvent[] = [];
  const calendars: CalInfo[] = [];
  for (const acct of data?.accounts ?? []) {
    for (const c of acct.calendars ?? []) {
      const key = `${acct.accountId}|${c.calendarId}`;
      const evs = (c.events ?? []).filter((e: any) => e.eventStatus !== 'cancelled' && e.eventType !== 'workingLocation');
      calendars.push({
        key,
        account: acct.email,
        name: c.isPrimary ? acct.email : (c.name || c.calendarId).trim(),
        defaultOn: !!(c.isSelected || c.isPrimary) && !/holiday/i.test(c.calendarId),
        count: evs.length,
        writable: !c.isReadOnly && acct.capabilities?.writeEvents !== false,
        primary: !!c.isPrimary,
        work: acct.category === 'work',
      });
      for (const e of evs) {
        const allDay = e.period?.type === 'DATE' || (!e.period?.start?.dateTime && !!e.period?.start?.date);
        const s = when(e.period?.start), en = when(e.period?.end);
        if (!isFinite(s)) continue;
        const self = (e.attendees ?? []).find((a: any) => a.isSelf);
        events.push({
          id: `${key}|${e.eventId}`,
          title: e.summary || '(No title)',
          start: s,
          end: isFinite(en) ? en : s + 30 * 60000,
          allDay,
          calendar: key,
          account: acct.email,
          joinUrl: e.conferencingUrl || (MEETING_LINK.exec(e.location ?? '')?.[0] ?? MEETING_LINK.exec(e.description ?? '')?.[0] ?? null),
          webUrl: e.webUrl ?? null,
          people: (e.attendees ?? []).length,
          response: (e.responseStatus ?? self?.responseStatus ?? null) as CalEvent['response'],
          canMove: !allDay && !c.isReadOnly && (e.organizer ? !!e.organizer.isSelf : true),
          recurring: !!e.isRecurring,
          canRsvp: !!self && !(e.organizer?.isSelf ?? self?.isOrganizer),
        });
      }
    }
  }
  events.sort((x, y) => Number(y.allDay) - Number(x.allDay) || x.start - y.start);
  return { events, calendars };
}

// ---------------------------------------------------------------------------
// Changes the user makes from Rail
// ---------------------------------------------------------------------------

const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const split = (id: string) => {
  const [accountId, calendarId, ...rest] = id.split('|');
  return { calendar: { accountId, calendarId }, eventId: rest.join('|') };
};
const period = (start: number, end: number) => ({
  type: 'DATE_TIME',
  start: { dateTime: new Date(start).toISOString() },
  end: { dateTime: new Date(end).toISOString() },
});

export async function moveEvent(id: string, title: string, start: number, end: number) {
  const ev = split(id);
  await callTool('notion-calendar-update-events', {
    timeZone: zone(),
    updates: [{ updateType: 'UPDATE', event: { ...ev, eventSummary: title }, update: { period: period(start, end) } }],
  });
}

export async function rsvp(id: string, title: string, responseStatus: 'accepted' | 'declined' | 'tentative') {
  await callTool('notion-calendar-update-events', {
    timeZone: zone(),
    updates: [{ updateType: 'RSVP', event: { ...split(id), eventSummary: title }, rsvp: { responseStatus } }],
  });
}

export async function addEvent(calendarKey: string, title: string, start: number, end: number) {
  const [accountId, calendarId] = calendarKey.split('|');
  await callTool('notion-calendar-create-events', {
    timeZone: zone(),
    events: [{ summary: title, calendar: { accountId, calendarId }, period: period(start, end), disableConferencing: true }],
  });
}

// The event's Notion meeting note: Notion returns the existing one, or makes
// one filed like the user's other meeting notes. Returns its page URL.
export async function meetingNote(id: string): Promise<string> {
  const ev = split(id);
  const r = await callTool('notion-create-meeting-note', { calendarEvent: ev });
  const found = findUrl(r) ?? findPageId(r);
  if (!found) {
    lastNoteReply = typeof r === 'string' ? r : JSON.stringify(r);
    throw new CalError('Notion didn’t return a link to the meeting note.');
  }
  return found;
}

function findUrl(v: unknown): string | null {
  if (typeof v === 'string') {
    const m = /https:\/\/(?!calendar\.|mcp\.)([a-z]+\.)?notion\.(so|com)\/[^\s"'<>)\]]+/.exec(v);
    return m ? m[0] : null;
  }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['url', 'pageUrl', 'page_url']) if (typeof o[k] === 'string' && /notion\.(so|com)/.test(o[k] as string) && !/\/\/(calendar|mcp)\./.test(o[k] as string)) return o[k] as string;
    for (const x of Object.values(o)) { const f = findUrl(x); if (f) return f; }
    if (typeof o.id === 'string' && /^[0-9a-f-]{32,36}$/i.test(o.id)) return `https://www.notion.so/${o.id.replace(/-/g, '')}`;
  }
  return null;
}

// Kept in memory (never written to disk) so a failed lookup can be inspected.
export let lastNoteReply = '';

// Replies sometimes name the page only by id ("page://<uuid>", "id": "<uuid>").
function findPageId(v: unknown): string | null {
  const text = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  const m = /(?:page:\/\/|"(?:page_?[iI]d|id|meetingNoteId)"\s*:\s*")([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})/i.exec(text);
  return m ? `https://www.notion.so/${m[1].replace(/-/g, '')}` : null;
}

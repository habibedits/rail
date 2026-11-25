// Inbox clean-up with Claude, for the Mail space.
//
// 1. Rail scans every inbox (last 90 days) and groups it by sender: how many
//    emails, how many you never opened, Gmail's category, whether there's an
//    unsubscribe link, and whether you've ever written to them.
// 2. Senders that could be clutter go to Claude (through Claude Code on this
//    Mac): names, addresses, counts and a few subject lines, never an email's
//    body. Claude suggests Unsubscribe, Clear out (archive) or Keep, with a
//    short reason. Without Claude Code, Rail's own rules suggest instead.
// 3. You review and change any suggestion, then Rail does it, with an undo for
//    everything it archived.
//
// Runs in the background: you can leave the Mail space while it works.

import path from 'node:path';
import * as gmail from './gmail';
import * as claude from './claudeCli';

export type CleanupAction = 'unsubscribe' | 'archive' | 'keep';

export interface CleanupItem {
  id: string;
  account: string;
  email: string;
  name: string;
  emails: number;
  unread: number;
  category: gmail.CleanupSender['category'];
  unsubscribe: boolean;
  subjects: string[];
  action: CleanupAction;
  reason: string;
}

export interface CleanupState {
  phase: 'idle' | 'scanning' | 'thinking' | 'ready' | 'applying' | 'done' | 'error';
  done: number;
  total: number;
  scanned: number; // conversations looked at
  items: CleanupItem[];
  by: 'claude' | 'rules' | null;
  note: string | null; // why Rail's rules were used instead of Claude
  error: string | null;
  result: { unsubscribed: number; archived: number; links: { name: string; url: string }[]; canUndo: boolean } | null;
}

const idle = (): CleanupState => ({ phase: 'idle', done: 0, total: 0, scanned: 0, items: [], by: null, note: null, error: null, result: null });
let state: CleanupState = idle();
let threads = new Map<string, string[]>(); // item id -> its inbox conversations (kept here, not sent to the UI)
let undo: gmail.Undo[] = [];
let onChange: (s: CleanupState) => void = () => {};
let onReady: (s: CleanupState) => void = () => {};
let dataDir = '';

export function init(opts: { dataDir: string; onChange: (s: CleanupState) => void; onReady: (s: CleanupState) => void }) {
  dataDir = opts.dataDir;
  onChange = opts.onChange;
  onReady = opts.onReady;
}

export const snapshot = () => state;
const set = (patch: Partial<CleanupState>) => { state = { ...state, ...patch }; onChange(state); };

// Could this sender be clutter? Only these are suggested (and sent to Claude).
const candidate = (s: gmail.CleanupSender) =>
  !s.wrote && !s.starred && (s.unsubscribe || s.category !== 'primary' || (s.emails >= 3 && s.unread / s.emails >= 0.8));

// Rail's own suggestion, used when Claude Code isn't available. Cautious: it
// can't tell a bank alert from a newsletter, so it only suggests clearing out
// promotions and social notifications, and lists you never open at all.
function rule(s: gmail.CleanupSender): { action: CleanupAction; reason: string } {
  const unreadShare = s.unread / s.emails;
  if (s.unsubscribe && s.category === 'promotions' && unreadShare >= 0.6) return { action: 'unsubscribe', reason: 'Marketing you rarely open.' };
  if (s.unsubscribe && unreadShare === 1 && s.emails >= 5 && s.category !== 'primary') return { action: 'unsubscribe', reason: 'A mailing list you never open.' };
  if (s.category === 'social' && unreadShare >= 0.6) return { action: 'archive', reason: 'Social notifications you rarely open.' };
  return { action: 'keep', reason: 'Might matter; left alone.' };
}

const SYSTEM = [
  'You help someone clear clutter out of their email inbox.',
  'For each sender, choose exactly one action:',
  '"unsubscribe": newsletters, marketing and promotions they rarely or never open. Rail unsubscribes and takes their mail out of the inbox.',
  '"archive": automated mail not worth keeping in the inbox (shipping updates, social notifications, old alerts) where unsubscribing would be wrong or impossible. Rail only takes it out of the inbox.',
  '"keep": anything that might matter: real people, banks, bills, receipts they may need, security and account alerts, travel, work tools they rely on, and lists they actually read.',
  'Lean on the numbers: "unread" of "emails" shows how much they ignore. Be conservative; when unsure, keep.',
  'Never choose "unsubscribe" when "unsubscribe" is false; choose "archive" or "keep".',
  'Each reason: under 12 words, plain and specific, no emoji.',
].join(' ');

const SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, action: { type: 'string', enum: ['unsubscribe', 'archive', 'keep'] }, reason: { type: 'string' } },
        required: ['id', 'action', 'reason'],
      },
    },
  },
  required: ['decisions'],
};

const BATCH = 60;

export async function start() {
  if (state.phase === 'scanning' || state.phase === 'thinking' || state.phase === 'applying') return;
  state = idle();
  threads = new Map();
  undo = [];
  set({ phase: 'scanning' });
  try {
    const senders = await gmail.scanSenders((done, total) => set({ done, total, scanned: total }));
    const picks = senders.filter(candidate).slice(0, 180);
    for (const s of picks) threads.set(s.id, s.threads);
    const base = (s: gmail.CleanupSender): CleanupItem => ({
      id: s.id, account: s.account, email: s.email, name: s.name, emails: s.emails, unread: s.unread,
      category: s.category, unsubscribe: s.unsubscribe, subjects: s.subjects, ...rule(s),
    });
    let items = picks.map(base);

    // Ask Claude, a batch at a time. Short ids keep addresses out of the answer.
    let by: CleanupState['by'] = 'rules';
    let note: string | null = null;
    if (items.length) {
      set({ phase: 'thinking', done: 0, total: items.length, items: [] });
      try {
        const decided = new Map<string, { action: CleanupAction; reason: string }>();
        for (let i = 0; i < items.length; i += BATCH) {
          const chunk = items.slice(i, i + BATCH);
          const input = 'Senders filling my inbox over the last 90 days. Decide for each one.\n' + JSON.stringify(chunk.map((x, k) => ({
            id: `s${i + k}`, name: x.name, email: x.email, emails: x.emails, unread: x.unread,
            category: x.category, unsubscribe: x.unsubscribe, subjects: x.subjects,
          })));
          const r = await claude.ask<{ decisions: { id: string; action: CleanupAction; reason: string }[] }>(input, {
            schema: SCHEMA, system: SYSTEM, cwd: path.join(dataDir, 'claude'),
          });
          for (const d of r.decisions ?? []) {
            const k = Number(d.id.replace(/^s/, ''));
            if (Number.isInteger(k) && items[k] && ['unsubscribe', 'archive', 'keep'].includes(d.action)) decided.set(items[k].id, { action: d.action, reason: String(d.reason ?? '').slice(0, 140) });
          }
          set({ done: Math.min(items.length, i + BATCH) });
        }
        items = items.map((x) => {
          const d = decided.get(x.id);
          if (!d) return x;
          return { ...x, action: d.action === 'unsubscribe' && !x.unsubscribe ? 'archive' : d.action, reason: d.reason };
        });
        by = 'claude';
      } catch (e) {
        note = e instanceof claude.ClaudeError ? e.message : 'Claude couldn’t review these.';
      }
    }
    const order: Record<CleanupAction, number> = { unsubscribe: 0, archive: 1, keep: 2 };
    items.sort((a, b) => order[a.action] - order[b.action] || b.emails - a.emails);
    set({ phase: 'ready', items, by, note, done: 0, total: 0 });
    onReady(state);
  } catch (e) {
    set({ phase: 'error', error: (e as Error).message });
  }
}

export function choose(id: string, action: CleanupAction) {
  if (state.phase !== 'ready') return;
  set({ items: state.items.map((x) => (x.id === id ? { ...x, action: action === 'unsubscribe' && !x.unsubscribe ? 'archive' : action } : x)) });
}

export async function apply() {
  if (state.phase !== 'ready') return;
  const todo = state.items.filter((x) => x.action !== 'keep');
  if (!todo.length) { set({ phase: 'idle' }); return; }
  set({ phase: 'applying', done: 0, total: todo.length });
  try {
    const r = await gmail.cleanupApply(
      todo.map((x) => ({ account: x.account, email: x.email, name: x.name, threads: threads.get(x.id) ?? [], unsubscribe: x.action === 'unsubscribe' })),
      (done, total) => set({ done, total }),
    );
    undo = r.undo;
    set({ phase: 'done', result: { unsubscribed: r.unsubscribed, archived: r.archived, links: r.links, canUndo: r.undo.length > 0 } });
  } catch (e) {
    set({ phase: 'error', error: (e as Error).message });
  }
}

/** Puts everything the clean-up archived back in the inbox (unsubscribes stay). */
export async function undoAll() {
  for (const u of undo) await gmail.undo(u);
  undo = [];
  if (state.result) set({ result: { ...state.result, canUndo: false } });
}

export function close() {
  if (state.phase === 'scanning' || state.phase === 'thinking' || state.phase === 'applying') return;
  state = idle();
  threads = new Map();
  onChange(state);
}

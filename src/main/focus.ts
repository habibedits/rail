// Focus space: a Pomodoro timer and a log of finished focus sessions.
// The timer lives in the main process so it keeps time (and notifies) no
// matter which space is showing. Everything is stored in userData/focus.json.

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type Phase = 'focus' | 'short' | 'long';

export interface Settings {
  focus: number; // minutes
  short: number;
  long: number;
  longEvery: number; // a long break after this many focus sessions
}

export interface Session {
  start: number; // ms
  minutes: number;
  label?: string;
}

export interface Snapshot {
  phase: Phase;
  running: boolean;
  endAt: number | null; // when running
  remaining: number; // ms, when paused/idle
  duration: number; // ms, full length of the current phase
  round: number; // focus sessions finished in this cycle
  label: string;
  settings: Settings;
  sessions: Session[];
}

interface Stored {
  settings: Settings;
  sessions: Session[];
}

const DEFAULTS: Settings = { focus: 25, short: 5, long: 15, longEvery: 4 };
const file = () => path.join(app.getPath('userData'), 'focus.json');

let stored: Stored = { settings: { ...DEFAULTS }, sessions: [] };
let phase: Phase = 'focus';
let running = false;
let endAt: number | null = null;
let remaining = 0;
let startedAt = 0; // start of the current focus run (for the log)
let round = 0;
let label = '';
let timer: ReturnType<typeof setTimeout> | undefined;
let onChange: (s: Snapshot) => void = () => {};
let onDone: (finished: Phase, next: Phase) => void = () => {};

const minutesFor = (p: Phase) => stored.settings[p];
const durationOf = (p: Phase) => minutesFor(p) * 60_000;

function save() {
  try {
    fs.writeFileSync(file(), JSON.stringify(stored));
  } catch {
    /* disk full or similar: keep running from memory */
  }
}

export function init(change: (s: Snapshot) => void, done: (finished: Phase, next: Phase) => void) {
  onChange = change;
  onDone = done;
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<Stored>;
    stored = {
      settings: { ...DEFAULTS, ...(raw.settings ?? {}) },
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    };
  } catch {
    /* first run */
  }
  remaining = durationOf(phase);
}

export function snapshot(): Snapshot {
  return {
    phase,
    running,
    endAt,
    remaining: running && endAt ? Math.max(0, endAt - Date.now()) : remaining,
    duration: durationOf(phase),
    round,
    label,
    settings: stored.settings,
    sessions: stored.sessions,
  };
}

const changed = () => onChange(snapshot());

function arm() {
  clearTimeout(timer);
  if (running && endAt) timer = setTimeout(finish, Math.max(0, endAt - Date.now()) + 50);
}

function finish() {
  if (!running || !endAt || Date.now() < endAt - 100) return arm();
  const finished = phase;
  if (finished === 'focus') {
    stored.sessions.push({ start: startedAt, minutes: minutesFor('focus'), ...(label ? { label } : {}) });
    save();
    round += 1;
  }
  const next: Phase = finished === 'focus' ? (round % stored.settings.longEvery === 0 ? 'long' : 'short') : 'focus';
  setPhase(next);
  onDone(finished, next);
}

function setPhase(p: Phase) {
  phase = p;
  startedAt = 0;
  running = false;
  endAt = null;
  remaining = durationOf(p);
  clearTimeout(timer);
  changed();
}

export type FocusReq =
  | { op: 'get' }
  | { op: 'start' }
  | { op: 'pause' }
  | { op: 'reset' }
  | { op: 'skip' }
  | { op: 'phase'; phase: Phase }
  | { op: 'label'; label: string }
  | { op: 'settings'; settings: Partial<Settings> };

export function handle(req: FocusReq): Snapshot {
  switch (req.op) {
    case 'start':
      if (!running) {
        if (phase === 'focus' && !startedAt) startedAt = Date.now();
        running = true;
        endAt = Date.now() + remaining;
        arm();
        changed();
      }
      break;
    case 'pause':
      if (running && endAt) {
        remaining = Math.max(0, endAt - Date.now());
        running = false;
        endAt = null;
        clearTimeout(timer);
        changed();
      }
      break;
    case 'reset':
      setPhase(phase);
      break;
    case 'skip':
      setPhase(phase === 'focus' ? 'short' : 'focus');
      break;
    case 'phase':
      setPhase(req.phase);
      break;
    case 'label':
      label = req.label.slice(0, 120);
      break;
    case 'settings': {
      const s = { ...stored.settings };
      for (const k of ['focus', 'short', 'long', 'longEvery'] as const) {
        const v = Number(req.settings[k]);
        if (Number.isFinite(v) && v >= 1 && v <= 180) s[k] = Math.round(v);
      }
      stored.settings = s;
      save();
      if (!running) remaining = durationOf(phase);
      changed();
      break;
    }
  }
  return snapshot();
}

// Catch up after sleep: a timer that ended while the Mac slept finishes now.
export function resume() {
  if (running) finish();
}

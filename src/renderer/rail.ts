import { useEffect, useState } from 'react';

export interface RailState {
  spaces: { id: string; name: string; badge: number | string }[];
  active: number;
  pinned: boolean;
  collapsed: 'none' | 'claude' | 'notion';
  notion: { title: string; canBack: boolean; canForward: boolean };
}

export type Cmd =
  | { type: 'goto'; index: number }
  | { type: 'pin' }
  | { type: 'hide' }
  | { type: 'pane'; pane: 'claude' | 'notion'; action: 'back' | 'forward' | 'reload' | 'home' | 'new' | 'external' | 'app' }
  | { type: 'notion-trail' }
  | { type: 'notion-up' }
  | { type: 'notion-down' }
  | { type: 'collapse'; pane: 'claude' | 'notion' }
  | { type: 'divider'; phase: 'start' | 'move' | 'reset'; dy?: number };

declare global {
  interface Window {
    rail: {
      send: (cmd: Cmd) => void;
      ff: (req: FFReq) => Promise<FFRes>;
      cal: (req: CalReq) => Promise<FFRes>;
      onCal: (cb: (snap: CalSnapshot) => void) => () => void;
      focus: (req: FocusReq) => Promise<FocusSnapshot>;
      onFocus: (cb: (snap: FocusSnapshot) => void) => () => void;
      puzzle: (difficulty: string) => Promise<{ ok: true; data: ChessPuzzle } | { ok: false; error: string }>;
      onState: (cb: (s: RailState) => void) => () => void;
    };
  }
}

export const send = (cmd: Cmd) => window.rail?.send(cmd);

export function useRailState() {
  const [state, setState] = useState<RailState | null>(null);
  useEffect(() => window.rail?.onState(setState), []);
  return state;
}

// ---- Fireflies --------------------------------------------------------------

export interface Meeting {
  id: string;
  title: string;
  date: number; // epoch ms
  duration: number; // minutes
  participants: string[] | null;
  transcript_url: string;
}

export interface MeetingDetail extends Meeting {
  summary: { overview: string | null; action_items: string | null; keywords: string[] | null } | null;
  sentences: { speaker_name: string | null; text: string; start_time: number }[] | null;
}

export interface ActiveMeeting {
  id: string;
  title: string;
  meeting_link: string | null;
  start_time: string | null;
  end_time: string | null;
  state: string | null;
}

export type FFReq =
  | { op: 'status' }
  | { op: 'setKey'; key: string }
  | { op: 'clearKey' }
  | { op: 'list'; search?: string }
  | { op: 'detail'; id: string }
  | { op: 'copy'; id: string; what: 'transcript' | 'link' | 'summary' }
  | { op: 'download'; id: string; format: 'md' | 'txt' }
  | { op: 'claude'; id: string }
  | { op: 'audio'; id: string }
  | { op: 'menu'; id: string }
  | { op: 'active' }
  | { op: 'openUrl'; url: string }
  | { op: 'live'; id: string }
  | { op: 'liveCopy'; id: string; title: string }
  | { op: 'liveClaude'; id: string; title: string };

export type FFRes = { ok: true; data: any } | { ok: false; error: string; auth?: boolean };

export async function ff<T = any>(req: FFReq): Promise<T> {
  const res = await window.rail.ff(req);
  if (!res.ok) {
    const err = new Error(res.error) as Error & { auth?: boolean };
    err.auth = res.auth;
    throw err;
  }
  return res.data as T;
}

// ---- Calendar ---------------------------------------------------------------

export interface CalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  calendar: string;
  account: string;
  joinUrl: string | null;
  webUrl: string | null;
  people: number;
  response: 'accepted' | 'tentative' | 'needsAction' | 'declined' | null;
  canMove: boolean;
  recurring: boolean;
  canRsvp: boolean;
  description: string;
  location: string;
}

export interface CalInfo {
  key: string;
  account: string;
  name: string;
  on: boolean;
  count: number;
  writable: boolean;
  primary: boolean;
  work: boolean;
}

export interface CalSnapshot {
  connected: boolean;
  events: CalEvent[];
  calendars: CalInfo[];
  error: { message: string; needsSignIn: boolean } | null;
}

export type CalReq =
  | { op: 'get' }
  | { op: 'refresh' }
  | { op: 'connect' }
  | { op: 'disconnect' }
  | { op: 'toggle'; key: string }
  | { op: 'open'; url: string }
  | { op: 'move'; id: string; title: string; start: number; end: number }
  | { op: 'edit'; id: string; title: string; start: number; end: number }
  | { op: 'add'; calendar: string; title: string; start: number; end: number }
  | { op: 'notes'; id: string; transcribe?: boolean; join?: boolean }
  | { op: 'rsvp'; id: string; title: string; response: 'accepted' | 'declined' | 'tentative' };

export async function cal(req: CalReq): Promise<CalSnapshot> {
  const res = await window.rail.cal(req);
  if (!res.ok) throw new Error(res.error);
  return res.data as CalSnapshot;
}

// ---- Focus (Pomodoro) --------------------------------------------------------

export type FocusPhase = 'focus' | 'short' | 'long';
export interface FocusSettings { focus: number; short: number; long: number; longEvery: number }
export interface FocusSession { start: number; minutes: number; label?: string }
export interface FocusSnapshot {
  phase: FocusPhase;
  running: boolean;
  endAt: number | null;
  remaining: number;
  duration: number;
  round: number;
  label: string;
  settings: FocusSettings;
  sessions: FocusSession[];
}
export type FocusReq =
  | { op: 'get' }
  | { op: 'start' }
  | { op: 'pause' }
  | { op: 'reset' }
  | { op: 'skip' }
  | { op: 'phase'; phase: FocusPhase }
  | { op: 'label'; label: string }
  | { op: 'settings'; settings: Partial<FocusSettings> };

export interface ChessPuzzle {
  id: string;
  fen: string; // position to solve; the side to move is the solver
  solution: string[]; // UCI moves, solver first, alternating
  rating: number;
  themes: string[];
  lastMove: string | null;
}

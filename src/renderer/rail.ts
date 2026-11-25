import { useEffect, useState } from 'react';

export interface RailState {
  spaces: { id: string; name: string; badge: number | string }[];
  active: number;
  pinned: boolean;
  collapsed: 'none' | 'claude' | 'notion';
  notion: { title: string; canBack: boolean; canForward: boolean };
}

// The space wheel (drawn by the `wheel` view, run by the main process).
export interface WheelState {
  open: boolean;
  cx: number; cy: number; r: number; // ring center and radius, in the wheel view's pixels
  spaces: (RailState['spaces'][number] & { index: number })[]; // in slice order, clockwise from the top
  active: number; // the slice of the space you're on
  hover: number; // -1 = none (pointer still in the middle)
  px: number; py: number; // pointer offset from the center (the reticle)
  sticky: boolean; // opened by a quick click: stays open until you click a slice
  via: 'mouse' | 'key';
}

export type Cmd =
  | { type: 'goto'; index: number }
  | { type: 'wheel'; action: 'click' | 'cancel' }
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
      agents: (req: AgentsReq) => Promise<FFRes>;
      onAgents: (cb: (snap: AgentsSnapshot) => void) => () => void;
      onAgentsOpen: (cb: (sessionId: string) => void) => () => void;
      onWheel: (cb: (w: WheelState) => void) => () => void;
      mail: (req: MailReq) => Promise<FFRes & { needsSignIn?: boolean }>;
      onMail: (cb: (snap: MailSnapshot) => void) => () => void;
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
  day?: number; // midnight of the day shown (older builds: today)
  events: CalEvent[];
  calendars: CalInfo[];
  error: { message: string; needsSignIn: boolean } | null;
}

export type CalReq =
  | { op: 'get' }
  | { op: 'refresh' }
  | { op: 'day'; day: number } // show another day (any time on it); today's date goes back to today
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

// ---- Agents (Claude Code sessions) -------------------------------------------
// Mirrors src/main/agents.ts.

export type AgentStatus = 'working' | 'permission' | 'question' | 'idle' | 'ended';

export interface AgentStep {
  id: string;
  at: number;
  kind: 'prompt' | 'tool' | 'reply' | 'permission' | 'question' | 'note';
  title: string;
  detail?: string;
  state?: 'running' | 'waiting' | 'ok' | 'error' | 'denied';
}

export interface AgentQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

export interface AgentPending {
  id: string;
  kind: 'permission' | 'question';
  tool: string;
  title: string;
  detail: string;
  questions?: AgentQuestion[];
  canAlways: boolean;
  at: number;
}

export interface AgentSession {
  id: string;
  cwd: string;
  project: string;
  title: string;
  host: string;
  status: AgentStatus;
  activity: string;
  startedAt: number;
  updatedAt: number;
  steps: AgentStep[];
  pending: AgentPending | null;
  lastReply: string;
}

export interface AgentsSnapshot {
  connected: boolean;
  listening: boolean;
  error: string | null;
  sessions: AgentSession[];
}

export type AgentsReq =
  | { op: 'get' }
  | { op: 'connect' }
  | { op: 'disconnect' }
  | { op: 'decide'; id: string; pendingId: string; choice: 'allow' | 'always' | 'deny'; message?: string }
  | { op: 'answer'; id: string; pendingId: string; answers: Record<string, string> }
  | { op: 'jump'; id: string }
  | { op: 'dismiss'; id: string }
  | { op: 'clearEnded' };

export async function agents(req: AgentsReq): Promise<AgentsSnapshot> {
  const res = await window.rail.agents(req);
  if (!res.ok) throw new Error(res.error);
  return res.data as AgentsSnapshot;
}

// ---- Mail (Gmail) -------------------------------------------------------------
// Mirrors src/main/gmail.ts.

export interface MailThread {
  key: string;
  account: string;
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  date: number;
  unread: boolean;
  count: number;
  list: boolean;
}

export interface MailAccount { email: string; on: boolean; unread: number; error: string | null; needsSignIn: boolean }

export interface MailSnapshot {
  hasClient: boolean;
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

export type MailUndo =
  | { kind: 'archive' | 'trash'; account: string; ids: string[] }
  | { kind: 'block'; account: string; ids: string[]; filterId: string | null };

export interface MailBlocked { account: string; email: string; filterId: string }

export type MailReq =
  | { op: 'get' }
  | { op: 'refresh' }
  | { op: 'setClient'; id: string; secret: string }
  | { op: 'clearClient' }
  | { op: 'connect' }
  | { op: 'remove'; email: string }
  | { op: 'toggle'; email: string }
  | { op: 'search'; q: string }
  | { op: 'open'; account: string; id: string }
  | { op: 'reply'; account: string; id: string; text: string }
  | { op: 'compose'; account: string; to: string; subject: string; text: string }
  | { op: 'archive' | 'trash'; account: string; id: string }
  | { op: 'senderCount'; account: string; email: string }
  | { op: 'block'; account: string; id: string; email: string; trashAll: boolean; unsubscribe: boolean }
  | { op: 'undo'; undo: MailUndo }
  | { op: 'blocked' }
  | { op: 'unblock'; account: string; filterId: string }
  | { op: 'openUrl'; url: string };

export async function mail<T = MailSnapshot>(req: MailReq): Promise<T> {
  const res = await window.rail.mail(req);
  if (!res.ok) {
    const err = new Error(res.error) as Error & { needsSignIn?: boolean };
    err.needsSignIn = res.needsSignIn;
    throw err;
  }
  return res.data as T;
}

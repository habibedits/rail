// Fake data for the README images. Every name, company and meeting here is
// made up. Installs a stand-in `window.rail` so Rail's real screens render
// without Fireflies, Notion, Slack or a timer running.

import type { CalEvent, CalInfo, FocusSession } from '../../src/renderer/rail';

// A fixed clock: today at 10:42 AM, so every image shows the same moment.
const RealDate = Date;
const target = new RealDate();
target.setHours(10, 42, 0, 0);
const OFFSET = target.getTime() - RealDate.now();
class FakeDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + OFFSET);
    else super(...(args as [number]));
  }
  static now() { return RealDate.now() + OFFSET; }
}
(globalThis as unknown as { Date: DateConstructor }).Date = FakeDate as unknown as DateConstructor;

const params = new URLSearchParams(location.search);
export const SPACE = params.get('space') ?? 'calendar';
const SPACES = ['claude', 'notion', 'meetings', 'slack', 'calendar', 'focus'];
const NAMES: Record<string, string> = { claude: 'Claude', notion: 'Notion', meetings: 'Meetings', slack: 'Slack', calendar: 'Calendar', focus: 'Focus' };

const day = new Date(); day.setHours(0, 0, 0, 0);
const at = (h: number, m = 0) => day.getTime() + (h * 60 + m) * 60000;

// ---- Calendar -------------------------------------------------------------

const calendars: CalInfo[] = [
  { key: 'w|primary', account: 'maya@northwind.studio', name: 'Maya Chen', on: true, count: 6, writable: true, primary: true, work: true },
  { key: 'w|team', account: 'maya@northwind.studio', name: 'Studio team', on: true, count: 2, writable: true, primary: false, work: true },
  { key: 'p|primary', account: 'maya.chen@example.com', name: 'Personal', on: true, count: 2, writable: true, primary: true, work: false },
  { key: 'p|gym', account: 'maya.chen@example.com', name: 'Climbing gym', on: false, count: 0, writable: false, primary: false, work: false },
];

const ev = (id: string, title: string, s: number, e: number, cal: string, extra: Partial<CalEvent> = {}): CalEvent => ({
  id, title, start: s, end: e, allDay: false, calendar: cal, account: cal.startsWith('w') ? 'maya@northwind.studio' : 'maya.chen@example.com',
  joinUrl: null, webUrl: 'https://calendar.notion.so', people: 1, response: 'accepted', canMove: true, recurring: false, canRsvp: false,
  description: '', location: '', ...extra,
});

const events: CalEvent[] = [
  ev('1', 'Studio standup', at(9, 0), at(9, 15), 'w|team', { people: 6, recurring: true }),
  ev('2', 'Design review: onboarding v2', at(10, 30), at(11, 15), 'w|primary', {
    people: 4, joinUrl: 'https://meet.example.com/abc',
    description: 'Walk through the new first-run flow before Friday’s handoff.\n• Empty states for Projects and Inbox\n• Copy pass on the welcome checklist\nFigma: https://figma.com/file/onboarding-v2',
  }),
  ev('3', 'Lunch with Priya', at(12, 0), at(13, 0), 'p|primary', { location: 'Little Fern Café' }),
  ev('4', 'Theo <> Maya 1:1', at(13, 30), at(14, 0), 'w|primary', { people: 2, joinUrl: 'https://meet.example.com/1on1' }),
  ev('5', 'Deep work: pricing page', at(14, 0), at(15, 30), 'w|primary'),
  ev('6', 'Brightline kickoff', at(15, 30), at(16, 15), 'w|primary', { people: 7, joinUrl: 'https://meet.example.com/brightline', response: 'needsAction', canRsvp: true, canMove: false }),
  ev('7', 'Ship notes', at(16, 30), at(17, 0), 'w|team', { people: 5 }),
  ev('8', 'Bouldering with Jonah', at(18, 30), at(20, 0), 'p|primary'),
];
const allDay: CalEvent[] = [
  { ...ev('a1', 'Lena out of office', day.getTime(), day.getTime() + 86400000, 'w|team'), allDay: true, canMove: false },
];

// ---- Focus ----------------------------------------------------------------

function sessions(): FocusSession[] {
  const out: FocusSession[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let d = 150; d >= 0; d--) {
    const date = new Date(day); date.setDate(day.getDate() - d);
    const wd = date.getDay();
    const busy = wd === 0 || wd === 6 ? 0.25 : 0.85;
    if (rnd() > busy) continue;
    const n = d === 0 ? 2 : Math.ceil(rnd() * (wd === 0 || wd === 6 ? 2 : 6));
    for (let i = 0; i < n; i++) out.push({ start: date.getTime() + (9 + i) * 3600000, minutes: 25, label: 'Focus' });
  }
  return out;
}
const focusSnap = {
  phase: 'focus', running: true, endAt: Date.now() + (14 * 60 + 32) * 1000, remaining: (14 * 60 + 32) * 1000,
  duration: 25 * 60000, round: 2, label: 'Pricing page copy', settings: { focus: 25, short: 5, long: 15, longEvery: 4 }, sessions: sessions(),
};

// ---- Meetings (Fireflies) -------------------------------------------------

const meetings = [
  { id: 'm1', title: 'Design review: onboarding v1', date: at(-24 + 15, 0), duration: 42, participants: ['maya@northwind.studio', 'theo@northwind.studio', 'priya@northwind.studio', 'sam@northwind.studio'], transcript_url: '' },
  { id: 'm2', title: 'Brightline discovery call', date: at(-48 + 11, 0), duration: 55, participants: ['maya@northwind.studio', 'dana@brightline.example'], transcript_url: '' },
  { id: 'm3', title: 'Weekly ship notes', date: at(-72 + 16, 30), duration: 24, participants: ['maya@northwind.studio', 'theo@northwind.studio', 'lena@northwind.studio'], transcript_url: '' },
  { id: 'm4', title: 'Theo <> Maya 1:1', date: at(-168 + 13, 30), duration: 31, participants: ['maya@northwind.studio', 'theo@northwind.studio'], transcript_url: '' },
  { id: 'm5', title: 'Pricing workshop', date: at(-192 + 10, 0), duration: 78, participants: ['maya@northwind.studio', 'priya@northwind.studio', 'jonah@northwind.studio'], transcript_url: '' },
];
const detail = {
  ...meetings[0],
  summary: {
    overview: '**Decision:** Ship the shorter checklist (4 steps instead of 7).\n**Empty states:** Projects gets an illustration and one clear action.\n**Risk:** Copy isn’t final; Priya to tighten by Thursday.',
    action_items: '**Priya Natarajan**\nTighten welcome checklist copy (12:40)\nShare final strings with eng (31:05)\n**Theo Alvarez**\nPrototype the new empty state for Projects (18:22)',
    keywords: ['onboarding', 'empty states', 'checklist'],
  },
  sentences: [
    { speaker_name: 'Maya Chen', text: 'Okay, let’s start with the checklist. Seven steps feels like a lot.', start_time: 4 },
    { speaker_name: 'Theo Alvarez', text: 'Agreed. Most people stop after step three anyway.', start_time: 11 },
    { speaker_name: 'Priya Natarajan', text: 'I can cut it to four if we merge invite and share.', start_time: 19 },
  ],
};
const live = [{ id: 'live1', title: 'Brightline kickoff', meeting_link: 'https://meet.example.com/brightline', start_time: new Date(Date.now() - 7 * 60000).toISOString(), end_time: null, state: 'active' }];
const liveSentences = [
  { speaker_name: 'Dana Whitfield', text: 'Thanks for having us. Our main goal this quarter is fewer drop-offs in signup.', start_time: 12 },
  { speaker_name: 'Maya Chen', text: 'That lines up with what we saw in the onboarding review.', start_time: 26 },
  { speaker_name: 'Dana Whitfield', text: 'Great. Can you share a rough timeline by Friday?', start_time: 41 },
];

// ---- The stand-in bridge --------------------------------------------------

const ok = (data: unknown) => Promise.resolve({ ok: true, data });
const state = {
  spaces: SPACES.map((id) => ({ id, name: NAMES[id], badge: id === 'slack' ? 3 : 0 })),
  active: SPACES.indexOf(SPACE),
  pinned: false,
  collapsed: 'none',
  notion: { title: params.get('ntitle') ?? 'Onboarding v2 — Project brief', canBack: true, canForward: false },
};

(window as unknown as { rail: unknown }).rail = {
  send: () => {},
  onState: (cb: (s: unknown) => void) => { setTimeout(() => cb(state), 0); return () => {}; },
  cal: (req: { op: string }) => ok({
    connected: true,
    events: req.op === 'edit' ? events : [...allDay, ...events],
    calendars: calendars.map((c) => ({ ...c, on: c.on })),
    error: null,
  }),
  onCal: () => () => {},
  focus: () => Promise.resolve(focusSnap),
  onFocus: () => () => {},
  puzzle: () => ok({ id: 'demo', fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', solution: ['h5f7'], rating: 1184, themes: ['mateIn1'], lastMove: 'g8f6' }),
  ff: (req: { op: string }) => {
    switch (req.op) {
      case 'status': return ok({ hasKey: true });
      case 'list': return ok(meetings);
      case 'detail': return ok(detail);
      case 'audio': return ok({ url: null });
      case 'active': return ok(params.get('live') ? live : []);
      case 'live': return ok({ sentences: liveSentences });
      default: return ok({ done: null });
    }
  },
};

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
const SPACES = ['claude', 'notion', 'meetings', 'slack', 'mail', 'calendar', 'agents', 'focus'];
const NAMES: Record<string, string> = { claude: 'Claude', notion: 'Notion', meetings: 'Meetings', slack: 'Slack', mail: 'Mail', calendar: 'Calendar', agents: 'Agents', focus: 'Focus' };

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

// ---- Agents (Claude Code sessions) ----------------------------------------

const agentSession = (id: string, project: string, status: string, activity: string, host: string, minsAgo: number, pending: unknown = null) => ({
  id, cwd: `/Users/maya/code/${project}`, project, title: '', host, status, activity,
  startedAt: Date.now() - (minsAgo + 20) * 60000, updatedAt: Date.now() - minsAgo * 60000, steps: [], pending, lastReply: '',
});
const agentSessions = [
  agentSession('a1', 'northwind-web', 'permission', '', 'VS Code', 0, {
    id: 'p1', kind: 'permission', tool: 'Bash', title: 'Run npm test', detail: 'npm test -- onboarding', canAlways: true, at: Date.now(),
  }),
  agentSession('a2', 'pricing-page', 'working', 'Editing PricingTable.tsx', 'Terminal', 0),
  agentSession('a3', 'onboarding-v2', 'working', 'Running the checklist tests', 'VS Code', 1),
  agentSession('a4', 'brightline-api', 'question', '', 'Terminal', 2, {
    id: 'q1', kind: 'question', tool: 'AskUserQuestion', title: 'Which auth flow?', detail: '', canAlways: false, at: Date.now(),
  }),
  agentSession('a5', 'design-tokens', 'idle', 'Done: tokens exported', 'VS Code', 14),
  agentSession('a6', 'docs-site', 'ended', 'Finished', 'Terminal', 52),
  agentSession('a7', 'email-templates', 'working', 'Reading layout.html', 'Terminal', 0),
  agentSession('a8', 'analytics-etl', 'idle', 'Done: 3 files changed', 'VS Code', 31),
  agentSession('a9', 'mobile-app', 'working', 'Searching for useAuth', 'VS Code', 3),
];

// ---- Mail -----------------------------------------------------------------

const H = 3600000;
const WORK = 'maya@northwind.studio', HOME = 'maya.chen@gmail.com', SIDE = 'hello@paperkite.co';
const thread = (account: string, id: string, from: string, fromEmail: string, subject: string, snippet: string, ago: number, unread: boolean, list = false, count = 1) =>
  ({ key: `${account} ${id}`, account, id, from, fromEmail, subject, snippet, date: Date.now() - ago * H, unread, count, list });
const mailThreads = [
  thread(WORK, 't1', 'Dana Whitfield', 'dana@brightline.io', 'Timeline for the onboarding revamp', 'Thanks again for Tuesday. Could you send a rough timeline by Friday?', 0.6, true, false, 3),
  thread(SIDE, 't2', 'Ledgerly', 'payouts@ledgerly.com', 'Your payout of $1,240.00 is on the way', 'A payout of $1,240.00 to your account ending in 4412 is on its way.', 1.4, true),
  thread(HOME, 't3', 'Sam Okafor', 'sam.okafor@gmail.com', 'Dinner Sunday?', 'Lena and I are doing dinner Sunday around 7. Want to come?', 2.3, true),
  thread(HOME, 't4', 'DealHunter Weekly', 'deals@dealhunter.shop', '72 hours only: 60% off everything you looked at', 'Your cart misses you. For the next 72 hours everything is 60% off.', 3.1, true, true),
  thread(WORK, 't5', 'Theo Alvarez', 'theo@northwind.studio', 'Re: Pricing workshop notes', 'I cleaned up the notes from the workshop and dropped them in Notion.', 26, false, false, 2),
  thread(SIDE, 't6', 'Growthly SEO', 'kevin@growthly-seo.net', 'Quick question about paperkite.co', 'I was looking at paperkite.co and noticed you’re missing out on traffic.', 27, false, true),
  thread(WORK, 't7', 'Priya Natarajan', 'priya@northwind.studio', 'Final strings for the checklist', 'Attached are the final strings for the welcome checklist.', 30, false),
  thread(HOME, 't8', 'Skyway Air', 'trips@skywayair.com', 'Your trip to Lisbon: check in now', 'Check-in is open for flight SK 214 to Lisbon on Thursday.', 74, false, true),
];
const mailSnap = {
  hasClient: true,
  builtIn: true,
  accounts: [
    { email: WORK, on: true, unread: 1, error: null, needsSignIn: false },
    { email: HOME, on: true, unread: 2, error: null, needsSignIn: false },
    { email: SIDE, on: true, unread: 1, error: null, needsSignIn: false },
  ],
  threads: mailThreads,
  loading: false,
  updatedAt: Date.now(),
  error: null,
};
const mailDetail = (account: string, id: string) => {
  const t = mailThreads.find((x) => x.id === id) ?? mailThreads[0];
  const msg = (mid: string, from: string, fromEmail: string, text: string, ago: number, mine = false) =>
    ({ id: mid, from, fromEmail, to: account, cc: '', date: Date.now() - ago * H, html: null, text, attachments: [] as { name: string; size: number }[], mine });
  const messages = id === 't1'
    ? [
        msg('m1', 'Maya Chen', WORK, 'Sounds good, talk Tuesday.', 50, true),
        msg('m2', 'Dana Whitfield', 'dana@brightline.io', 'Great, see you then.', 49),
        { ...msg('m3', 'Dana Whitfield', 'dana@brightline.io', 'Hi Maya,\n\nThanks again for Tuesday. Could you send a rough timeline for the onboarding revamp by Friday? We mostly need to know when the shorter checklist could ship.\n\nIf it helps, we can push the empty-state work to the next phase.\n\nBest,\nDana', 0.6), attachments: [{ name: 'Onboarding v1 review.pdf', size: 240000 }] },
      ]
    : [msg('m9', t.from, t.fromEmail, t.snippet, 1)];
  return { account, id, subject: t.subject, messages, unsubscribe: t.list, webUrl: 'https://mail.google.com' };
};

// ---- Mail clean-up (&clean=idle|scanning|thinking|ready|done opens it) -------

const cl = (id: string, name: string, email: string, emails: number, unread: number, category: string, unsubscribe: boolean, action: string, reason: string) =>
  ({ id: `${HOME} ${email}`, account: HOME, email, name, emails, unread, category, unsubscribe, subjects: [], action, reason });
const cleanItems = [
  cl('1', 'Medium Daily Digest', 'noreply@medium.com', 64, 64, 'updates', true, 'unsubscribe', 'Daily digest, all 64 unread'),
  cl('2', 'Morning Brew', 'crew@morningbrew.com', 55, 53, 'promotions', true, 'unsubscribe', 'Daily newsletter, 53 of 55 unread'),
  cl('3', 'Old Navy', 'oldnavy@email.oldnavy.com', 42, 41, 'promotions', true, 'unsubscribe', 'Retail promotions, 41 of 42 unread'),
  cl('4', 'Sephora', 'beauty@e.sephora.com', 36, 36, 'promotions', true, 'unsubscribe', 'Beauty promotions, none of 36 opened'),
  cl('5', 'Uber Eats', 'uber@uber.com', 31, 29, 'promotions', true, 'unsubscribe', 'Delivery promos, almost never opened'),
  cl('6', 'Amazon.com', 'shipment-tracking@amazon.com', 18, 15, 'updates', false, 'archive', 'Shipping updates, no unsubscribe option'),
  cl('7', 'Chase', 'no.reply.alerts@chase.com', 15, 12, 'updates', false, 'keep', 'Bank statements and payment alerts'),
  cl('8', 'GitHub', 'notifications@github.com', 40, 38, 'updates', true, 'keep', 'Your repo activity and security alerts'),
];
function cleanupState() {
  const phase = params.get('clean') ?? 'idle';
  return {
    phase, scanned: 412, by: 'claude', note: null, error: null,
    done: phase === 'scanning' ? 268 : phase === 'applying' ? 4 : 0, total: phase === 'scanning' ? 412 : phase === 'thinking' ? 64 : phase === 'applying' ? 6 : 0,
    items: phase === 'ready' ? cleanItems : [],
    result: phase === 'done' ? { unsubscribed: 4, archived: 246, links: [{ name: 'Uber Eats', url: 'https://example.com/unsubscribe' }], canUndo: true } : null,
  };
}

// ---- The stand-in bridge --------------------------------------------------

const ok = (data: unknown) => Promise.resolve({ ok: true, data });
const state = {
  spaces: SPACES.map((id) => ({ id, name: NAMES[id], badge: id === 'slack' ? 3 : id === 'agents' ? 2 : id === 'mail' ? 4 : 0 })),
  active: SPACES.indexOf(SPACE),
  pinned: false,
  collapsed: 'none',
  notion: { title: params.get('ntitle') ?? 'Onboarding v2 — Project brief', canBack: true, canForward: false },
};

(window as unknown as { rail: unknown }).rail = {
  send: () => {},
  onState: (cb: (s: unknown) => void) => { setTimeout(() => cb(state), 0); return () => {}; },
  cal: (req: { op: string; day?: number }) => {
    // &day=N shows the day N days from today (the month picker's job in the app)
    const pick = req.op === 'day' ? new Date(req.day!).setHours(0, 0, 0, 0) : day.getTime() + Number(params.get('day') ?? 0) * 86400000;
    const shift = pick - day.getTime();
    const list = (req.op === 'edit' ? events : [...allDay, ...events]).map((e) => ({ ...e, start: e.start + shift, end: e.end + shift }));
    return ok({
    connected: true,
    day: pick,
    events: list,
    calendars: calendars.map((c) => ({ ...c, on: c.on })),
    error: null,
  });
  },
  onCal: () => () => {},
  agents: () => ok({ connected: true, listening: true, error: null, sessions: agentSessions }),
  onAgents: () => () => {},
  onAgentsOpen: () => () => {},
  // &wheel=N shows the space wheel with slice N picked (&wheel=-1: none, &sticky=1: click mode)
  onWheel: (cb: (w: unknown) => void) => {
    const hover = Number(params.get('wheel'));
    const a = -Math.PI / 2 + hover * ((2 * Math.PI) / SPACES.length);
    // The slices in the app's order (src/main/main.ts, WHEEL_ORDER).
    const order = ['claude', 'notion', 'meetings', 'mail', 'focus', 'calendar', 'agents', 'slack'];
    const slots = order.map((id) => SPACES.indexOf(id));
    setTimeout(() => cb({
      open: true, cx: 192, cy: 430, r: 150, spaces: slots.map((i) => ({ ...state.spaces[i], index: i })), active: slots.indexOf(state.active), hover,
      px: hover >= 0 ? Math.round(60 * Math.cos(a)) : 0, py: hover >= 0 ? Math.round(60 * Math.sin(a)) : 0,
      sticky: params.get('sticky') === '1', via: params.get('via') === 'key' ? 'key' : 'mouse',
    }), 300);
    return () => {};
  },
  mail: (req: { op: string; account?: string; id?: string }) => {
    if (req.op.startsWith('cleanup')) return ok(cleanupState());
    switch (req.op) {
      case 'open': return ok(mailDetail(req.account!, req.id!));
      case 'senderCount': return ok(3);
      case 'blocked': return ok([{ account: HOME, email: 'promo@flashbuys.net', filterId: 'f1' }]);
      case 'search': return ok(mailThreads.slice(0, 2));
      default: return ok(mailSnap);
    }
  },
  onMail: () => () => {},
  onCleanup: () => () => {},
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

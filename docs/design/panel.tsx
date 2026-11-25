// One Rail panel (top strip + one space) rendered with fake data.
// ?space=claude|notion|meetings|slack|calendar|agents|focus, plus a few extras:
//   calendar: &edit=1 opens the Edit form
//   meetings: &open=1 opens the first meeting, &live=1 shows a live call
//   focus:    &game=chess shows chess instead of Sudoku, &scroll=N scrolls down
//   wheel:    &wheel=N opens the space wheel with slice N picked (slices clockwise from the top)
//   slack:    &switcher=1 shows the Shift+Space quick switcher, &switcher=2 with a search typed
//   mail:     &sel=N selects the Nth email (its quick buttons show), &open=N opens it, &sheet=reply|block opens that sheet
import { SPACE } from './mock';
import { useEffect, useRef } from 'react';
import { SWITCHER_CSS, SWITCHER_LIGHT, SWITCHER_ICON as IC } from '../../src/preload/slackSwitcher';
import { createRoot } from 'react-dom/client';
import '../../src/renderer/styles.css';
import './panel.css';
import { Strip } from '../../src/renderer/Strip';
import { ClaudeBar, Divider } from '../../src/renderer/Divider';
import { Meetings } from '../../src/renderer/Meetings';
import { Calendar } from '../../src/renderer/Calendar';
import { Focus } from '../../src/renderer/Focus';
import { Wheel } from '../../src/renderer/Wheel';
import { Agents } from '../../src/renderer/Agents';
import { Mail } from '../../src/renderer/Mail';

const q = new URLSearchParams(location.search);

if (SPACE === 'focus') {
  try {
    localStorage.setItem('rail.games.tab', q.get('game') === 'chess' ? 'chess' : 'sudoku');
    localStorage.removeItem('rail.sudoku.v1');
    localStorage.setItem('rail.chess.v1', JSON.stringify({ solved: 41, tried: 52, streak: 6 }));
  } catch { /* ignore */ }
}

function Claude() {
  return (
    <div className="fk claude">
      <div className="fk-top"><span className="fk-ic">☰</span><span style={{ flex: 1 }} /><span className="fk-ic">✎</span></div>
      <div className="claude-hero">
        <div className="claude-mark">✳</div>
        <div className="claude-hi">Morning, Maya</div>
      </div>
      <div className="claude-chat">
        <div className="bubble me">Turn these meeting notes into a short update for the Brightline team.</div>
        <div className="bubble ai">
          <p>Here’s a draft you can send:</p>
          <p><b>Onboarding v2: where we landed</b></p>
          <ul>
            <li>The welcome checklist drops from 7 steps to 4.</li>
            <li>Projects gets a friendlier empty state with one clear action.</li>
            <li>Final copy lands Thursday; we’ll share a build Friday.</li>
          </ul>
        </div>
      </div>
      <div className="claude-input">
        <div className="ph">Reply to Claude…</div>
        <div className="row"><span>＋</span><span style={{ flex: 1 }} /><span className="send">↑</span></div>
      </div>
    </div>
  );
}

function NotionPage() {
  return (
    <div className="fk notion">
      <div className="n-crumbs">Northwind Studio / Projects / <b>Onboarding v2</b></div>
      <div className="n-page">
        <h1>Onboarding v2 — Project brief</h1>
        <div className="n-props">
          <div><span>Status</span><em className="tag green">In progress</em></div>
          <div><span>Owner</span><em>Maya Chen</em></div>
          <div><span>Due</span><em>Friday</em></div>
        </div>
        <div className="n-callout"><span>💡</span><div>Goal: get new teams to their first project in under two minutes.</div></div>
        <h3>Decisions</h3>
        <ul className="n-todo">
          <li className="done">Cut the checklist to four steps</li>
          <li className="done">One action per empty state</li>
          <li>Final copy from Priya (Thu)</li>
          <li>Hand off to eng (Fri)</li>
        </ul>
        <h3>Meeting notes</h3>
        <div className="n-sub">📝 Design review: onboarding v1</div>
        <div className="n-sub">📝 Brightline discovery call</div>
        <div className="n-sub">📄 Copy deck</div>
      </div>
    </div>
  );
}

function Slack() {
  const msgs = [
    { who: 'Theo Alvarez', c: '#2563eb', t: '10:12 AM', m: 'New empty state is up in Figma. One button, one sentence. 👀' },
    { who: 'Priya Natarajan', c: '#16a34a', t: '10:20 AM', m: 'Love it. I’ll match the checklist copy to the same tone.' },
    { who: 'Lena Fischer', c: '#9333ea', t: '10:31 AM', m: 'OOO today, but +1 to shipping the 4-step version.' },
    { who: 'Maya Chen', c: '#ea580c', t: '10:39 AM', m: 'Great. Review at 10:30 tomorrow, I’ll bring the Brightline notes.' },
  ];
  return (
    <div className="fk slack">
      <div className="s-head"><span className="s-back">‹ Chats</span><b># onboarding-v2</b></div>
      <div className="s-msgs">
        {msgs.map((x) => (
          <div key={x.t} className="s-msg">
            <div className="s-av" style={{ background: x.c }}>{x.who[0]}</div>
            <div><div className="s-who"><b>{x.who}</b><span>{x.t}</span></div><div className="s-txt">{x.m}</div></div>
          </div>
        ))}
      </div>
      <div className="s-input">Message #onboarding-v2</div>
    </div>
  );
}

// The Shift+Space quick switcher, drawn with its real styles (it lives in
// Slack's page in Rail, so it isn't a React component).
function Switcher({ mode }: { mode: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host || host.shadowRoot) return;
    const root = host.attachShadow({ mode: 'open' });
    const av = (txt: string, bg: string, fg = '#fff') => `<div class="av" style="background:${bg};color:${fg}">${txt}</div>`;
    const row = (on: boolean, a: string, name: string, sub: string, right: string, bold = false) =>
      `<div class="row ${on ? 'on' : ''}">${a}<div class="txt"><div class="nm ${bold ? 'bold' : ''}">${name}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${right}</div>`;
    const reply = (who: string, val: string) =>
      `<div class="reply"><input class="rin" placeholder="Reply to ${who}…" value="${val}"><button class="send" ${val ? '' : 'disabled'}>Send</button></div>`;
    let body = '';
    let q = '';
    let foot = '<span>↑↓ move</span><span>↵ open</span><span>1–3 jump</span><span>tab reply</span><span>esc close</span>';
    if (mode === '2') {
      q = 'pri';
      body += '<div class="sec">People</div>';
      body += row(true, av('PN', '#16a34a'), '<mark>Pri</mark>ya Natarajan', 'Direct message', '<span class="k">↵</span>');
      body += reply('Priya', '');
      body += row(false, av('PO', '#0891b2'), '<mark>Pri</mark>ce Okafor', 'Direct message', '');
      body += '<div class="sec">Channels</div>';
      body += row(false, '<div class="av ch">#</div>', '<mark>pri</mark>cing-page', '', '');
      body += row(false, '<div class="av ch">🔒</div>', 'q1-<mark>pri</mark>orities', '', '');
      body += `<div class="sec">Messages</div>` + row(false, `<div class="av">${IC.search}</div>`, 'Search Slack for “pri”', '', '<span class="k">⌘↵</span>');
      foot = '<span>↑↓ move</span><span>↵ open</span><span>tab reply</span><span>⌘↵ search</span><span>esc close</span>';
    } else {
      body += '<div class="sec">Recent</div>';
      body += row(true, av('MC', '#ea580c'), 'Maya Chen', 'Can you look at the Brightline deck before 3?', '<span class="badge">2</span>', true);
      body += reply('Maya', 'On it, sending notes by 2:30');
      body += row(false, av('TA', '#2563eb'), 'Theo Alvarez', 'New empty state is up in Figma 👀', '<span class="dot"></span>', true);
      body += row(false, av('LP', '#9333ea'), 'Lena, Priya', 'You: shipping the 4-step version', '<span class="k">3</span>');
      body += `<div class="sec">Quick actions</div><div class="chips">
        <button class="chip">${IC.at}Mentions</button><button class="chip">${IC.unread}Unreads</button>
        <button class="chip">${IC.threads}Threads</button><button class="chip">${IC.compose}New message</button></div>`;
    }
    host.setAttribute('style', SWITCHER_LIGHT);
    root.innerHTML = `<style>${SWITCHER_CSS} .dim{position:absolute;animation:none} .card{animation:none}</style>
      <div class="dim"><div class="card"><div class="q">${IC.search}<input class="qin" placeholder="Jump to a person or channel…" value="${q}"></div>
      <div class="body">${body}</div><div class="foot">${foot}</div></div></div>`;
  }, [mode]);
  return <div ref={ref} className="panel-switcher" />;
}

function Body() {
  useEffect(() => {
    const click = (sel: string, text?: string, delay = 400) => setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => !text || e.textContent?.trim() === text);
      el?.click();
    }, delay);
    if (SPACE === 'calendar' && q.get('edit')) click('.cal-focus .btn', 'Edit', 600);
    if (SPACE === 'calendar' && q.get('month')) click('.cal-daybtn', undefined, 600);
    // &sweep=1 drags out 1:00–2:30 PM on the grid (and holds); &sweep=2 lets go, opening the add form
    if (SPACE === 'calendar' && q.get('sweep')) setTimeout(() => {
      const grid = document.querySelector<HTMLElement>('.cal-grid');
      const sc = document.querySelector<HTMLElement>('.cal-scroll');
      if (!grid || !sc) return;
      sc.scrollTop = 12 * 52 - 120;
      const yAt = (h: number) => grid.getBoundingClientRect().top + h * 52;
      const x = grid.getBoundingClientRect().left + 200;
      grid.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: yAt(13.05) }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: yAt(13.8) }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: yAt(14.45) }));
      if (q.get('sweep') === '2') window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: yAt(14.45) }));
    }, 900);
    if (SPACE === 'meetings' && q.get('open')) click('.mhead', undefined, 500);
    if (SPACE === 'mail') {
      const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
      const n = Number(q.get('open') ?? q.get('sel') ?? 0);
      for (let i = 0; i < n; i++) setTimeout(() => key('j'), 400 + i * 60);
      if (q.get('open')) setTimeout(() => key('Enter'), 500 + n * 60);
      const sheet = q.get('sheet');
      if (sheet) setTimeout(() => key(sheet === 'block' ? 'b' : 'r'), 900 + n * 60);
    }
    if (SPACE === 'focus' && q.get('game') === 'chess') click('button, [role=tab], span, div', 'Chess puzzles', 500);
    const scroll = Number(q.get('scroll') ?? 0);
    if (scroll) setTimeout(() => document.querySelector('.focus, .cal-scroll, .mscroll')?.scrollBy(0, scroll), 900);
  }, []);
  switch (SPACE) {
    case 'claude': return <div className="fk-col"><Claude /><div className="fk-bar"><ClaudeBar /></div></div>;
    case 'notion': return <div className="fk-col"><NotionPage /><div className="fk-bar"><Divider /></div></div>;
    case 'slack': return q.get('switcher') ? <div className="fk-stack"><Slack /><Switcher mode={q.get('switcher')!} /></div> : <Slack />;
    case 'meetings': return <Meetings />;
    case 'focus': return <Focus />;
    case 'agents': return <Agents />;
    case 'mail': return <Mail />;
    default: return <Calendar />;
  }
}

document.body.dataset.view = SPACE;
createRoot(document.getElementById('root')!).render(
  <div className="panel">
    <div className="panel-strip"><Strip /></div>
    <div className="panel-body"><Body /></div>
    {q.get('wheel') !== null && <div className="panel-wheel"><Wheel /></div>}
  </div>,
);

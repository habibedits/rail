// One Rail panel (top strip + one space) rendered with fake data.
// ?space=claude|notion|meetings|slack|calendar|focus, plus a few extras:
//   calendar: &edit=1 opens the Edit form
//   meetings: &open=1 opens the first meeting, &live=1 shows a live call
//   focus:    &game=chess shows chess instead of Sudoku, &scroll=N scrolls down
import { SPACE } from './mock';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/renderer/styles.css';
import './panel.css';
import { Strip } from '../../src/renderer/Strip';
import { Divider } from '../../src/renderer/Divider';
import { Meetings } from '../../src/renderer/Meetings';
import { Calendar } from '../../src/renderer/Calendar';
import { Focus } from '../../src/renderer/Focus';

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
        <div className="n-icon">🧭</div>
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

function Body() {
  useEffect(() => {
    const click = (sel: string, text?: string, delay = 400) => setTimeout(() => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => !text || e.textContent?.trim() === text);
      el?.click();
    }, delay);
    if (SPACE === 'calendar' && q.get('edit')) click('.cal-focus .btn', 'Edit', 600);
    if (SPACE === 'meetings' && q.get('open')) click('.mhead', undefined, 500);
    if (SPACE === 'focus' && q.get('game') === 'chess') click('button, [role=tab], span, div', 'Chess puzzles', 500);
    const scroll = Number(q.get('scroll') ?? 0);
    if (scroll) setTimeout(() => document.querySelector('.focus, .cal-scroll, .mscroll')?.scrollBy(0, scroll), 900);
  }, []);
  switch (SPACE) {
    case 'claude': return <Claude />;
    case 'notion': return <div className="fk-col"><div className="fk-divider"><Divider /></div><NotionPage /></div>;
    case 'slack': return <Slack />;
    case 'meetings': return <Meetings />;
    case 'focus': return <Focus />;
    default: return <Calendar />;
  }
}

document.body.dataset.view = SPACE;
createRoot(document.getElementById('root')!).render(
  <div className="panel">
    <div className="panel-strip"><Strip /></div>
    <div className="panel-body"><Body /></div>
  </div>,
);

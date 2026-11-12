import { useEffect, useMemo, useState } from 'react';
import { Sudoku } from './Sudoku';
import { ChessPuzzle } from './ChessPuzzle';
import type { FocusPhase, FocusReq, FocusSession, FocusSnapshot } from './rail';

// Space 5: a Pomodoro timer, plus a contribution-style grid of finished focus
// sessions (one square per day, darker = more sessions).

const PHASES: { id: FocusPhase; name: string }[] = [
  { id: 'focus', name: 'Focus' },
  { id: 'short', name: 'Short break' },
  { id: 'long', name: 'Long break' },
];

const focus = (req: FocusReq) => window.rail.focus(req);
const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function Focus() {
  const [snap, setSnap] = useState<FocusSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const [label, setLabel] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void focus({ op: 'get' }).then((s) => { setSnap(s); setLabel(s.label); });
    return window.rail.onFocus(setSnap);
  }, []);
  useEffect(() => {
    if (!snap?.running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [snap?.running]);

  const left = snap ? Math.min(snap.duration, snap.running && snap.endAt ? Math.max(0, snap.endAt - now) : snap.remaining) : 0;
  useEffect(() => {
    document.title = snap?.running ? `${clock(left)} · Focus` : 'Focus';
  }, [snap?.running, left]);

  if (!snap) return <div className="focus" />;
  const progress = snap.duration ? 1 - left / snap.duration : 0;
  const R = 92, C = 2 * Math.PI * R;
  const act = (req: FocusReq) => void focus(req).then(setSnap);
  const isBreak = snap.phase !== 'focus';

  return (
    <div className={`focus ${isBreak ? 'brk' : ''}`}>
      <div className="fx-phases" role="tablist">
        {PHASES.map((p) => (
          <button key={p.id} role="tab" aria-selected={snap.phase === p.id} className={snap.phase === p.id ? 'on' : ''}
            onClick={() => snap.phase !== p.id && act({ op: 'phase', phase: p.id })}>{p.name}</button>
        ))}
      </div>

      <div className="fx-ring">
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <circle cx="110" cy="110" r={R} className="track" />
          <circle cx="110" cy="110" r={R} className="bar" strokeDasharray={C} strokeDashoffset={C * (1 - progress)} transform="rotate(-90 110 110)" />
        </svg>
        <div className="fx-time">
          <div className="t">{clock(left)}</div>
          <div className="s">
            {isBreak ? (snap.phase === 'long' ? 'Long break' : 'Break') : `Session ${(snap.round % snap.settings.longEvery) + 1} of ${snap.settings.longEvery}`}
          </div>
        </div>
      </div>

      {!isBreak && (
        <input
          className="fx-label"
          placeholder="What are you focusing on?"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => act({ op: 'label', label })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}

      <div className="fx-controls">
        <button className="btn ghost" onClick={() => act({ op: 'reset' })} title="Restart this timer">Reset</button>
        <button className="btn primary big" onClick={() => act({ op: snap.running ? 'pause' : 'start' })}>
          {snap.running ? 'Pause' : left < snap.duration ? 'Resume' : 'Start'}
        </button>
        <button className="btn ghost" onClick={() => act({ op: 'skip' })} title={isBreak ? 'Skip the break' : 'Skip to a break (not logged)'}>Skip</button>
      </div>

      <History sessions={snap.sessions} />

      <Games />

      <div className="fx-foot">
        <button className="linkbtn muted" onClick={() => setShowSettings(!showSettings)}>{showSettings ? 'Hide timer settings' : 'Timer settings'}</button>
        {showSettings && (
          <div className="fx-settings">
            {([['focus', 'Focus'], ['short', 'Short break'], ['long', 'Long break'], ['longEvery', 'Long break every']] as const).map(([k, name]) => (
              <label key={k}>
                <span>{name}</span>
                <input type="number" min={1} max={180} defaultValue={snap.settings[k]}
                  onBlur={(e) => act({ op: 'settings', settings: { [k]: Number(e.target.value) } })} />
                <em>{k === 'longEvery' ? 'sessions' : 'min'}</em>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const WEEKS = 21;

function History({ sessions }: { sessions: FocusSession[] }) {
  const { cells, months, today, week, streak, total, best } = useMemo(() => {
    const perDay = new Map<string, { n: number; min: number }>();
    for (const s of sessions) {
      const k = dayKey(new Date(s.start));
      const v = perDay.get(k) ?? { n: 0, min: 0 };
      v.n += 1; v.min += s.minutes;
      perDay.set(k, v);
    }
    const end = new Date(); end.setHours(0, 0, 0, 0);
    // Grid ends on this week's Saturday; columns are weeks starting Sunday.
    const first = new Date(end); first.setDate(end.getDate() - end.getDay() - (WEEKS - 1) * 7);
    const cells: { key: string; date: Date; n: number; min: number; future: boolean }[] = [];
    const months: { col: number; name: string }[] = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(first); d.setDate(first.getDate() + i);
      const k = dayKey(d);
      const v = perDay.get(k);
      cells.push({ key: k, date: d, n: v?.n ?? 0, min: v?.min ?? 0, future: d > end });
      if (d.getDate() <= 7 && d.getDay() === 0) months.push({ col: Math.floor(i / 7), name: d.toLocaleDateString('en-US', { month: 'short' }) });
    }
    const todayN = perDay.get(dayKey(end))?.n ?? 0;
    const wk = new Date(end); wk.setDate(end.getDate() - end.getDay());
    let week = 0;
    for (const s of sessions) if (s.start >= wk.getTime()) week += 1;
    // Streak: consecutive days with a session, counting back from today
    // (or from yesterday if today has none yet).
    let streak = 0;
    const d = new Date(end);
    if (!todayN) d.setDate(d.getDate() - 1);
    while (perDay.get(dayKey(d))?.n) { streak += 1; d.setDate(d.getDate() - 1); }
    const best = Math.max(0, ...[...perDay.values()].map((v) => v.n));
    return { cells, months, today: todayN, week, streak, total: sessions.length, best };
  }, [sessions]);

  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4);

  return (
    <div className="fx-hist">
      <div className="fx-stats">
        <div><b>{today}</b><span>today</span></div>
        <div><b>{week}</b><span>this week</span></div>
        <div><b>{streak}</b><span>day streak</span></div>
        <div><b>{total}</b><span>all time</span></div>
      </div>

      <div className="fx-grid-wrap">
        <div className="fx-months" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
          {months.map((m) => <span key={`${m.col}${m.name}`} style={{ gridColumn: m.col + 1 }}>{m.name}</span>)}
        </div>
        <div className="fx-grid-row">
          <div className="fx-days"><span /><span>Mon</span><span /><span>Wed</span><span /><span>Fri</span><span /></div>
          <div className="fx-grid" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
            {cells.map((c) => (
              <i
                key={c.key}
                className={`l${level(c.n)} ${c.future ? 'future' : ''} ${c.key === dayKey(new Date()) ? 'today' : ''}`}
                title={c.future ? '' : `${c.n ? `${c.n} session${c.n > 1 ? 's' : ''} · ${c.min} min` : 'No sessions'} on ${c.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}
              />
            ))}
          </div>
        </div>
        <div className="fx-legend">
          <span>{best ? `Best day: ${best}` : 'Finish a focus session to fill a square'}</span>
          <span className="sc">Less <i className="l0" /><i className="l1" /><i className="l2" /><i className="l3" /><i className="l4" /> More</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Games() {
  const [tab, setTab] = useState<'sudoku' | 'chess'>(() => {
    try { return localStorage.getItem('rail.games.tab') === 'chess' ? 'chess' : 'sudoku'; } catch { return 'sudoku'; }
  });
  const pick = (t: 'sudoku' | 'chess') => { setTab(t); try { localStorage.setItem('rail.games.tab', t); } catch { /* storage unavailable */ } };
  return (
    <div className="games">
      <div className="games-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'sudoku'} className={tab === 'sudoku' ? 'on' : ''} onClick={() => pick('sudoku')}>Sudoku</button>
        <button role="tab" aria-selected={tab === 'chess'} className={tab === 'chess' ? 'on' : ''} onClick={() => pick('chess')}>Chess puzzles</button>
      </div>
      {tab === 'sudoku' ? <Sudoku /> : <ChessPuzzle />}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { agents, type AgentPending, type AgentSession, type AgentsSnapshot, type AgentStep } from './rail';

// Agents space: every Claude Code session on this Mac, each with its own
// little buddy. Click one to follow it step by step, allow what it asks for,
// answer its questions, jump back to its window, or cross it off.

export function Agents() {
  const [snap, setSnap] = useState<AgentsSnapshot | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void agents({ op: 'get' }).then(setSnap).catch((e) => setError(e.message));
    const offSnap = window.rail.onAgents(setSnap);
    const offOpen = window.rail.onAgentsOpen?.((id) => setOpenId(id)) ?? (() => {});
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => { offSnap(); offOpen(); clearInterval(t); };
  }, []);

  const act = (req: Parameters<typeof agents>[0]) => {
    setError(null);
    return agents(req).then(setSnap).catch((e) => setError(e.message));
  };

  if (!snap) return <div className="agents" />;

  if (!snap.connected) {
    return (
      <div className="agents center">
        <div className="empty">
          <div className="ag-hero">
            <Buddy seed="e" status="working" size={46} />
            <Buddy seed="w" status="question" size={46} />
            <Buddy seed="hi" status="idle" size={46} />
          </div>
          <p className="title">See what your agents are doing</p>
          <p className="sub">
            Every Claude Code session gets its own buddy here. Follow each one step by step, allow what it asks for and answer its questions,
            without opening VS Code or the terminal.
          </p>
          <button className="btn primary" style={{ marginTop: 14 }} onClick={() => void act({ op: 'connect' })}>Connect Claude Code</button>
          <p className="sub small" style={{ marginTop: 10 }}>Adds Rail to Claude Code’s hooks in ~/.claude/settings.json. Disconnect any time.</p>
          {(error || snap.error) && <p className="error" style={{ marginTop: 8 }}>{error || snap.error}</p>}
        </div>
      </div>
    );
  }

  const open = openId ? snap.sessions.find((s) => s.id === openId) : null;
  if (open) return <Detail s={open} now={now} act={act} back={() => setOpenId(null)} error={error} />;

  const need = snap.sessions.filter((s) => s.pending);
  const working = snap.sessions.filter((s) => !s.pending && s.status === 'working');
  const done = snap.sessions.filter((s) => !s.pending && s.status !== 'working');
  const row = (s: AgentSession) => <Row key={s.id} s={s} now={now} act={act} open={() => setOpenId(s.id)} />;

  return (
    <div className="agents">
      <div className="mbar">
        <div className="big-title">
          <h1>Agents</h1>
          <span className="spacer" />
          {done.length > 0 && <button className="linkbtn blue" onClick={() => void act({ op: 'clearEnded' })} title="Cross off every agent that’s finished">Clear Done</button>}
        </div>
        <div className="ag-sum">
          {snap.sessions.length === 0 ? 'No agents yet' : [
            need.length ? <b key="n" className="ag-need">{need.length} need{need.length === 1 ? 's' : ''} you</b> : null,
            working.length ? <span key="w">{working.length} working</span> : null,
            done.length ? <span key="d">{done.length} done</span> : null,
          ].filter(Boolean).flatMap((el, i) => (i ? [<span key={`s${i}`} className="ag-dotsep">·</span>, el] : [el]))}
        </div>
      </div>
      {(error || snap.error) && <p className="error pad">{error || snap.error}</p>}
      <div className="mscroll">
        {snap.sessions.length === 0 && (
          <div className="ag-none">
            <Buddy seed="zz" status="idle" size={54} />
            <p className="muted">Start Claude Code in VS Code or a terminal and its buddy shows up here.</p>
          </div>
        )}
        {need.length > 0 && <><div className="sec-h">Needs You</div><div className="group">{need.map(row)}</div></>}
        {working.length > 0 && <><div className="sec-h">Working</div><div className="group">{working.map(row)}</div></>}
        {done.length > 0 && <><div className="sec-h">Done</div><div className="group">{done.map(row)}</div></>}
        <div className="ag-foot">
          <span className="ag-conn"><i />Connected to Claude Code</span>
          <button className="linkbtn muted" onClick={() => void act({ op: 'disconnect' })}>Disconnect</button>
        </div>
      </div>
    </div>
  );
}

// One session in the list. A permission request can be answered right here.
function Row({ s, now, act, open }: { s: AgentSession; now: number; act: (req: Parameters<typeof agents>[0]) => Promise<unknown>; open: () => void }) {
  const [busy, setBusy] = useState(false);
  const p = s.pending;
  const go = (choice: 'allow' | 'always' | 'deny') => { setBusy(true); void act({ op: 'decide', id: s.id, pendingId: p!.id, choice }).finally(() => setBusy(false)); };
  const sub = p ? (p.kind === 'question' ? `${s.host} · has a question` : `${s.host} · ${p.title}`)
    : s.status === 'working' ? s.activity : `${s.activity} · ${ago(s.updatedAt, now)}`;
  return (
    <div className={`ag-item ${s.status} ${p ? 'need' : ''}`}>
      <button className="ag-row" onClick={open} title={s.title || s.project}>
        <span className={`ag-av ${s.status === 'working' && !p ? 'ring' : ''}`}><Buddy seed={s.id} status={s.status} size={38} /></span>
        <span className="ag-txt">
          <b>{s.project}</b>
          <small>{sub}</small>
        </span>
        {p ? (p.kind === 'question' ? <span className="pill orange">Answer</span> : <span className="need-dot">!</span>)
          : s.status === 'working' ? <span className="ag-host">{s.host}</span>
          : <span className="ag-check" aria-label="Done">✓</span>}
      </button>
      {p?.kind === 'permission' && (
        <div className="ag-inline">
          {p.detail && <pre className="ag-code">{p.detail}</pre>}
          <div className="ag-btns">
            <button className="btn" disabled={busy} onClick={() => go('deny')}>Don’t Allow</button>
            {p.canAlways && <button className="btn" disabled={busy} onClick={() => go('always')} title="Allow, and don’t ask again for this in this project">Always Allow</button>}
            <button className="btn primary" disabled={busy} onClick={() => go('allow')}>Allow Once</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Detail({ s, now, act, back, error }: {
  s: AgentSession;
  now: number;
  act: (req: Parameters<typeof agents>[0]) => Promise<unknown>;
  back: () => void;
  error: string | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [s.steps.length, s.pending?.id]);

  return (
    <div className="agents">
      <div className="ag-nav">
        <button className="pill-btn back" onClick={back} title="All agents">‹ Agents</button>
        <span className="spacer" />
        <button className="pill-btn" onClick={() => void act({ op: 'jump', id: s.id })} title={`Bring back ${s.host} on ${s.cwd}`}>Open in {s.host}</button>
        <button className="round" aria-label="Cross off this session" onClick={() => { void act({ op: 'dismiss', id: s.id }); back(); }} title="Cross off this session">✕</button>
      </div>
      <div className="ag-dhead">
        <Buddy seed={s.id} status={s.status} size={44} />
        <div className="ag-dtitle">
          <b>{s.project}</b>
          <span className={s.pending ? 'need' : ''}>{statusWord(s)} · {s.host}</span>
        </div>
      </div>
      {error && <p className="error pad">{error}</p>}
      <div
        className="mscroll ag-steps"
        ref={scroller}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}
      >
        {s.steps.length === 0 && <p className="muted pad">Nothing yet. Steps show up here as Claude works.</p>}
        {s.steps.map((st) => <Step key={st.id} st={st} />)}
        {s.status === 'working' && !s.pending && <div className="ag-thinking"><span /><span /><span /></div>}
      </div>
      {s.pending && <Ask key={s.pending.id} s={s} p={s.pending} act={act} />}
      <div className="ag-when-foot">Started {ago(s.startedAt, now)} · {s.cwd.replace(/^\/Users\/[^/]+/, '~')}</div>
    </div>
  );
}

function Step({ st }: { st: AgentStep }) {
  const [open, setOpen] = useState(false);
  const icon = st.kind === 'prompt' ? '›' : st.kind === 'reply' ? '✳' : st.kind === 'note' ? '·'
    : st.state === 'waiting' ? '!' : st.state === 'error' || st.state === 'denied' ? '✕' : '✓';
  return (
    <div className={`ag-step ${st.kind} ${st.state ?? ''}`}>
      <span className="ag-ic">{st.state === 'running' && st.kind === 'tool' ? <span className="ag-spin" /> : icon}</span>
      <div className="ag-sbody">
        <button className="ag-stitle" onClick={() => st.detail && setOpen(!open)} disabled={!st.detail}>
          {st.state === 'denied' ? `Denied: ${st.title}` : st.title}
          {st.state === 'waiting' && <em className="ag-wait"> waiting for you</em>}
          {st.detail && <span className={`chev ${open ? 'open' : ''}`}> ›</span>}
        </button>
        {open && st.detail && <pre className="ag-code">{st.detail}</pre>}
      </div>
    </div>
  );
}

// The card at the bottom when the agent is waiting on you.
function Ask({ s, p, act }: { s: AgentSession; p: AgentPending; act: (req: Parameters<typeof agents>[0]) => Promise<unknown> }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const go = (req: Parameters<typeof agents>[0]) => { setBusy(true); void act(req).finally(() => setBusy(false)); };

  if (p.kind === 'question') {
    const qs = p.questions ?? [];
    const answerOf = (q: string) => other[q]?.trim() || (picked[q] ?? []).join(', ');
    const ready = qs.every((q) => answerOf(q.question));
    const toggle = (q: string, label: string, multi: boolean) => {
      setOther((o) => ({ ...o, [q]: '' }));
      setPicked((cur) => {
        const was = cur[q] ?? [];
        return { ...cur, [q]: multi ? (was.includes(label) ? was.filter((x) => x !== label) : [...was, label]) : [label] };
      });
    };
    return (
      <div className="ag-ask q">
        <div className="ag-grab" /><div className="ag-ask-h"><span className="ag-pill">Question</span><span className="muted">Claude is waiting for your answer</span></div>
        {qs.map((q) => (
          <div key={q.question} className="ag-q">
            {q.header && <span className="ag-qh">{q.header}</span>}
            <p className="ag-qt">{q.question}</p>
            <div className="ag-opts">
              {q.options.map((o) => (
                <button key={o.label} className={`ag-opt ${(picked[q.question] ?? []).includes(o.label) ? 'on' : ''}`} onClick={() => toggle(q.question, o.label, q.multiSelect)}>
                  <b>{o.label}</b>{o.description && <span>{o.description}</span>}
                </button>
              ))}
              <input
                className="search ag-other"
                placeholder="Or type your own answer…"
                value={other[q.question] ?? ''}
                onChange={(e) => { const v = e.target.value; setOther((o) => ({ ...o, [q.question]: v })); if (v) setPicked((c) => ({ ...c, [q.question]: [] })); }}
              />
            </div>
          </div>
        ))}
        <div className="ag-btns">
          <button className="btn primary" disabled={!ready || busy} onClick={() => go({ op: 'answer', id: s.id, pendingId: p.id, answers: Object.fromEntries(qs.map((q) => [q.question, answerOf(q.question)])) })}>Send Answer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="ag-ask">
      <div className="ag-grab" /><div className="ag-ask-h"><span className="ag-pill">Permission</span><span className="muted">{p.tool === 'Bash' ? 'Wants to run a command' : `Wants to use ${p.tool}`}</span></div>
      <p className="ag-qt">{p.title}</p>
      {p.detail && <pre className="ag-code big">{p.detail}</pre>}
      <div className="ag-btns">
        <button className="btn" disabled={busy} onClick={() => go({ op: 'decide', id: s.id, pendingId: p.id, choice: 'deny' })}>Don’t Allow</button>
        {p.canAlways && <button className="btn" disabled={busy} onClick={() => go({ op: 'decide', id: s.id, pendingId: p.id, choice: 'always' })} title="Allow, and don’t ask again for this in this project">Always Allow</button>}
        <button className="btn primary" disabled={busy} onClick={() => go({ op: 'decide', id: s.id, pendingId: p.id, choice: 'allow' })}>Allow Once</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function statusWord(s: AgentSession) {
  if (s.pending) return s.pending.kind === 'question' ? 'Has a question' : 'Needs permission';
  return s.status === 'working' ? 'Working' : s.status === 'ended' ? 'Closed' : 'Done';
}

function ago(t: number, now: number) {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

// ---- The buddy --------------------------------------------------------------
// A small round creature drawn from the session id: same session, same buddy.

const COLORS = ['#e8875b', '#5b9be8', '#5bbf8a', '#b07be8', '#e8c35b', '#e86b8f', '#4fb8c2', '#8f9be8'];
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

export function Buddy({ seed, status, size = 48 }: { seed: string; status: AgentSession['status']; size?: number }) {
  const look = useMemo(() => {
    const h = hash(seed);
    return { color: COLORS[h % COLORS.length], top: (h >>> 4) % 4, cheeks: ((h >>> 7) & 1) === 1, wide: (h >>> 9) % 3 };
  }, [seed]);
  const need = status === 'permission' || status === 'question';
  const sleepy = status === 'idle';
  const gone = status === 'ended';
  const body = gone ? '#b9b9bd' : look.color;
  const ex = look.wide === 0 ? 7 : look.wide === 1 ? 8 : 9;
  return (
    <span className={`buddy ${status}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
        <ellipse cx="24" cy="44.5" rx="12" ry="2" className="b-shadow" />
        <g className="b-body">
          {look.top === 1 && <><path d="M24 9 V4" stroke={body} strokeWidth="2" strokeLinecap="round" /><circle cx="24" cy="3.5" r="2.4" fill={body} /></>}
          {look.top === 2 && <><path d="M13 14 L11 5 L19 10 Z" fill={body} /><path d="M35 14 L37 5 L29 10 Z" fill={body} /></>}
          {look.top === 3 && <path d="M18 9.5 Q24 3 30 9.5" stroke={body} strokeWidth="3" fill="none" strokeLinecap="round" />}
          <rect x="7" y="9" width="34" height="33" rx="15" fill={body} />
          <rect x="7" y="9" width="34" height="33" rx="15" fill="url(#b-shine)" />
          <ellipse cx="17" cy="42" rx="4" ry="2.2" fill={body} className="b-foot" />
          <ellipse cx="31" cy="42" rx="4" ry="2.2" fill={body} className="b-foot" />
          {gone ? (
            <><path d={`M${24 - ex - 3} 24 h6`} className="b-line" /><path d={`M${24 + ex - 3} 24 h6`} className="b-line" /></>
          ) : sleepy ? (
            <><path d={`M${24 - ex - 3} 24 q3 2.5 6 0`} className="b-line" /><path d={`M${24 + ex - 3} 24 q3 2.5 6 0`} className="b-line" /></>
          ) : (
            <g className="b-eyes">
              <ellipse cx={24 - ex} cy="24" rx="3.6" ry={need ? 4.6 : 4.1} fill="#fff" />
              <ellipse cx={24 + ex} cy="24" rx="3.6" ry={need ? 4.6 : 4.1} fill="#fff" />
              <circle cx={24 - ex + 0.6} cy="24.6" r="2" className="b-pupil" />
              <circle cx={24 + ex + 0.6} cy="24.6" r="2" className="b-pupil" />
            </g>
          )}
          {look.cheeks && !gone && <><circle cx={24 - ex - 3} cy="30.5" r="2" fill="#fff" opacity=".28" /><circle cx={24 + ex + 3} cy="30.5" r="2" fill="#fff" opacity=".28" /></>}
          {need ? <ellipse cx="24" cy="33" rx="2.3" ry="2.6" className="b-mouth" />
            : <path d={sleepy || gone ? 'M21.5 33 h5' : 'M20.5 32 q3.5 3.2 7 0'} className="b-line" />}
        </g>
        <defs>
          <linearGradient id="b-shine" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".22" />
            <stop offset=".6" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      {need && <span className="b-bubble">{status === 'question' ? '?' : '!'}</span>}
      {sleepy && <span className="b-z">z</span>}
    </span>
  );
}

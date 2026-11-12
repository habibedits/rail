import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveMeeting, ff, Meeting, MeetingDetail, useRailState } from './rail';
import { Caret, Reload } from './icons';

// Space 2: Fireflies meetings (PRD §6.3).

const REFRESH_MS = 5 * 60 * 1000;

function fmtWhen(ms: number) {
  return new Date(ms).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fmtStamp(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function Meetings() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [editingKey, setEditingKey] = useState(false);

  useEffect(() => {
    ff<{ hasKey: boolean }>({ op: 'status' }).then((r) => setHasKey(r.hasKey));
  }, []);

  if (hasKey === null) return <div className="meetings" />;
  if (!hasKey || editingKey) {
    return (
      <KeyForm
        canCancel={hasKey}
        onCancel={() => setEditingKey(false)}
        onSaved={() => { setHasKey(true); setEditingKey(false); }}
        onCleared={() => { setHasKey(false); setEditingKey(false); }}
      />
    );
  }
  return <MeetingList onAuthError={() => setHasKey(false)} onEditKey={() => setEditingKey(true)} />;
}

// ---------------------------------------------------------------------------

function KeyForm(props: { canCancel: boolean; onSaved: () => void; onCancel: () => void; onCleared: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setBusy(true);
    setError('');
    try {
      await ff({ op: 'setKey', key });
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="meetings">
      <form className="keyform" onSubmit={save}>
        <p className="title">Connect Fireflies</p>
        <p className="sub">
          Paste your API key from Fireflies → Integrations → Fireflies API. It's stored encrypted in your Keychain.
        </p>
        <input
          type="password"
          placeholder="Fireflies API key"
          value={key}
          autoFocus
          onChange={(e) => setKey(e.target.value)}
        />
        {error && <p className="error">{error}</p>}
        <div className="row">
          {props.canCancel && (
            <>
              <button type="button" className="btn ghost" onClick={async () => { await ff({ op: 'clearKey' }); props.onCleared(); }}>
                Remove key
              </button>
              <button type="button" className="btn ghost" onClick={props.onCancel}>Cancel</button>
            </>
          )}
          <button type="submit" className="btn" disabled={busy || !key.trim()}>{busy ? 'Checking…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MeetingList(props: { onAuthError: () => void; onEditKey: () => void }) {
  const rail = useRailState();
  const visible = rail ? rail.spaces[rail.active]?.id === 'meetings' : false;
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Meeting[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const lastLoad = useRef(0);
  const reqId = useRef(0);
  const onAuthError = useRef(props.onAuthError);
  onAuthError.current = props.onAuthError;

  const load = useCallback(async (q: string) => {
    const mine = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const list = await ff<Meeting[]>({ op: 'list', search: q });
      if (mine !== reqId.current) return;
      setItems(list);
      lastLoad.current = Date.now();
    } catch (err) {
      if (mine !== reqId.current) return;
      if ((err as { auth?: boolean }).auth) return onAuthError.current();
      setError((err as Error).message);
    } finally {
      if (mine === reqId.current) setLoading(false);
    }
  }, []);

  // Search as you type (debounced).
  useEffect(() => {
    const t = setTimeout(() => load(query), query ? 400 : 0);
    return () => clearTimeout(t);
  }, [query, load]);

  // Refresh every 5 minutes while this space is on screen.
  useEffect(() => {
    if (!visible) return;
    if (Date.now() - lastLoad.current > REFRESH_MS) load(query);
    const t = setInterval(() => load(query), REFRESH_MS);
    return () => clearInterval(t);
  }, [visible, query, load]);

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? '' : t)), 2200);
  };

  return (
    <div className="meetings list">
      <div className="mbar">
        <input
          className="search"
          type="search"
          placeholder="Search meetings"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="icon" title="Refresh" disabled={loading} onClick={() => load(query)}>
          <span className={loading ? 'spin' : ''}><Reload /></span>
        </button>
        <button className="icon" title="Fireflies API key" onClick={props.onEditKey}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="5.5" cy="10.5" r="3" /><path d="M7.7 8.3 13.5 2.5M11 5l1.8 1.8M12.5 3.5l1 1" /></svg>
        </button>
      </div>

      <div className="mscroll">
        <LiveCards visible={visible} say={say} />
        {error && <p className="error pad">{error}</p>}
        {items && items.length === 0 && !loading && (
          <p className="muted pad">{query ? 'No meetings match.' : 'No meetings yet.'}</p>
        )}
        {items?.map((m) => (
          <MeetingRow
            key={m.id}
            m={m}
            open={openId === m.id}
            onToggle={() => setOpenId(openId === m.id ? null : m.id)}
            say={say}
          />
        ))}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MeetingRow(props: { m: Meeting; open: boolean; onToggle: () => void; say: (s: string) => void }) {
  const { m, open } = props;
  const people = m.participants?.length ?? 0;

  return (
    <div className={`mrow ${open ? 'open' : ''}`}>
      <button className="mhead" onClick={props.onToggle}>
        <span className="mtitle">{m.title}</span>
        <span className="mmeta">
          {fmtWhen(m.date)} · {Math.round(m.duration)} min{people ? ` · ${people} people` : ''}
        </span>
      </button>
      {open && <Detail id={m.id} say={props.say} />}
    </div>
  );
}

function Detail({ id, say }: { id: string; say: (s: string) => void }) {
  const [d, setD] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [audioUrl, setAudioUrl] = useState<string | null | undefined>(undefined);
  const [showTranscript, setShowTranscript] = useState(false);
  const [focusT, setFocusT] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [t, setT] = useState(0);
  const blockRefs = useRef<(HTMLParagraphElement | null)[]>([]);

  useEffect(() => {
    ff<MeetingDetail>({ op: 'detail', id }).then(setD, (e) => setError((e as Error).message));
    ff<{ url: string | null }>({ op: 'audio', id }).then((r) => setAudioUrl(r.url), () => setAudioUrl(null));
  }, [id]);

  // Consecutive sentences from the same speaker read as one block.
  const blocks = useMemo(() => {
    const out: { speaker: string; start: number; text: string[] }[] = [];
    for (const s of d?.sentences ?? []) {
      const speaker = s.speaker_name || 'Speaker';
      const last = out[out.length - 1];
      if (last && last.speaker === speaker) last.text.push(s.text);
      else out.push({ speaker, start: s.start_time, text: [s.text] });
    }
    return out;
  }, [d]);

  const overview = useMemo(() => parseOverview(d?.summary?.overview), [d]);
  const actions = useMemo(() => parseActions(d?.summary?.action_items), [d]);

  // The transcript block playing (or last jumped to).
  const at = t > 0 ? t : focusT;
  let current = -1;
  if (at != null) for (let i = 0; i < blocks.length && blocks[i].start <= at + 0.5; i++) current = i;

  // With audio: play from there and stay put. Without: show that spot in the transcript.
  const jump = (sec: number, reveal = !audio.current) => {
    setFocusT(sec);
    const a = audio.current;
    if (a) {
      a.currentTime = sec;
      a.play().catch(() => {});
    }
    if (!reveal) return;
    setShowTranscript(true);
    requestAnimationFrame(() => {
      let i = -1;
      for (let j = 0; j < blocks.length && blocks[j].start <= sec + 0.5; j++) i = j;
      blockRefs.current[Math.max(0, i)]?.scrollIntoView({ block: 'center' });
    });
  };

  const act = async (label: string, run: () => Promise<{ done: string | null; what?: string }>, ok: (r: { done: string; what?: string }) => string) => {
    setBusy(label);
    try {
      const r = await run();
      if (r.done) say(ok(r as { done: string; what?: string }));
    } catch (e) {
      say((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  if (error) return <p className="error pad">{error}</p>;
  if (!d) return <p className="muted pad">Loading…</p>;

  return (
    <div className="detail">
      <div className="dbar">
        <button
          className="btn small primary"
          disabled={!!busy}
          onClick={() => act('claude', () => ff({ op: 'claude', id }), (r) => (r.done === 'pasted' ? 'Sent to Claude' : 'Copied — ⌘V to paste in Claude'))}
        >
          {busy === 'claude' ? '…' : 'Send to Claude'}
        </button>
        <button
          className="btn small"
          disabled={!!busy}
          onClick={() => act('menu', () => ff({ op: 'menu', id }), (r) =>
            r.done === 'copied' ? `${r.what === 'link' ? 'Link' : r.what === 'summary' ? 'Summary' : 'Transcript'} copied`
              : r.done === 'saved' ? 'Saved to Documents/Rail/Meetings'
                : 'Opened in Fireflies')}
        >
          More <Caret />
        </button>
      </div>

      {audioUrl && (
        <Player
          url={audioUrl}
          audio={audio}
          fallbackDuration={d.duration * 60}
          onTime={setT}
        />
      )}
      {audioUrl === null && <p className="muted small">No audio from Fireflies for this meeting. Timestamps jump to the transcript.</p>}

      {!!overview.length && (
        <section>
          <h4>Overview</h4>
          <ul className="ov">
            {overview.map((o, i) => (
              <li key={i}>
                {o.label && <span className="ov-k">{o.label}</span>}
                <span className="ov-v">{o.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!actions.length && (
        <section>
          <h4>Action items · {actions.reduce((n, g) => n + g.items.length, 0)}</h4>
          {actions.map((g, i) => (
            <div key={i} className="ai-group">
              {g.who && <p className="ai-who">{g.who} <span className="count">{g.items.length}</span></p>}
              {g.items.map((it, j) => (
                <div key={j} className="ai-row">
                  <span className="ai-text">{it.text}</span>
                  {it.sec != null && (
                    <button className="tchip" title="Play from here" onClick={() => jump(it.sec!)}>{fmtStamp(it.sec)}</button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </section>
      )}

      {!!d.summary?.keywords?.length && (
        <div className="kw">{d.summary.keywords.map((k) => <span key={k}>{k}</span>)}</div>
      )}

      {!!blocks.length && (
        <section>
          <button className="tx-toggle" onClick={() => setShowTranscript(!showTranscript)}>
            <span className={`chev ${showTranscript ? 'open' : ''}`}>▸</span> Transcript · {d.sentences?.length.toLocaleString()} lines
          </button>
          {showTranscript && (
            <div className="transcript">
              {blocks.map((b, i) => (
                <p key={i} ref={(el) => { blockRefs.current[i] = el; }} className={i === current ? 'now' : ''}>
                  <span className="who">{b.speaker}</span>{' '}
                  <button className="tchip" title="Play from here" onClick={() => jump(b.start)}>{fmtStamp(b.start)}</button>
                  <br />
                  {b.text.join(' ')}
                </p>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Sticky audio bar: play/pause, scrubber, time, speed.
const RATES = [1, 1.25, 1.5, 2];

function Player(props: {
  url: string;
  audio: React.RefObject<HTMLAudioElement | null>;
  fallbackDuration: number;
  onTime: (t: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(props.fallbackDuration);
  const [rate, setRate] = useState(1);
  const [failed, setFailed] = useState(false);
  const a = props.audio;

  const toggle = () => {
    const el = a.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => setFailed(true));
    else el.pause();
  };
  const skip = (d: number) => {
    const el = a.current;
    if (el) el.currentTime = Math.max(0, Math.min(dur, el.currentTime + d));
  };

  if (failed) return <p className="muted small">The audio link didn’t load (it may have expired). Close and reopen the meeting to refresh it.</p>;

  return (
    <div className="player">
      <audio
        ref={a}
        src={props.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => isFinite(e.currentTarget.duration) && setDur(e.currentTarget.duration)}
        onTimeUpdate={(e) => { setT(e.currentTarget.currentTime); props.onTime(e.currentTarget.currentTime); }}
        onError={() => setFailed(true)}
      />
      <button className="icon play" title={playing ? 'Pause' : 'Play'} onClick={toggle}>
        {playing
          ? <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="2" y="1.5" width="3" height="9" rx="0.8" /><rect x="7" y="1.5" width="3" height="9" rx="0.8" /></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 1.6v8.8c0 .5.5.8.9.5l6.6-4.4a.6.6 0 0 0 0-1L3.9 1.1c-.4-.3-.9 0-.9.5Z" /></svg>}
      </button>
      <button className="icon skip" title="Back 15s" onClick={() => skip(-15)}>−15</button>
      <span className="ptime">{fmtStamp(t)}</span>
      <input
        className="scrub"
        type="range"
        min={0}
        max={dur || 1}
        step={1}
        value={t}
        style={{ ['--p' as string]: `${(t / (dur || 1)) * 100}%` }}
        onChange={(e) => { if (a.current) a.current.currentTime = Number(e.target.value); setT(Number(e.target.value)); }}
      />
      <span className="ptime">{fmtStamp(dur)}</span>
      <button
        className="icon rate"
        title="Playback speed"
        onClick={() => {
          const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
          setRate(next);
          if (a.current) a.current.playbackRate = next;
        }}
      >
        {rate}×
      </button>
    </div>
  );
}

// "- **Priorities:** text\n- **Social:** text" → label/text bullets.
// Fireflies sometimes runs the bullets together on one line.
function parseOverview(text: string | null | undefined) {
  if (!text) return [];
  return text
    .split(/\n+|\s+-\s+(?=\*\*)/)
    .map((l) => l.trim().replace(/^[-•*]\s+/, ''))
    .filter(Boolean)
    .map((l) => {
      const m = /^\*\*(.+?):?\*\*:?\s*(.*)$/.exec(l);
      return m ? { label: m[1].replace(/:$/, ''), text: m[2].replace(/\*\*/g, '') } : { label: '', text: l.replace(/\*\*/g, '') };
    });
}

// Action items: **Name** headings, then "Task (mm:ss)" lines.
function parseActions(text: string | null | undefined) {
  if (!text) return [];
  const groups: { who: string; items: { text: string; sec: number | null }[] }[] = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    const heading = /^\*\*(.+)\*\*$/.exec(l);
    if (heading) { groups.push({ who: heading[1], items: [] }); continue; }
    if (!groups.length) groups.push({ who: '', items: [] });
    const ts = /\s*\((\d{1,2}(?::\d{2}){1,2})\)\s*$/.exec(l);
    const sec = ts ? ts[1].split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0) : null;
    groups[groups.length - 1].items.push({ text: (ts ? l.slice(0, ts.index) : l).replace(/\*\*/g, '').replace(/^[-•*]\s+/, ''), sec });
  }
  return groups.filter((g) => g.items.length);
}

// ---------------------------------------------------------------------------
// Live: meetings Fireflies is recording right now, with the transcript so far.

const ACTIVE_POLL_MS = 30_000;
const LIVE_POLL_MS = 5_000;

function LiveCards({ visible, say }: { visible: boolean; say: (s: string) => void }) {
  const [active, setActive] = useState<ActiveMeeting[]>([]);

  useEffect(() => {
    if (!visible) return;
    let stop = false;
    const poll = () => ff<ActiveMeeting[]>({ op: 'active' }).then((a) => !stop && setActive(a), () => {});
    poll();
    const t = setInterval(poll, ACTIVE_POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [visible]);

  if (!active.length) return null;
  return <>{active.map((m) => <LiveCard key={m.id} m={m} visible={visible} say={say} />)}</>;
}

function LiveCard({ m, visible, say }: { m: ActiveMeeting; visible: boolean; say: (s: string) => void }) {
  const [open, setOpen] = useState(true);
  const [sentences, setSentences] = useState<MeetingDetail['sentences']>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Transcript so far, refreshed while the card is open and on screen.
  useEffect(() => {
    if (!open || !visible) return;
    let stop = false;
    const poll = () => ff<{ sentences: MeetingDetail['sentences'] }>({ op: 'live', id: m.id })
      .then((r) => !stop && setSentences(r.sentences), () => {});
    poll();
    const t = setInterval(poll, LIVE_POLL_MS);
    return () => { stop = true; clearInterval(t); };
  }, [open, visible, m.id]);

  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [visible]);

  // Follow new lines unless you've scrolled up to read.
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [sentences]);

  const blocks = useMemo(() => {
    const out: { speaker: string; start: number; text: string[] }[] = [];
    for (const s of sentences ?? []) {
      const speaker = s.speaker_name || 'Speaker';
      const last = out[out.length - 1];
      if (last && last.speaker === speaker) last.text.push(s.text);
      else out.push({ speaker, start: s.start_time, text: [s.text] });
    }
    return out;
  }, [sentences]);

  const started = m.start_time ? Date.parse(m.start_time) : NaN;
  const elapsed = isFinite(started) && now > started ? fmtStamp((now - started) / 1000) : '';

  const act = async (label: string, run: () => Promise<{ done: string }>, ok: (d: string) => string) => {
    setBusy(label);
    try { say(ok((await run()).done)); } catch (e) { say((e as Error).message); } finally { setBusy(''); }
  };

  return (
    <div className="live">
      <button className="live-head" onClick={() => setOpen(!open)}>
        <span className="live-dot" />
        <span className="live-tag">Live</span>
        <span className="live-title">{m.title || 'Meeting'}</span>
        {elapsed && <span className="live-time">{elapsed}</span>}
      </button>
      {open && (
        <>
          <div className="dbar">
            <button className="btn small primary" disabled={!!busy}
              onClick={() => act('claude', () => ff({ op: 'liveClaude', id: m.id, title: m.title }), (d) => (d === 'pasted' ? 'Sent to Claude' : 'Copied — ⌘V to paste in Claude'))}>
              {busy === 'claude' ? '…' : 'Send to Claude'}
            </button>
            <button className="btn small" disabled={!!busy}
              onClick={() => act('copy', () => ff({ op: 'liveCopy', id: m.id, title: m.title }), () => 'Transcript so far copied')}>
              Copy so far
            </button>
            {m.meeting_link?.startsWith('https://') && (
              <button className="btn small ghost" onClick={() => ff({ op: 'openUrl', url: m.meeting_link! })}>Join</button>
            )}
          </div>
          <div
            className="live-tx"
            ref={box}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
          >
            {blocks.length ? blocks.map((b, i) => (
              <p key={i}>
                <span className="who">{b.speaker}</span> <span className="ts">{fmtStamp(b.start)}</span>
                <br />
                {b.text.join(' ')}
              </p>
            )) : (
              <p className="muted">Listening… lines show up here as Fireflies transcribes them.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

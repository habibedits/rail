import { useEffect, useMemo, useRef, useState } from 'react';
import { cal, CalEvent, CalReq, CalSnapshot, useRailState } from './rail';
import { Reload } from './icons';

// Space 4: today only, one time zone (this Mac's), every calendar connected in
// Notion Calendar (PRD §6.6). Drag an event to move it; + adds one.

const HOUR_PX = 52;
const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtHour = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' });

function zoneLabel() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  const off = new Intl.DateTimeFormat('en-US', { timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
  return `${off ?? ''} ${city}`.trim();
}

function until(ms: number, now: number) {
  const m = Math.max(0, Math.round((ms - now) / 60000));
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return `in ${h}h${r ? ` ${r}m` : ''}`;
}

const PALETTE = ['#3b82f6', '#c2703d', '#22a06b', '#d6455d', '#8b5cf6', '#0e9aa7', '#d4a017', '#db2777', '#64748b', '#65a30d'];

export function Calendar() {
  const [snap, setSnap] = useState<CalSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const run = async (label: string, req: Parameters<typeof cal>[0]) => {
    setBusy(label);
    setError('');
    try {
      setSnap(await cal(req));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  useEffect(() => {
    void run('load', { op: 'get' });
    return window.rail.onCal(setSnap);
  }, []);

  if (!snap) return <div className="cal" />;
  if (!snap.connected) {
    return (
      <div className="cal setup">
        <p className="title">Connect Notion Calendar</p>
        <p className="sub">
          Rail shows today from every account you’ve added to Notion Calendar. Notion asks you to approve Rail once, in your browser.
        </p>
        {snap.error && <p className="error">{snap.error.message}</p>}
        {error && <p className="error">{error}</p>}
        {busy === 'connect' && <p className="sub">Approve Rail in your browser…</p>}
        <div className="row">
          <button className="btn primary" disabled={busy === 'connect'} onClick={() => run('connect', { op: 'connect' })}>Connect</button>
        </div>
      </div>
    );
  }
  return <Today snap={snap} busy={busy} error={error} run={run} />;
}

// ---------------------------------------------------------------------------

type Run = (label: string, req: CalReq) => Promise<void>;
const SNAP = 15 * 60000;

function Today({ snap, busy, error, run }: { snap: CalSnapshot; busy: string; error: string; run: Run }) {
  const rail = useRailState();
  const visible = rail ? rail.spaces[rail.active]?.id === 'calendar' : true;
  const [now, setNow] = useState(Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 5000); return () => clearTimeout(t); }, [note]);
  const [picker, setPicker] = useState(false);
  const [adding, setAdding] = useState<number | null>(null); // start time of the new event
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (visible) setNow(Date.now()); }, [visible]);

  const color = useMemo(() => {
    const m = new Map<string, string>();
    snap.calendars.forEach((c, i) => m.set(c.key, PALETTE[i % PALETTE.length]));
    return m;
  }, [snap.calendars]);

  const { events } = snap;
  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  const live = timed.filter((e) => e.response !== 'declined');
  const current = live.find((e) => e.start <= now && now < e.end);
  const next = live.find((e) => e.start > now);
  const focus = (selected && timed.find((e) => e.id === selected)) || current || next || null;

  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const startHour = 0, endHour = 24; // midnight to midnight
  const y = (ms: number) => ((ms - dayStart.getTime()) / 3600000 - startHour) * HOUR_PX;
  const timeAt = (px: number) => dayStart.getTime() + (px / HOUR_PX + startHour) * 3600000;
  const snapMs = (ms: number) => Math.round(ms / SNAP) * SNAP;

  const placed = useMemo(() => layoutColumns(timed), [timed]);

  useEffect(() => {
    if (scrolled.current || !scroller.current) return;
    scrolled.current = true;
    const target = now > dayStart.getTime() + startHour * 3600000 ? y(now) : timed[0] ? y(timed[0].start) : 0;
    scroller.current.scrollTop = Math.max(0, target - 90);
  });

  // Drag an event up or down to move it, in 15-minute steps.
  const startDrag = (e: CalEvent, down: React.PointerEvent) => {
    if (down.button !== 0) return;
    const y0 = down.clientY;
    let moved = false;
    const onMove = (m: PointerEvent) => {
      const dy = m.clientY - y0;
      if (!moved && Math.abs(dy) < 5) return;
      moved = true;
      if (e.canMove) setDrag({ id: e.id, dy });
    };
    const onUp = (u: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDrag(null);
      if (!moved) { setSelected(selected === e.id ? null : e.id); return; }
      if (!e.canMove) return;
      const shift = snapMs(((u.clientY - y0) / HOUR_PX) * 3600000);
      if (!shift) return;
      const start = e.start + shift, end = e.end + shift;
      const guests = e.people > 1 ? '\n\nGuests will be notified.' : '';
      if (!window.confirm(`Move “${e.title}” to ${fmtTime(start)} – ${fmtTime(end)}?${guests}`)) return;
      setSelected(e.id);
      void run('move', { op: 'move', id: e.id, title: e.title, start, end });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const day = new Date(now).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const onCount = snap.calendars.filter((c) => c.on).length;
  const nextSlot = () => Math.ceil(now / (30 * 60000)) * 30 * 60000;

  return (
    <div className="cal">
      <div className="cal-head">
        <div>
          <div className="cal-day">{day}</div>
          <div className="cal-tz">{zoneLabel()}</div>
        </div>
        <div className="spacer" />
        <button className={`cal-pick ${picker ? 'open' : ''}`} onClick={() => setPicker(!picker)} title="Choose calendars">
          <span className="dots3">{snap.calendars.filter((c) => c.on).slice(0, 4).map((c) => <i key={c.key} style={{ background: color.get(c.key) }} />)}</span>
          {onCount} of {snap.calendars.length} ▾
        </button>
        <button className="icon" title="Add event" onClick={() => setAdding(adding ? null : nextSlot())}><span className="plus">+</span></button>
        <button className="icon" title="Refresh" disabled={!!busy} onClick={() => run('refresh', { op: 'refresh' })}>
          <span className={busy && busy !== 'load' ? 'spin' : ''}><Reload /></span>
        </button>
        {picker && <Picker snap={snap} color={color} run={run} onClose={() => setPicker(false)} />}
      </div>

      {adding !== null && <AddForm snap={snap} start={adding} run={run} onClose={() => setAdding(null)} />}

      {error && <p className="error pad">{error}</p>}
      {note && <div className="cal-warn">{note}</div>}
      {snap.error && (
        <div className="cal-warn">
          {snap.error.message}{' '}
          {snap.error.needsSignIn && <button className="linkbtn" onClick={() => run('connect', { op: 'connect' })}>Reconnect</button>}
        </div>
      )}

      {focus ? (
        <div className={`cal-focus ${focus === current ? 'live' : ''}`} style={{ ['--c' as string]: color.get(focus.calendar) }}>
          <div className="cal-when">
            {focus === current ? <><span className="live-dot" /> Now · ends {until(focus.end, now)}</>
              : focus.start > now ? `Up next · ${until(focus.start, now)}`
                : 'Earlier today'}
          </div>
          {editing === focus.id ? (
            <EditForm e={focus} run={run} onClose={() => setEditing(null)} onMoved={(msg) => { setEditing(null); setNote(msg); }} />
          ) : (<>
          <div className="cal-title">{focus.title}</div>
          <div className="cal-meta">
            {fmtTime(focus.start)} – {fmtTime(focus.end)}
            {focus.people > 1 ? ` · ${focus.people} people` : ''}
            {focus.response === 'needsAction' ? ' · not answered' : focus.response === 'tentative' ? ' · maybe' : ''}
          </div>
          {focus.location && <div className="cal-loc" title={focus.location}>{focus.location}</div>}
          {focus.description && <Description key={focus.id} text={focus.description} />}
          {focus.canRsvp && (
            <div className="rsvp">
              <span>Going?</span>
              {(['accepted', 'declined', 'tentative'] as const).map((r) => (
                <button
                  key={r}
                  className={focus.response === r ? 'on' : ''}
                  disabled={busy === 'rsvp'}
                  onClick={() => run('rsvp', { op: 'rsvp', id: focus.id, title: focus.title, response: r })}
                >
                  {r === 'accepted' ? 'Yes' : r === 'declined' ? 'No' : 'Maybe'}
                </button>
              ))}
            </div>
          )}
          <div className="dbar wrap">
            {focus.joinUrl ? (
              <>
                <button className="btn small primary" disabled={busy === 'notes'} title="Join the call and start Notion transcription in its meeting note"
                  onClick={() => run('notes', { op: 'notes', id: focus.id, join: true, transcribe: true })}>Join &amp; transcribe</button>
                <button className="btn small" onClick={() => void cal({ op: 'open', url: focus.joinUrl! })}>Join</button>
              </>
            ) : (
              <button className="btn small primary" disabled={busy === 'notes'} title="Open the meeting note and start Notion transcription"
                onClick={() => run('notes', { op: 'notes', id: focus.id, transcribe: true })}>Transcribe</button>
            )}
            <button className="btn small" disabled={busy === 'notes'} title="Open this event's Notion meeting note (makes one if there isn't one yet)" onClick={() => run('notes', { op: 'notes', id: focus.id })}>
              {busy === 'notes' ? 'Opening…' : 'Notes'}
            </button>
            {focus.canMove && <button className="btn small" title="Change the name, date or time" onClick={() => setEditing(focus.id)}>Edit</button>}
            {focus.webUrl && <button className="btn small ghost" onClick={() => void cal({ op: 'open', url: focus.webUrl! })}>Notion Cal ↗</button>}
            {selected && <button className="btn small ghost" onClick={() => setSelected(null)}>Close</button>}
          </div>
          </>)}
        </div>
      ) : (
        <div className="cal-focus"><div className="cal-when">{timed.length ? 'No more meetings today' : 'Nothing on the calendar today'}</div></div>
      )}

      {allDay.length > 0 && (
        <div className="cal-allday">
          {allDay.map((e) => (
            <span key={e.id} className="chip" style={{ borderLeftColor: color.get(e.calendar) }}>{e.title}</span>
          ))}
        </div>
      )}

      <div className="cal-scroll" ref={scroller}>
        <div
          className="cal-grid"
          style={{ height: (endHour - startHour) * HOUR_PX }}
          onDoubleClick={(ev) => {
            if ((ev.target as Element).closest('.cal-ev')) return;
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
            setAdding(Math.floor(timeAt(ev.clientY - r.top) / (30 * 60000)) * 30 * 60000);
          }}
        >
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <div key={i} className="cal-hour" style={{ top: i * HOUR_PX }}>
              <span>{fmtHour(startHour + i)}</span>
            </div>
          ))}
          {placed.map(({ e, col, cols }) => {
            const dragging = drag?.id === e.id;
            const shift = dragging ? snapMs((drag!.dy / HOUR_PX) * 3600000) : 0;
            const top = y(e.start + shift);
            const h = Math.max(18, y(e.end) - y(e.start) - 2);
            return (
              <button
                key={e.id}
                className={`cal-ev ${e.end <= now ? 'past' : ''} ${focus?.id === e.id ? 'sel' : ''} ${e.canMove ? 'movable' : ''} ${dragging ? 'dragging' : ''}`}
                style={{
                  top,
                  height: h,
                  left: dragging ? 48 : `calc(48px + (100% - 54px) * ${col / cols})`,
                  width: dragging ? 'calc(100% - 54px)' : `calc((100% - 54px) / ${cols} - 3px)`,
                  ['--ev' as string]: color.get(e.calendar),
                }}
                title={e.canMove ? 'Click for details · drag to move' : e.title}
                onPointerDown={(down) => startDrag(e, down)}
              >
                <span className="t">{e.title}</span>
                {h >= 34 && <span className="m">{fmtTime(e.start + shift)} – {fmtTime(e.end + shift)}</span>}
              </button>
            );
          })}
          {now >= dayStart.getTime() + startHour * 3600000 && now < dayStart.getTime() + endHour * 3600000 && (
            <div className="cal-now" style={{ top: y(now) }} />
          )}
        </div>
        <div className="cal-foot">
          <span className="muted small">Double-click an empty slot to add an event</span>
          <button className="linkbtn muted" onClick={() => run('disconnect', { op: 'disconnect' })}>Disconnect Notion Calendar</button>
        </div>
      </div>
    </div>
  );
}

// Dropdown of every calendar, grouped by account, with on/off checkboxes.
function Picker({ snap, color, run, onClose }: { snap: CalSnapshot; color: Map<string, string>; run: Run; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('.cal-pick')) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [onClose]);

  const accounts = [...new Set([...snap.calendars].sort((a, b) => Number(b.work) - Number(a.work)).map((c) => c.account))];
  return (
    <div className="cal-menu" ref={ref}>
      {accounts.map((a) => (
        <div key={a} className="grp">
          <div className="acct-h">{a}</div>
          {snap.calendars
            .filter((c) => c.account === a)
            .sort((x, y) => Number(y.primary) - Number(x.primary) || x.name.localeCompare(y.name))
            .map((c) => (
              <label key={c.key} className="row" style={{ ['--c' as string]: color.get(c.key) }}>
                <input type="checkbox" checked={c.on} onChange={() => void run('toggle', { op: 'toggle', key: c.key })} />
                <span className="box" />
                <span className="nm">{c.primary ? 'Main calendar' : c.name}</span>
                {c.count > 0 && <span className="ct">{c.count}</span>}
              </label>
            ))}
        </div>
      ))}
    </div>
  );
}

const toInput = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function AddForm({ snap, start, run, onClose }: { snap: CalSnapshot; start: number; run: Run; onClose: () => void }) {
  const writable = snap.calendars.filter((c) => c.writable);
  let last = '';
  try { last = localStorage.getItem('rail.cal.lastAdd') ?? ''; } catch { /* storage unavailable */ }
  const preferred = writable.find((c) => c.key === last) ?? writable.find((c) => c.work && c.primary) ?? writable.find((c) => c.on && c.primary) ?? writable.find((c) => c.on) ?? writable[0];
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(toInput(start));
  const [mins, setMins] = useState(30);
  const [calKey, setCalKey] = useState(preferred?.key ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setTime(toInput(start)), [start]);

  const submit = async () => {
    if (!calKey) return;
    const [h, m] = time.split(':').map(Number);
    const s = new Date(start); s.setHours(h, m, 0, 0);
    try { localStorage.setItem('rail.cal.lastAdd', calKey); } catch { /* storage unavailable */ }
    setSaving(true);
    await run('add', { op: 'add', calendar: calKey, title, start: s.getTime(), end: s.getTime() + mins * 60000 });
    setSaving(false);
    onClose();
  };

  return (
    <form className="cal-add" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input autoFocus placeholder="Event name" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} />
      <div className="r">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <select value={mins} onChange={(e) => setMins(Number(e.target.value))}>
          {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr`}</option>)}
        </select>
      </div>
      <select value={calKey} onChange={(e) => setCalKey(e.target.value)}>
        {[...new Set([...writable].sort((a, b) => Number(b.work) - Number(a.work)).map((c) => c.account))].map((a) => (
          <optgroup key={a} label={a}>
            {writable.filter((c) => c.account === a).map((c) => <option key={c.key} value={c.key}>{c.primary ? a : c.name}</option>)}
          </optgroup>
        ))}
      </select>
      <div className="r end">
        <button type="button" className="btn small ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn small primary" disabled={saving || !calKey}>{saving ? 'Adding…' : 'Add to calendar'}</button>
      </div>
    </form>
  );
}

// Side-by-side columns for overlapping meetings.
function layoutColumns(events: CalEvent[]) {
  const out: { e: CalEvent; col: number; cols: number }[] = [];
  let group: { e: CalEvent; col: number }[] = [];
  let groupEnd = 0;
  const flush = () => {
    const cols = Math.max(1, ...group.map((g) => g.col + 1));
    group.forEach((g) => out.push({ ...g, cols }));
    group = [];
  };
  for (const e of [...events].sort((a, b) => a.start - b.start || b.end - a.end)) {
    if (group.length && e.start >= groupEnd) flush();
    const used = new Set(group.filter((g) => g.e.end > e.start).map((g) => g.col));
    let col = 0;
    while (used.has(col)) col++;
    group.push({ e, col });
    groupEnd = Math.max(groupEnd, e.end);
  }
  flush();
  return out;
}


// An event's description: plain text with clickable links (they open in your
// browser). Long ones start folded so the day grid stays in view.
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220 || text.split('\n').length > 4;
  const parts = text.split(/(https?:\/\/[^\s<>()"]+)/g);
  return (
    <div className={`cal-desc ${long && !open ? 'folded' : ''}`}>
      <div className="txt">
        {parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer">{p.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}{p.length > 56 ? '…' : ''}</a> : p))}
      </div>
      {long && <button className="linkbtn muted" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show more'}</button>}
    </div>
  );
}

const toDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const at = (date: string, time: string) => { const [y, mo, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); return new Date(y, mo - 1, d, h, mi).getTime(); };

// Edit an event's name, date and time from its card.
function EditForm({ e, run, onClose, onMoved }: { e: CalEvent; run: Run; onClose: () => void; onMoved: (msg: string) => void }) {
  const [title, setTitle] = useState(e.title);
  const [date, setDate] = useState(toDate(e.start));
  const [from, setFrom] = useState(toInput(e.start));
  const [to, setTo] = useState(toInput(e.end));
  const [saving, setSaving] = useState(false);

  const start = date && from ? at(date, from) : NaN;
  let end = date && to ? at(date, to) : NaN;
  if (isFinite(start) && isFinite(end) && end <= start) end += 86400000; // ends after midnight
  const changed = title.trim() !== e.title || start !== e.start || end !== e.end;
  const valid = !!title.trim() && isFinite(start) && isFinite(end);

  const save = async () => {
    if (!valid || !changed) { onClose(); return; }
    const guests = e.people > 1 && (start !== e.start || end !== e.end) ? '\n\nGuests will be notified.' : '';
    if (guests && !window.confirm(`Move “${e.title}” to ${new Date(start).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(start)} – ${fmtTime(end)}?${guests}`)) return;
    setSaving(true);
    await run('edit', { op: 'edit', id: e.id, title: title.trim(), start, end });
    setSaving(false);
    const otherDay = toDate(start) !== toDate(Date.now());
    if (otherDay) onMoved(`Moved “${title.trim()}” to ${new Date(start).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`);
    else onClose();
  };

  return (
    <form className="cal-add cal-edit" onSubmit={(ev) => { ev.preventDefault(); void save(); }} onKeyDown={(ev) => ev.key === 'Escape' && onClose()}>
      <input autoFocus value={title} onChange={(ev) => setTitle(ev.target.value)} placeholder="Event name" />
      <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
      <div className="r">
        <input type="time" value={from} onChange={(ev) => {
          // Keep the length the same when the start changes.
          const len = isFinite(start) && isFinite(end) ? end - start : e.end - e.start;
          setFrom(ev.target.value);
          if (date && ev.target.value) setTo(toInput(at(date, ev.target.value) + len));
        }} />
        <input type="time" value={to} onChange={(ev) => setTo(ev.target.value)} />
      </div>
      <div className="r end">
        <button type="button" className="btn small ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn small primary" disabled={saving || !valid}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

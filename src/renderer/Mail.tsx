import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CleanupAction, CleanupItem, CleanupState, mail, MailAccount, MailBlocked, MailDetail, MailMessage, MailSnapshot, MailThread, MailUndo, useRailState } from './rail';
import { Back, MailIcon, Reload } from './icons';

// The Mail space: every Gmail account in one feed, newest first. The chips
// under the search bar focus on one account. Every conversation has the same
// four actions: Reply, Archive, Delete (to Trash, with Undo) and Block.
// Silent: new mail only changes the count on the Mail tab.

const COLORS = ['var(--blue)', 'var(--orange)', 'var(--purple)', 'var(--green)', 'var(--indigo)', 'var(--red)'];
const QUICK = ['Thanks!', 'Sounds good 👍', 'I’ll get back to you tomorrow.'];

type Sheet =
  | { kind: 'reply'; t: MailThread }
  | { kind: 'block'; t: MailThread }
  | { kind: 'compose' }
  | { kind: 'accounts' };

interface Toast { msg: string; undo?: MailUndo; id: number }

/** A short name for an account: the part before @ for Gmail, the company for Workspace. */
function shortName(email: string) {
  const [local, domain = ''] = email.split('@');
  if (/^(gmail|googlemail)\.com$/.test(domain)) return local;
  const d = domain.split('.')[0];
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function initials(name: string) {
  const words = name.replace(/["'()]/g, '').split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return '?';
  return ((words[0][0] ?? '') + (words[1]?.[0] ?? words[0][1] ?? '')).toUpperCase();
}

const DAY = 24 * 3600 * 1000;
const midnight = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function when(ms: number) {
  const today = midnight();
  if (ms >= today) return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (ms >= today - DAY) return 'Yesterday';
  if (ms >= today - 6 * DAY) return new Date(ms).toLocaleDateString('en-US', { weekday: 'short' });
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', d.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

function fullWhen(ms: number) {
  return new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function group(ms: number) {
  const today = midnight();
  if (ms >= today) return 'Today';
  if (ms >= today - DAY) return 'Yesterday';
  if (ms >= today - 6 * DAY) return 'Earlier this week';
  return 'Older';
}

export function Mail() {
  const [snap, setSnap] = useState<MailSnapshot | null>(null);
  useEffect(() => {
    const off = window.rail?.onMail(setSnap);
    mail({ op: 'get' }).then(setSnap).catch(() => {});
    return off;
  }, []);

  if (!snap) return <div className="mail" />;
  if (!snap.hasClient) return <ClientSetup onDone={setSnap} />;
  if (!snap.accounts.length) return <FirstAccount builtIn={snap.builtIn} onDone={setSnap} onBack={async () => setSnap(await mail({ op: 'clearClient' }))} />;
  return <Inbox snap={snap} setSnap={setSnap} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function ClientSetup({ onDone }: { onDone: (s: MailSnapshot) => void }) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isJson = id.trim().startsWith('{');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onDone(await mail({ op: 'setClient', id, secret }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mail setup" onSubmit={save}>
      <p className="title">Set up Mail</p>
      <p className="sub">Google only lets apps read Gmail through an OAuth client you own. You make it once, in a few minutes. It costs nothing.</p>
      <ol className="steps">
        <li>In <button type="button" className="linkbtn blue" onClick={() => mail({ op: 'openUrl', url: 'https://console.cloud.google.com/projectcreate' })}>Google Cloud</button>, create a project.</li>
        <li>Turn on the <button type="button" className="linkbtn blue" onClick={() => mail({ op: 'openUrl', url: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com' })}>Gmail API</button>.</li>
        <li>Set up the <b>OAuth consent screen</b> (External), add your addresses as test users, then click <b>Publish app</b> so sign-ins don’t expire after 7 days.</li>
        <li>Under <b>Credentials</b>, create an <b>OAuth client ID</b> of type <b>Desktop app</b>.</li>
        <li>Paste its ID and secret here, or the whole JSON file it offers to download.</li>
      </ol>
      <input className="field" placeholder="Client ID, or the client JSON" value={id} onChange={(e) => setId(e.target.value)} autoFocus spellCheck={false} />
      {!isJson && <input className="field" type="password" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} />}
      {error && <p className="error">{error}</p>}
      <p className="muted small">Both are stored encrypted in your Keychain. Your mail goes only between this Mac and Google.</p>
      <div className="row">
        <button type="submit" className="btn primary" disabled={busy || !id.trim() || (!isJson && !secret.trim())}>{busy ? 'Saving…' : 'Continue'}</button>
      </div>
    </form>
  );
}

function FirstAccount({ builtIn, onDone, onBack }: { builtIn: boolean; onDone: (s: MailSnapshot) => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      onDone(await mail({ op: 'connect' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mail setup center">
      <div className="ml-hero"><MailIcon id="compose" size={22} /></div>
      <p className="title">Sign in to Gmail</p>
      <p className="sub">Google’s sign-in opens in your browser. Add as many accounts as you like; they all land in one feed.</p>
      {error && <p className="error">{error}</p>}
      <button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Waiting for Google…' : 'Sign in with Google'}</button>
      {!builtIn && <button className="linkbtn muted" onClick={onBack}>Use a different OAuth client</button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function Inbox({ snap, setSnap }: { snap: MailSnapshot; setSnap: (s: MailSnapshot) => void }) {
  const rail = useRailState();
  const visible = rail ? rail.spaces[rail.active]?.id === 'mail' : true;
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [results, setResults] = useState<MailThread[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set()); // removed here, before the next check confirms
  const [leaving, setLeaving] = useState<Set<string>>(new Set()); // sliding out
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = useCallback(() => { setOpenKey(null); setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 30); }, []);
  const closeSearch = useCallback(() => { setQuery(''); setSearchOpen(false); }, []);
  const feedRef = useRef<HTMLDivElement>(null);
  // Inbox clean-up with Claude: its state lives in the main process, so it
  // keeps running (and stays ready) while you're elsewhere.
  const [cleanOpen, setCleanOpen] = useState(false);
  const [clean, setClean] = useState<CleanupState | null>(null);
  useEffect(() => {
    mail<CleanupState>({ op: 'cleanupGet' }).then(setClean).catch(() => {});
    return window.rail?.onCleanup?.(setClean);
  }, []);

  const accounts = snap.accounts;
  const color = useCallback((email: string) => COLORS[Math.max(0, accounts.findIndex((a) => a.email === email)) % COLORS.length], [accounts]);
  const shownAccounts = accounts.filter((a) => a.on);
  useEffect(() => { if (filter !== 'all' && !shownAccounts.some((a) => a.email === filter)) setFilter('all'); }, [shownAccounts, filter]);

  // Refresh when you come back to the space after a while.
  useEffect(() => {
    if (visible && Date.now() - snap.updatedAt > 30_000) mail({ op: 'refresh' }).then(setSnap).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Search all mail as you type.
  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(() => {
      mail<MailThread[]>({ op: 'search', q }).then((r) => { if (searchRef.current?.value.trim() === q) setResults(r); }).catch(() => setResults([])).finally(() => setSearching(false));
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  const list = useMemo(() => {
    const src = results ?? snap.threads;
    return src.filter((t) => !gone.has(t.key) && (filter === 'all' || t.account === filter) && shownAccounts.some((a) => a.email === t.account));
  }, [results, snap.threads, gone, filter, shownAccounts]);

  // The next check from Gmail is the truth: forget local removals it confirms.
  useEffect(() => {
    setGone((g) => {
      if (!g.size) return g;
      const live = new Set(snap.threads.map((t) => t.key));
      const next = new Set([...g].filter((k) => live.has(k)));
      return next.size === g.size ? g : next;
    });
  }, [snap.threads]);

  const byKey = useCallback((key: string | null) => (key ? list.find((t) => t.key === key) ?? snap.threads.find((t) => t.key === key) ?? results?.find((t) => t.key === key) ?? null : null), [list, snap.threads, results]);
  const openThread = byKey(openKey);

  const showToast = useCallback((msg: string, undo?: MailUndo) => setToast({ msg, undo, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const neighbor = useCallback((keys: string[]) => {
    const i = list.findIndex((t) => keys.includes(t.key));
    const rest = list.filter((t) => !keys.includes(t.key));
    return rest[Math.min(Math.max(i, 0), rest.length - 1)]?.key ?? null;
  }, [list]);

  // Take conversations out of the list (slide out, then hide) and move on.
  const remove = useCallback((keys: string[]) => {
    const next = neighbor(keys);
    setLeaving((s) => new Set([...s, ...keys]));
    setTimeout(() => {
      setGone((g) => new Set([...g, ...keys]));
      setLeaving((s) => { const n = new Set(s); keys.forEach((k) => n.delete(k)); return n; });
    }, 180);
    setSel(next);
    setOpenKey((o) => (o && keys.includes(o) ? next : o));
    setResults((r) => (r ? r.filter((t) => !keys.includes(t.key)) : r));
  }, [neighbor]);

  const restore = useCallback((keys: string[]) => setGone((g) => { const n = new Set(g); keys.forEach((k) => n.delete(k)); return n; }), []);

  const act = useCallback(async (kind: 'reply' | 'archive' | 'trash' | 'block', t: MailThread) => {
    if (kind === 'reply' || kind === 'block') { setSheet({ kind, t }); return; }
    remove([t.key]);
    try {
      const undo = await mail<MailUndo>({ op: kind, account: t.account, id: t.id });
      showToast(kind === 'archive' ? 'Archived' : 'Moved to Trash', undo);
    } catch (err) {
      restore([t.key]);
      showToast((err as Error).message);
    }
  }, [remove, restore, showToast]);

  const undo = async () => {
    if (!toast?.undo) return;
    const u = toast.undo;
    setToast(null);
    restore(u.ids.map((id) => `${u.account} ${id}`));
    try {
      await mail({ op: 'undo', undo: u });
      showToast('Undone');
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  // Keyboard: J/K move, Enter opens, Esc goes back; R E D B act; 1–9 pick an account; / searches; C writes.
  useEffect(() => {
    if (cleanOpen) return; // the clean-up screen has no single-key shortcuts
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement as HTMLElement | null)?.tagName ?? '');
      if (sheet) { if (e.key === 'Escape') { e.preventDefault(); setSheet(null); } return; }
      if (typing) {
        if (e.key === 'Escape') {
          if (document.activeElement === searchRef.current && !query) closeSearch();
          else (document.activeElement as HTMLElement).blur();
        }
        return;
      }
      const k = e.key.toLowerCase();
      const cur = openKey ?? sel;
      const i = list.findIndex((t) => t.key === cur);
      if (k === 'j' || e.key === 'ArrowDown' || k === 'k' || e.key === 'ArrowUp') {
        if (!list.length) return;
        e.preventDefault();
        const d = k === 'j' || e.key === 'ArrowDown' ? 1 : -1;
        const n = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + d))];
        setSel(n.key);
        if (openKey) setOpenKey(n.key);
      } else if (e.key === 'Enter' && sel && !openKey) { e.preventDefault(); setOpenKey(sel); }
      else if (e.key === 'Escape' && openKey) { e.preventDefault(); setOpenKey(null); }
      else if (e.key === 'Escape' && searchOpen) { e.preventDefault(); closeSearch(); }
      else if (k === '/') { e.preventDefault(); openSearch(); }
      else if (k === 'c') { e.preventDefault(); setSheet({ kind: 'compose' }); }
      else if (/^[1-9]$/.test(k)) {
        const f = k === '1' ? 'all' : shownAccounts[Number(k) - 2]?.email;
        if (f) { setFilter(f); setOpenKey(null); }
      } else {
        const map: Record<string, 'reply' | 'archive' | 'trash' | 'block'> = { r: 'reply', e: 'archive', d: 'trash', backspace: 'trash', delete: 'trash', b: 'block' };
        const t = byKey(cur);
        if (map[k] && t) { e.preventDefault(); void act(map[k], t); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, openKey, sel, list, shownAccounts, byKey, act, query, searchOpen, openSearch, closeSearch, cleanOpen]);

  useLayoutEffect(() => {
    if (!openKey && sel) feedRef.current?.querySelector('.ml-row.sel')?.scrollIntoView({ block: 'nearest' });
  }, [sel, openKey]);

  const totalUnread = shownAccounts.reduce((n, a) => n + a.unread, 0);
  const problems = accounts.filter((a) => a.error);

  // Group the feed by day.
  const groups: { name: string; items: MailThread[] }[] = [];
  for (const t of list) {
    const g = group(t.date);
    if (groups[groups.length - 1]?.name !== g) groups.push({ name: g, items: [] });
    groups[groups.length - 1].items.push(t);
  }

  if (cleanOpen && clean) return <div className="mail"><Cleanup st={clean} set={setClean} onClose={() => setCleanOpen(false)} /></div>;

  const cleanBusy = clean && ['scanning', 'thinking', 'applying'].includes(clean.phase);
  return (
    <div className="mail">
      <div className={`ml-screen ${openThread ? 'reading' : ''}`}>
        <div className="ml-view ml-list">
          <div className="big-title">
            <h1>Mail</h1>
            <div className="spacer" />
            <button className="round" title="Check for new mail" aria-label="Check for new mail" onClick={() => mail({ op: 'refresh' }).then(setSnap).catch((e) => showToast(e.message))}>
              <span className={snap.loading ? 'spin' : ''}><Reload /></span>
            </button>
            <button className={`round ${searchOpen ? 'active' : ''}`} title="Search all mail  /" aria-label="Search all mail" aria-pressed={searchOpen} onClick={() => (searchOpen ? closeSearch() : openSearch())}><MailIcon id="search" size={15} /></button>
            <button className="round" title="New email  C" aria-label="New email" onClick={() => setSheet({ kind: 'compose' })}><MailIcon id="compose" size={15} /></button>
            <button className={`round ${cleanBusy || clean?.phase === 'ready' ? 'active' : ''}`} title="Clean up your inbox with Claude" aria-label="Clean up with Claude" onClick={() => setCleanOpen(true)}><MailIcon id="sparkle" size={15} /></button>
            <button className="round" title="Accounts and blocked senders" aria-label="Accounts" onClick={() => setSheet({ kind: 'accounts' })}><MailIcon id="person" size={15} /></button>
          </div>
          {clean && (cleanBusy || clean.phase === 'ready') && (
            <button className="cl-banner" onClick={() => setCleanOpen(true)}>
              <span className={`cl-spark ${cleanBusy ? 'busy' : ''}`}><MailIcon id="sparkle" size={14} /></span>
              <span className="cl-btxt">{clean.phase === 'ready' ? `Clean-up ready: ${clean.items.filter((x) => x.action !== 'keep').length} senders to clear out` : clean.phase === 'thinking' ? 'Claude is reviewing your senders…' : clean.phase === 'applying' ? 'Cleaning up your inbox…' : 'Looking through your inbox…'}</span>
              <span className="cl-go">{clean.phase === 'ready' ? 'Review' : ''}</span>
            </button>
          )}
          {searchOpen && (
            <label className="searchbar ml-search">
              <MailIcon id="search" size={14} />
              <input ref={searchRef} className="search" placeholder="Search all mail" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
              <button className="ml-clear" aria-label="Close search" onClick={closeSearch}>×</button>
            </label>
          )}
          {shownAccounts.length > 1 && (
            <div className="ml-chips" role="tablist">
              <button className={`ml-chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
                All {totalUnread > 0 && <span className="n">{totalUnread}</span>}
              </button>
              {shownAccounts.map((a) => (
                <button key={a.email} className={`ml-chip ${filter === a.email ? 'on' : ''}`} style={{ ['--c' as string]: color(a.email) }} title={a.email} onClick={() => setFilter(a.email)}>
                  <span className="dot" />{shortName(a.email)} {a.unread > 0 && <span className="n">{a.unread}</span>}
                </button>
              ))}
            </div>
          )}
          {problems.map((a) => (
            <div key={a.email} className="ml-warn">
              <span><b>{a.email}</b>: {a.error}</span>
              {a.needsSignIn && <button className="linkbtn blue" onClick={() => mail({ op: 'connect' }).then(setSnap).catch((e) => showToast(e.message))}>Sign in again</button>}
            </div>
          ))}

          <div className="ml-feed" ref={feedRef}>
            {results && <div className="sec-h">{searching ? 'Searching…' : `${list.length} result${list.length === 1 ? '' : 's'} in all mail`}</div>}
            {!list.length ? (
              <div className="ml-empty">
                {(snap.loading && !snap.updatedAt) || searching ? <p className="muted">Loading…</p> : (
                  <>
                    <div className="ok"><MailIcon id="check" size={22} /></div>
                    <p className="t">{query ? 'No matches' : 'All clear'}</p>
                    <p className="muted">{query ? `Nothing in your mail matches “${query}”.` : filter === 'all' ? 'Every inbox is empty.' : `Nothing left in ${filter}.`}</p>
                  </>
                )}
              </div>
            ) : groups.map((g) => (
              <div key={g.name}>
                {!results && <div className="sec-h">{g.name}</div>}
                <div className="group">
                  {g.items.map((t) => (
                    <Row
                      key={t.key}
                      t={t}
                      color={color(t.account)}
                      account={shownAccounts.length > 1 ? shortName(t.account) : null}
                      sel={sel === t.key}
                      leaving={leaving.has(t.key)}
                      onOpen={() => { setSel(t.key); setOpenKey(t.key); }}
                      onAct={(k) => { setSel(t.key); void act(k, t); }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="ml-view ml-reader">
          {openThread && (
            <Reader
              key={openThread.key}
              t={openThread}
              color={color(openThread.account)}
              position={`${list.findIndex((x) => x.key === openThread.key) + 1} of ${list.length}`}
              onBack={() => setOpenKey(null)}
              onAct={(k) => void act(k, openThread)}
            />
          )}
        </div>
      </div>

      {sheet && (
        <>
          <div className="ml-scrim" onClick={() => setSheet(null)} />
          <div className="ml-sheet" role="dialog">
            {sheet.kind === 'reply' && (
              <ReplySheet t={sheet.t} color={color(sheet.t.account)} onClose={() => setSheet(null)} onSent={() => { setSheet(null); showToast(`Sent from ${sheet.t.account}`); }} />
            )}
            {sheet.kind === 'block' && (
              <BlockSheet
                t={sheet.t}
                onClose={() => setSheet(null)}
                onBlocked={(keys, undo, note) => { setSheet(null); if (keys.length) remove(keys); showToast(note, undo); }}
                onError={(m) => showToast(m)}
              />
            )}
            {sheet.kind === 'compose' && (
              <ComposeSheet accounts={shownAccounts.length ? shownAccounts : accounts} start={filter !== 'all' ? filter : null} color={color} onClose={() => setSheet(null)} onSent={(from) => { setSheet(null); showToast(`Sent from ${from}`); }} />
            )}
            {sheet.kind === 'accounts' && (
              <AccountsSheet accounts={accounts} builtIn={snap.builtIn} color={color} setSnap={setSnap} onClose={() => setSheet(null)} onToast={showToast} />
            )}
          </div>
        </>
      )}

      {toast && (
        <div className={`ml-toast ${sheet ? 'top' : openThread ? 'up' : ''}`} key={toast.id}>
          <span>{toast.msg}</span>
          {toast.undo && <button onClick={undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function Row(props: { t: MailThread; color: string; account: string | null; sel: boolean; leaving: boolean; onOpen: () => void; onAct: (k: 'reply' | 'archive' | 'trash' | 'block') => void }) {
  const { t } = props;
  const btn = (k: 'reply' | 'archive' | 'trash' | 'block', icon: 'reply' | 'archive' | 'trash' | 'block', label: string) => (
    <button className={`ml-qb ${k}`} title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); props.onAct(k); }}>
      <MailIcon id={icon} size={15} />
    </button>
  );
  return (
    <div className={`ml-row ${t.unread ? 'unread' : ''} ${props.sel ? 'sel' : ''} ${props.leaving ? 'leaving' : ''}`} onClick={props.onOpen} role="button" tabIndex={-1}>
      <div className="ml-av">
        {initials(t.from)}
        <span className="ad" style={{ ['--c' as string]: props.color }} title={t.account} />
      </div>
      <div className="ml-rb">
        <div className="ml-r1">
          <span className="from">{t.from}{t.count > 1 && <span className="cnt">{t.count}</span>}</span>
          <span className="time">{when(t.date)}</span>
        </div>
        <div className="subj">{t.subject}</div>
        <div className="prev">{props.account && <span className="acct">{props.account} · </span>}{t.snippet}</div>
      </div>
      <div className="ml-qa">
        {btn('reply', 'reply', 'Reply')}
        {btn('archive', 'archive', 'Archive')}
        {btn('trash', 'trash', 'Delete')}
        {btn('block', 'block', 'Block sender')}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function Reader(props: { t: MailThread; color: string; position: string; onBack: () => void; onAct: (k: 'reply' | 'archive' | 'trash' | 'block') => void }) {
  const { t } = props;
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    mail<MailDetail>({ op: 'open', account: t.account, id: t.id })
      .then((d) => { if (live) setDetail(d); })
      .catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [t.account, t.id]);

  const msgs = detail?.messages ?? [];
  const last = msgs[msgs.length - 1];

  return (
    <>
      <div className="ml-rtop">
        <button className="pill-btn back" onClick={props.onBack}><Back /> Inbox</button>
        <div className="spacer" />
        <span className="muted small">{props.position}</span>
      </div>
      <div className="ml-rscroll">
        <span className="ml-tag" style={{ ['--c' as string]: props.color }}><span className="dot" />{t.account}</span>
        <h2 className="ml-subj">{detail?.subject ?? t.subject}</h2>
        {t.list && (
          <div className="ml-news">
            <span>Looks like a mailing list.</span>
            <button className="linkbtn blue" onClick={() => props.onAct('block')}>Block &amp; unsubscribe</button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {!detail && !error && <p className="muted">Loading…</p>}
        {msgs.map((m) => {
          const open = m === last || expanded.has(m.id);
          return open ? (
            <Message key={m.id} m={m} />
          ) : (
            <button key={m.id} className="ml-fold" onClick={() => setExpanded((s) => new Set([...s, m.id]))}>
              <span className="who">{m.mine ? 'Me' : m.from}</span>
              <span className="muted small">{when(m.date)}</span>
            </button>
          );
        })}
        {detail && (
          <button className="linkbtn muted ml-web" onClick={() => mail({ op: 'openUrl', url: detail.webUrl })}>Open in Gmail</button>
        )}
      </div>
      <div className="ml-abar">
        <button className="ml-ab reply" onClick={() => props.onAct('reply')}><MailIcon id="reply" size={19} />Reply</button>
        <button className="ml-ab" onClick={() => props.onAct('archive')}><MailIcon id="archive" size={19} />Archive</button>
        <button className="ml-ab danger" onClick={() => props.onAct('trash')}><MailIcon id="trash" size={19} />Delete</button>
        <button className="ml-ab danger" onClick={() => props.onAct('block')}><MailIcon id="block" size={19} />Block</button>
      </div>
    </>
  );
}

function Message({ m }: { m: MailMessage }) {
  return (
    <div className="ml-msg">
      <div className="ml-from">
        <div className="ml-av">{initials(m.mine ? 'Me' : m.from)}</div>
        <div className="who">
          <div className="n">{m.mine ? 'Me' : m.from}</div>
          <div className="e" title={m.to}>{m.fromEmail}{m.to && <> → {m.to}</>}</div>
        </div>
        <span className="time" title={fullWhen(m.date)}>{when(m.date)}</span>
      </div>
      {m.html ? <HtmlBody html={m.html} /> : <TextBody text={m.text ?? ''} />}
      {m.attachments.length > 0 && (
        <div className="ml-att">
          {m.attachments.map((a, i) => (
            <span key={i}><MailIcon id="paperclip" size={12} />{a.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// Plain-text mail, with links you can click (they open in your browser).
function TextBody({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"')\]]+)/g);
  return (
    <div className="ml-text">
      {parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noreferrer">{p}</a> : p))}
    </div>
  );
}

// HTML mail in a sandboxed frame: no scripts, and no remote images until you
// ask (they're how senders track opens). Wide newsletters are scaled to fit.
function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [images, setImages] = useState(false);
  const [height, setHeight] = useState(120);
  const hasRemote = /<img[^>]+src=["']?https?:|url\(\s*["']?https?:/i.test(html);
  const remote = images ? ' https: http:' : '';
  const doc = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'${remote}; img-src data: cid:${remote}; font-src data:${remote}">
<base target="_blank"><style>
html,body{margin:0;padding:0;background:#fff;color:#1d1d1f}
body{padding:14px;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Inter',sans-serif;overflow-wrap:anywhere}
img{max-width:100%;height:auto} pre{white-space:pre-wrap} a{color:#007aff}
blockquote{margin:0 0 0 4px;padding-left:10px;border-left:2px solid #ddd;color:#555}
</style></head><body>${html}</body></html>`;

  const fit = useCallback(() => {
    const f = ref.current;
    const d = f?.contentDocument;
    if (!f || !d?.body) return;
    d.body.style.zoom = '';
    const w = f.clientWidth;
    const sw = d.documentElement.scrollWidth;
    const z = sw > w + 2 ? w / sw : 1;
    if (z < 1) d.body.style.zoom = String(z);
    setHeight(Math.ceil(d.documentElement.scrollHeight) + 2); // already scaled by the zoom
  }, []);

  useEffect(() => {
    const f = ref.current;
    if (!f) return;
    const onLoad = () => {
      fit();
      // Images and fonts settle after load.
      setTimeout(fit, 300);
      setTimeout(fit, 1200);
    };
    f.addEventListener('load', onLoad);
    return () => f.removeEventListener('load', onLoad);
  }, [fit, doc]);

  return (
    <div className="ml-html">
      {hasRemote && !images && (
        <div className="ml-imgs"><span>Images are off so the sender can’t see you opened this.</span><button className="linkbtn blue" onClick={() => setImages(true)}>Show</button></div>
      )}
      <iframe ref={ref} title="Email" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} style={{ height }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function ReplySheet({ t, color, onClose, onSent }: { t: MailThread; color: string; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setTimeout(() => ta.current?.focus(), 60); }, []);

  const send = async () => {
    if (!text.trim()) { ta.current?.focus(); setError('Type a reply, or tap one of the quick replies.'); return; }
    setBusy(true);
    setError('');
    try {
      await mail({ op: 'reply', account: t.account, id: t.id, text });
      onSent();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <h3>Reply to {t.list ? t.from : t.from.split(' ')[0]}</h3>
      <p className="sub">Re: {t.subject}</p>
      <div className="ml-fromline">From <span className="ml-acct" style={{ ['--c' as string]: color }}><span className="dot" />{t.account}</span></div>
      <div className="ml-quick">
        {QUICK.map((q) => <button key={q} onClick={() => { setText(q); ta.current?.focus(); }}>{q}</button>)}
      </div>
      <textarea
        ref={ta}
        className="ml-ta"
        placeholder="Write a reply…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
      />
      {error && <p className="error small">{error}</p>}
      <div className="ml-sheet-actions">
        <span className="muted small">⌘↵ to send</span>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </>
  );
}

function BlockSheet({ t, onClose, onBlocked, onError }: { t: MailThread; onClose: () => void; onBlocked: (keys: string[], undo: MailUndo, note: string) => void; onError: (m: string) => void }) {
  const [count, setCount] = useState<number | null>(null);
  const [trashAll, setTrashAll] = useState(true);
  const [unsub, setUnsub] = useState(t.list);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mail<number>({ op: 'senderCount', account: t.account, email: t.fromEmail }).then(setCount).catch(() => setCount(1));
  }, [t.account, t.fromEmail]);
  const n = Math.max(1, count ?? 1);

  const go = async () => {
    setBusy(true);
    try {
      const r = await mail<{ undo: MailUndo; unsubscribed: 'done' | 'browser' | 'none' }>({ op: 'block', account: t.account, id: t.id, email: t.fromEmail, trashAll, unsubscribe: unsub });
      const note = `Blocked ${t.from}` + (r.unsubscribed === 'done' ? ' and unsubscribed' : r.unsubscribed === 'browser' ? '. Finish unsubscribing in your browser' : '');
      onBlocked(r.undo.ids.map((id) => `${t.account} ${id}`), r.undo, note);
    } catch (err) {
      setBusy(false);
      onError((err as Error).message);
    }
  };

  return (
    <>
      <div className="ml-blk"><MailIcon id="block" size={20} /></div>
      <h3>Block {t.from}?</h3>
      <p className="sub">New mail from <b>{t.fromEmail}</b> goes straight to Trash in {t.account}, on every device. You can unblock them under Accounts.</p>
      <label className="ml-check">
        <input type="checkbox" checked={trashAll} onChange={(e) => setTrashAll(e.target.checked)} />
        <span>Delete {n > 1 ? `all ${n} emails` : 'this email'} from them<small>{count === null ? 'Counting…' : 'They go to Trash.'}</small></span>
      </label>
      {t.list && (
        <label className="ml-check">
          <input type="checkbox" checked={unsub} onChange={(e) => setUnsub(e.target.checked)} />
          <span>Unsubscribe too<small>Uses the unsubscribe link in the email.</small></span>
        </label>
      )}
      <div className="ml-sheet-actions">
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn danger" disabled={busy} onClick={go} autoFocus>{busy ? 'Blocking…' : 'Block'}</button>
      </div>
    </>
  );
}

function ComposeSheet({ accounts, start, color, onClose, onSent }: { accounts: MailAccount[]; start: string | null; color: (e: string) => string; onClose: () => void; onSent: (from: string) => void }) {
  const [from, setFrom] = useState(start ?? accounts[0]?.email ?? '');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await mail({ op: 'compose', account: from, to, subject, text });
      onSent(from);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } };

  return (
    <div onKeyDown={keys}>
      <h3>New email</h3>
      <div className="ml-fromline wrap">From
        {accounts.map((a) => (
          <button key={a.email} className={`ml-acct pick ${from === a.email ? 'on' : ''}`} style={{ ['--c' as string]: color(a.email) }} onClick={() => setFrom(a.email)}>
            <span className="dot" />{a.email}
          </button>
        ))}
      </div>
      <input className="field" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} autoFocus spellCheck={false} />
      <input className="field" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      <textarea className="ml-ta" placeholder="Write something…" value={text} onChange={(e) => setText(e.target.value)} />
      {error && <p className="error small">{error}</p>}
      <div className="ml-sheet-actions">
        <span className="muted small">⌘↵ to send</span>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={busy || !to.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  );
}

function AccountsSheet({ accounts, builtIn, color, setSnap, onClose, onToast }: { accounts: MailAccount[]; builtIn: boolean; color: (e: string) => string; setSnap: (s: MailSnapshot) => void; onClose: () => void; onToast: (m: string) => void }) {
  const [blocked, setBlocked] = useState<MailBlocked[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmOut, setConfirmOut] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { mail<MailBlocked[]>({ op: 'blocked' }).then(setBlocked).catch(() => setBlocked([])); }, []);

  const add = async () => {
    setAdding(true);
    try {
      setSnap(await mail({ op: 'connect' }));
      onToast('Account added');
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <h3>Accounts</h3>
      <p className="sub">Switch one off to leave it out of the feed without signing out.</p>
      <div className="ml-alist">
        {accounts.map((a) => (
          <div key={a.email} className="ml-arow" style={{ ['--c' as string]: color(a.email) }}>
            <span className="dot" />
            <div className="who">
              <div className="n">{shortName(a.email)}</div>
              <div className="e">{a.email}</div>
            </div>
            {confirmOut === a.email ? (
              <button className="btn small danger" onClick={async () => { setSnap(await mail({ op: 'remove', email: a.email })); setConfirmOut(null); }}>Sign out</button>
            ) : (
              <button className="linkbtn muted" onClick={() => setConfirmOut(a.email)}>Remove</button>
            )}
            <button className={`ml-switch ${a.on ? 'on' : ''}`} aria-label={`Show ${a.email} in the feed`} aria-pressed={a.on} onClick={async () => setSnap(await mail({ op: 'toggle', email: a.email }))} />
          </div>
        ))}
      </div>
      <button className="btn ml-add" disabled={adding} onClick={add}>{adding ? 'Waiting for Google…' : '+ Add a Gmail account'}</button>

      <div className="ml-sm-h">Blocked senders</div>
      {blocked === null ? <p className="muted small">Loading…</p> : !blocked.length ? <p className="muted small">Nobody yet.</p> : (
        <div className="ml-alist">
          {blocked.map((b) => (
            <div key={b.account + b.filterId} className="ml-arow" style={{ ['--c' as string]: 'var(--red)' }}>
              <span className="dot" />
              <div className="who">
                <div className="n">{b.email}</div>
                <div className="e">in {b.account}</div>
              </div>
              <button className="linkbtn blue" onClick={async () => {
                try { setBlocked(await mail<MailBlocked[]>({ op: 'unblock', account: b.account, filterId: b.filterId })); onToast(`Unblocked ${b.email}`); }
                catch (err) { onToast((err as Error).message); }
              }}>Unblock</button>
            </div>
          ))}
        </div>
      )}

      <div className="ml-sheet-actions">
        {confirmReset
          ? <button className="btn small danger" onClick={async () => { setSnap(await mail({ op: 'clearClient' })); onClose(); }}>{builtIn ? 'Sign out of every account' : 'Sign out of all and reset'}</button>
          : <button className="linkbtn muted" title={builtIn ? 'Sign out of every account' : 'Sign out of every account and enter a different OAuth client'} onClick={() => setConfirmReset(true)}>{builtIn ? 'Sign out of all' : 'Reset Mail'}</button>}
        <div className="spacer" />
        <button className="btn" onClick={onClose}>Done</button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Inbox clean-up with Claude
// ---------------------------------------------------------------------------

const CATEGORY: Record<CleanupItem['category'], string> = { promotions: 'Promotions', social: 'Social', updates: 'Updates', forums: 'Forums', primary: 'Primary' };
const ACTIONS: { id: CleanupAction; label: string }[] = [{ id: 'unsubscribe', label: 'Unsubscribe' }, { id: 'archive', label: 'Clear out' }, { id: 'keep', label: 'Keep' }];

function Cleanup({ st, set, onClose }: { st: CleanupState; set: (s: CleanupState) => void; onClose: () => void }) {
  const [showKept, setShowKept] = useState(false);
  const [error, setError] = useState('');
  const run = (req: Parameters<typeof mail>[0]) => { setError(''); mail<CleanupState>(req).then(set).catch((e) => setError(e.message)); };
  const busy = ['scanning', 'thinking', 'applying'].includes(st.phase);
  const unsub = st.items.filter((x) => x.action === 'unsubscribe');
  const clear = st.items.filter((x) => x.action === 'archive');
  const keep = st.items.filter((x) => x.action === 'keep');
  const leaving = [...unsub, ...clear].reduce((n, x) => n + x.emails, 0);
  const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;

  const list = (title: string, items: CleanupItem[]) => items.length > 0 && (
    <>
      <div className="sec-h">{title} · {items.length}</div>
      <div className="group">{items.map((x) => <CleanRow key={x.id} x={x} onChoose={(a) => run({ op: 'cleanupChoose', id: x.id, action: a })} />)}</div>
    </>
  );

  return (
    <div className="cl">
      <div className="cl-nav">
        <button className="pill-btn back" onClick={onClose}>‹ Mail</button>
        <span className="spacer" />
        {(st.phase === 'ready' || st.phase === 'error') && <button className="linkbtn muted" onClick={() => run({ op: 'cleanupClose' })}>Start over</button>}
      </div>
      <div className="big-title cl-title"><h1>Clean Up</h1></div>
      {error && <p className="error pad">{error}</p>}

      <div className="cl-scroll">
        {st.phase === 'idle' && (
          <div className="cl-card cl-hero">
            <div className="cl-tile"><MailIcon id="sparkle" size={24} /></div>
            <p className="t">Clear out the clutter</p>
            <p className="muted">Claude looks at who’s been filling your inbox over the last 90 days and suggests who to <b>unsubscribe</b> from and what to <b>clear out</b>. Nothing changes until you say so.</p>
            <button className="btn primary cl-start" onClick={() => run({ op: 'cleanupStart' })}>Start Clean-Up</button>
            <p className="cl-fine">Claude sees senders, counts and a few subject lines, never what the emails say. It runs through Claude Code on this Mac. People you’ve written to and starred mail are left alone.</p>
          </div>
        )}

        {busy && (
          <div className="cl-card cl-progress">
            <div className="cl-spinner"><MailIcon id="sparkle" size={22} /></div>
            <p className="t">{st.phase === 'scanning' ? 'Looking through your inbox' : st.phase === 'thinking' ? 'Claude is reviewing your senders' : 'Cleaning up'}</p>
            <p className="muted">
              {st.phase === 'scanning' ? (st.total ? `${st.done} of ${st.total} conversations` : 'Finding conversations…')
                : st.phase === 'thinking' ? `${st.total} senders that could be clutter`
                : `${st.done} of ${st.total} senders`}
            </p>
            {st.phase !== 'thinking' && <div className="cl-bar"><i style={{ width: `${pct}%` }} /></div>}
            <p className="cl-fine">You can leave Mail. Rail lets you know when it’s ready.</p>
          </div>
        )}

        {st.phase === 'ready' && (
          <>
            <div className="cl-card cl-sum">
              <div className="cl-stats">
                <div><b>{unsub.length}</b><span>Unsubscribe</span></div>
                <div><b>{clear.length}</b><span>Clear out</span></div>
                <div><b>{leaving.toLocaleString()}</b><span>Emails out</span></div>
              </div>
              <p className="cl-by">{st.by === 'claude' ? `Suggested by Claude from ${st.scanned.toLocaleString()} conversations. Change any of them below.` : `Suggested by Rail’s own rules. ${st.note ?? ''}`}</p>
            </div>
            {st.items.length === 0 && <p className="muted pad">Nothing in your inbox looks like clutter.</p>}
            {list('Unsubscribe', unsub)}
            {list('Clear Out', clear)}
            {keep.length > 0 && (
              <>
                <button className="cl-more" onClick={() => setShowKept(!showKept)}>{showKept ? 'Hide' : 'Show'} {keep.length} to keep <span className={`chev ${showKept ? 'open' : ''}`}>›</span></button>
                {showKept && <div className="group">{keep.map((x) => <CleanRow key={x.id} x={x} onChoose={(a) => run({ op: 'cleanupChoose', id: x.id, action: a })} />)}</div>}
              </>
            )}
          </>
        )}

        {st.phase === 'done' && st.result && (
          <div className="cl-card cl-hero">
            <div className="cl-tile ok"><MailIcon id="check" size={24} /></div>
            <p className="t">Inbox cleaned up</p>
            <p className="muted">
              {st.result.unsubscribed > 0 && <>Unsubscribed from <b>{st.result.unsubscribed}</b> sender{st.result.unsubscribed === 1 ? '' : 's'}. </>}
              <b>{st.result.archived.toLocaleString()}</b> email{st.result.archived === 1 ? '' : 's'} moved out of your inbox (they’re still in All Mail).
            </p>
            <div className="cl-done-btns">
              {st.result.canUndo && <button className="btn" onClick={() => run({ op: 'cleanupUndo' })}>Put Them Back</button>}
              <button className="btn primary" onClick={() => { run({ op: 'cleanupClose' }); onClose(); }}>Done</button>
            </div>
          </div>
        )}
        {st.phase === 'done' && st.result && st.result.links.length > 0 && (
          <>
            <div className="sec-h">Finish on their website · {st.result.links.length}</div>
            <div className="group">
              {st.result.links.map((l) => (
                <div key={l.url} className="cl-link">
                  <span>{l.name}</span>
                  <button className="linkbtn blue" onClick={() => void mail({ op: 'openUrl', url: l.url })}>Unsubscribe ↗</button>
                </div>
              ))}
            </div>
            <p className="cl-fine pad">These senders only unsubscribe on their own page. Their mail is already out of your inbox.</p>
          </>
        )}

        {st.phase === 'error' && (
          <div className="cl-card cl-hero">
            <p className="t">Couldn’t finish the clean-up</p>
            <p className="error">{st.error}</p>
            <button className="btn primary cl-start" onClick={() => run({ op: 'cleanupStart' })}>Try Again</button>
          </div>
        )}
      </div>

      {st.phase === 'ready' && (unsub.length + clear.length > 0) && (
        <div className="cl-foot">
          <button className="btn primary cl-apply" onClick={() => run({ op: 'cleanupApply' })}>
            {unsub.length ? `Unsubscribe ${unsub.length} · ` : ''}Clear {leaving.toLocaleString()} Email{leaving === 1 ? '' : 's'}
          </button>
        </div>
      )}
    </div>
  );
}

function CleanRow({ x, onChoose }: { x: CleanupItem; onChoose: (a: CleanupAction) => void }) {
  return (
    <div className="cl-row">
      <div className="ml-av">{initials(x.name)}</div>
      <div className="cl-rb">
        <div className="cl-name"><b>{x.name}</b><span>{x.email}</span></div>
        <div className="cl-meta">{x.emails} email{x.emails === 1 ? '' : 's'} · {x.unread === x.emails ? 'none opened' : `${x.unread} unread`} · {CATEGORY[x.category]}</div>
        {x.reason && <div className="cl-why">{x.reason}</div>}
        <div className="cl-seg" role="radiogroup" aria-label={`What to do with ${x.name}`}>
          {ACTIONS.map((a) => (
            <button key={a.id} role="radio" aria-checked={x.action === a.id} className={x.action === a.id ? `on ${a.id}` : ''} disabled={a.id === 'unsubscribe' && !x.unsubscribe}
              title={a.id === 'unsubscribe' && !x.unsubscribe ? 'This sender has no unsubscribe link' : undefined} onClick={() => onChoose(a.id)}>{a.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

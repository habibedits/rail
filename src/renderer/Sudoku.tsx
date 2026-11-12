import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// A Sudoku generated on this Mac: a random full grid, then clues removed one
// at a time while the puzzle still has exactly one solution.

type Level = 'easy' | 'medium' | 'hard';
const CLUES: Record<Level, number> = { easy: 38, medium: 31, hard: 26 };
const STORE = 'rail.sudoku.v1';

interface Game {
  level: Level;
  givens: number[]; // 0 = blank
  solution: number[];
  entries: number[]; // the player's numbers (0 = empty)
  notes: number[]; // bitmask of pencil marks per cell
  mistakes: number;
  started: number;
  done?: number;
}

const row = (i: number) => Math.floor(i / 9);
const col = (i: number) => i % 9;
const box = (i: number) => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) =>
  Array.from({ length: 81 }, (_, j) => j).filter((j) => j !== i && (row(j) === row(i) || col(j) === col(i) || box(j) === box(i))),
);

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const canPlace = (g: number[], i: number, n: number) => PEERS[i].every((j) => g[j] !== n);

function fill(g: number[]): boolean {
  const i = g.indexOf(0);
  if (i < 0) return true;
  for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (canPlace(g, i, n)) { g[i] = n; if (fill(g)) return true; g[i] = 0; }
  }
  return false;
}

// Counts solutions, stopping at `limit`. Picks the most constrained cell first.
function count(g: number[], limit = 2): number {
  let best = -1, bestOpts: number[] = [];
  for (let i = 0; i < 81; i++) {
    if (g[i]) continue;
    const opts = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((n) => canPlace(g, i, n));
    if (opts.length === 0) return 0;
    if (best < 0 || opts.length < bestOpts.length) { best = i; bestOpts = opts; if (opts.length === 1) break; }
  }
  if (best < 0) return 1;
  let total = 0;
  for (const n of bestOpts) {
    g[best] = n;
    total += count(g, limit - total);
    g[best] = 0;
    if (total >= limit) break;
  }
  return total;
}

function generate(level: Level): Game {
  const solution = Array(81).fill(0);
  fill(solution);
  const givens = solution.slice();
  let clues = 81;
  for (const i of shuffle(Array.from({ length: 81 }, (_, k) => k))) {
    if (clues <= CLUES[level]) break;
    const keep = givens[i];
    givens[i] = 0;
    if (count(givens.slice()) !== 1) givens[i] = keep;
    else clues--;
  }
  return { level, givens, solution, entries: Array(81).fill(0), notes: Array(81).fill(0), mistakes: 0, started: Date.now() };
}

function load(): Game | null {
  try { const g = JSON.parse(localStorage.getItem(STORE) ?? 'null'); return g?.givens?.length === 81 ? g : null; } catch { return null; }
}

export function Sudoku() {
  const [game, setGame] = useState<Game>(() => load() ?? generate('easy'));
  const [sel, setSel] = useState<number | null>(null);
  const [pencil, setPencil] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(game)); } catch { /* storage unavailable */ } }, [game]);

  const value = (i: number) => game.givens[i] || game.entries[i];
  const solved = useMemo(() => game.solution.every((n, i) => value(i) === n), [game]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (solved && !game.done) setGame((g) => ({ ...g, done: Date.now() })); }, [solved, game.done]);

  const put = useCallback((n: number) => {
    if (sel === null || game.givens[sel] || game.done) return;
    setGame((g) => {
      const entries = g.entries.slice(), notes = g.notes.slice();
      let mistakes = g.mistakes;
      if (pencil && n) {
        if (entries[sel]) return g;
        notes[sel] ^= 1 << n;
      } else {
        entries[sel] = entries[sel] === n ? 0 : n;
        notes[sel] = 0;
        if (n && entries[sel] && n !== g.solution[sel]) mistakes++;
        // Clear this number from peers' pencil marks once it's placed correctly.
        if (n && n === g.solution[sel]) for (const j of PEERS[sel]) notes[j] &= ~(1 << n);
      }
      return { ...g, entries, notes, mistakes };
    });
  }, [sel, pencil, game.givens, game.done]);

  const onKey = (e: React.KeyboardEvent) => {
    if (/^[1-9]$/.test(e.key)) { put(Number(e.key)); e.preventDefault(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { put(0); e.preventDefault(); return; }
    if (e.key === 'n' || e.key === 'N') { setPencil((p) => !p); return; }
    const move: Record<string, number> = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
    if (move[e.key] !== undefined) {
      e.preventDefault();
      setSel((s) => (s === null ? 0 : Math.min(80, Math.max(0, s + move[e.key]))));
    }
  };

  const fresh = (level: Level) => { setGame(generate(level)); setSel(null); root.current?.focus(); };
  const selVal = sel !== null ? value(sel) : 0;
  const counts = useMemo(() => {
    const c = Array(10).fill(0);
    for (let i = 0; i < 81; i++) { const v = value(i); if (v && v === game.solution[i]) c[v]++; }
    return c;
  }, [game]); // eslint-disable-line react-hooks/exhaustive-deps
  const mins = Math.max(1, Math.round(((game.done ?? Date.now()) - game.started) / 60000));

  return (
    <div className="sdk" tabIndex={0} ref={root} onKeyDown={onKey}>
      <div className="g-head">
        <div className="seg">
          {(['easy', 'medium', 'hard'] as Level[]).map((l) => (
            <button key={l} className={game.level === l ? 'on' : ''} onClick={() => fresh(l)} title={`New ${l} puzzle`}>{l[0].toUpperCase() + l.slice(1)}</button>
          ))}
        </div>
        <span className="g-meta">{game.mistakes ? `${game.mistakes} mistake${game.mistakes > 1 ? 's' : ''}` : 'No mistakes'}</span>
      </div>

      <div className="sdk-grid">
        {Array.from({ length: 81 }, (_, i) => {
          const v = value(i);
          const given = !!game.givens[i];
          const wrong = !given && v && v !== game.solution[i];
          const peer = sel !== null && (row(i) === row(sel) || col(i) === col(sel) || box(i) === box(sel));
          const same = selVal && v === selVal;
          return (
            <button
              key={i}
              className={['c', given ? 'given' : '', wrong ? 'wrong' : '', i === sel ? 'sel' : peer ? 'peer' : '', same ? 'same' : '',
                col(i) % 3 === 2 && col(i) < 8 ? 'br' : '', row(i) % 3 === 2 && row(i) < 8 ? 'bb' : ''].join(' ')}
              onClick={() => { setSel(i); root.current?.focus(); }}
            >
              {v ? v : game.notes[i] ? (
                <span className="notes">{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <i key={n}>{game.notes[i] & (1 << n) ? n : ''}</i>)}</span>
              ) : ''}
            </button>
          );
        })}
      </div>

      {game.done ? (
        <div className="g-done">
          Solved in {mins} min{game.mistakes ? ` with ${game.mistakes} mistake${game.mistakes > 1 ? 's' : ''}` : ', no mistakes'}.
          <button className="btn small primary" onClick={() => fresh(game.level)}>New puzzle</button>
        </div>
      ) : (
        <div className="sdk-pad">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <button key={n} className={counts[n] >= 9 ? 'used' : ''} onClick={() => put(n)}>{n}</button>
          ))}
          <button className={`tool ${pencil ? 'on' : ''}`} onClick={() => setPencil(!pencil)} title="Pencil marks (N)">✎</button>
          <button className="tool" onClick={() => put(0)} title="Erase (Delete)">⌫</button>
        </div>
      )}
    </div>
  );
}

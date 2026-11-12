import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import type { ChessPuzzle as Puzzle } from './rail';

// Lichess puzzles: find the best move(s). Click a piece, then its square.
// The opponent's replies play automatically. Any move that gives checkmate
// counts, as on Lichess.

type Level = 'easier' | 'normal' | 'harder';
const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';
const STATS = 'rail.chess.v1';

type Status = 'loading' | 'play' | 'wrong' | 'solved' | 'failed' | 'error';

export function ChessPuzzle() {
  const [level, setLevel] = useState<Level>(() => (localStorage.getItem('rail.chess.level') as Level) || 'normal');
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [fen, setFen] = useState('');
  const [step, setStep] = useState(0); // index into solution
  const [sel, setSel] = useState<Square | null>(null);
  const [last, setLast] = useState<[string, string] | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [hint, setHint] = useState<Square | null>(null);
  const [promo, setPromo] = useState<{ from: Square; to: Square } | null>(null);
  const [stats, setStats] = useState<{ solved: number; tried: number; streak: number }>(() => {
    try { return JSON.parse(localStorage.getItem(STATS) ?? '') ?? { solved: 0, tried: 0, streak: 0 }; } catch { return { solved: 0, tried: 0, streak: 0 }; }
  });
  const missed = useRef(false);

  useEffect(() => { try { localStorage.setItem(STATS, JSON.stringify(stats)); } catch { /* storage unavailable */ } }, [stats]);

  const next = async (lv = level) => {
    setStatus('loading'); setSel(null); setHint(null); setPromo(null); missed.current = false;
    const r = await window.rail.puzzle(lv);
    if (!r.ok) { setError(r.error); setStatus('error'); return; }
    const p = r.data;
    setPuzzle(p); setFen(p.fen); setStep(0);
    setLast(p.lastMove ? [p.lastMove.slice(0, 2), p.lastMove.slice(2, 4)] : null);
    setStatus('play');
  };
  useEffect(() => { void next(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const game = useMemo(() => (fen ? new Chess(fen) : null), [fen]);
  const solver = puzzle ? new Chess(puzzle.fen).turn() : 'w';
  const flipped = solver === 'b';

  const finish = (ok: boolean) => {
    setStatus(ok ? 'solved' : 'failed');
    setStats((s) => ({ solved: s.solved + (ok ? 1 : 0), tried: s.tried + 1, streak: ok ? s.streak + 1 : 0 }));
  };

  const tryMove = (from: Square, to: Square, promotion?: string) => {
    if (!game || !puzzle || status !== 'play') return;
    const g = new Chess(game.fen());
    let mv;
    try { mv = g.move({ from, to, promotion: promotion ?? 'q' }); } catch { return; }
    const uci = from + to + (mv.promotion ?? '');
    const expected = puzzle.solution[step];
    if (uci === expected || g.isCheckmate()) {
      setFen(g.fen()); setLast([from, to]); setSel(null); setHint(null);
      const reply = puzzle.solution[step + 1];
      if (!reply || g.isCheckmate()) { finish(!missed.current); return; }
      setStep(step + 2);
      setTimeout(() => {
        const g2 = new Chess(g.fen());
        try { g2.move({ from: reply.slice(0, 2) as Square, to: reply.slice(2, 4) as Square, promotion: reply[4] }); } catch { return; }
        setFen(g2.fen()); setLast([reply.slice(0, 2), reply.slice(2, 4)]);
      }, 450);
    } else {
      missed.current = true;
      setSel(null);
      setStatus('wrong');
      setTimeout(() => setStatus((s) => (s === 'wrong' ? 'play' : s)), 900);
    }
  };

  const click = (sq: Square) => {
    if (!game || status !== 'play') return;
    const piece = game.get(sq);
    if (sel && sel !== sq) {
      const legal = game.moves({ square: sel, verbose: true }).find((m) => m.to === sq);
      if (legal) {
        if (legal.promotion) { setPromo({ from: sel, to: sq }); return; }
        tryMove(sel, sq);
        return;
      }
    }
    setSel(piece && piece.color === game.turn() ? sq : null);
  };

  const showSolution = () => {
    if (!puzzle || !game) return;
    missed.current = true;
    const g = new Chess(fen);
    const rest = puzzle.solution.slice(step);
    let i = 0;
    const play = () => {
      const m = rest[i++];
      if (!m) { finish(false); return; }
      try { g.move({ from: m.slice(0, 2) as Square, to: m.slice(2, 4) as Square, promotion: m[4] }); } catch { finish(false); return; }
      setFen(g.fen()); setLast([m.slice(0, 2), m.slice(2, 4)]);
      setTimeout(play, 600);
    };
    setStatus('failed');
    play();
  };

  const targets = useMemo(() => (game && sel ? new Set(game.moves({ square: sel, verbose: true }).map((m) => m.to)) : new Set<string>()), [game, sel]);

  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = flipped ? [...FILES].reverse() : [...FILES];

  return (
    <div className="chz">
      <div className="g-head">
        <div className="seg">
          {(['easier', 'normal', 'harder'] as Level[]).map((l) => (
            <button key={l} className={level === l ? 'on' : ''} onClick={() => { setLevel(l); localStorage.setItem('rail.chess.level', l); void next(l); }}>
              {l === 'easier' ? 'Easy' : l === 'normal' ? 'Medium' : 'Hard'}
            </button>
          ))}
        </div>
        <span className="g-meta">{stats.solved}/{stats.tried} solved{stats.streak > 1 ? ` · ${stats.streak} in a row` : ''}</span>
      </div>

      <div className={`chz-board ${status === 'wrong' ? 'shake' : ''}`}>
        {ranks.map((r) => files.map((f, fi) => {
          const sq = `${f}${r}` as Square;
          const p = game?.get(sq);
          const dark = (FILES.indexOf(f) + r) % 2 === 1; // a1 is dark
          return (
            <button
              key={sq}
              className={['sq', dark ? 'd' : 'l', sel === sq ? 'sel' : '', last?.includes(sq) ? 'last' : '', hint === sq ? 'hint' : '', targets.has(sq) ? (p ? 'cap' : 'dot') : ''].join(' ')}
              onClick={() => click(sq)}
            >
              {p && <span className={`pc ${p.color}`}>{GLYPH[p.type]}</span>}
              {fi === 0 && <em className="rk">{r}</em>}
              {r === (flipped ? 8 : 1) && <em className="fl">{f}</em>}
            </button>
          );
        }))}
        {promo && (
          <div className="chz-promo">
            {['q', 'r', 'b', 'n'].map((t) => (
              <button key={t} onClick={() => { const p = promo; setPromo(null); tryMove(p.from, p.to, t); }}>
                <span className={`pc ${solver}`}>{GLYPH[t]}</span>
              </button>
            ))}
          </div>
        )}
        {status === 'loading' && <div className="chz-cover">Loading puzzle…</div>}
        {status === 'error' && <div className="chz-cover">{error}<button className="btn small" onClick={() => void next()}>Try again</button></div>}
      </div>

      <div className="chz-foot">
        <span className={`chz-msg ${status}`}>
          {status === 'play' && `${solver === 'w' ? 'White' : 'Black'} to move${puzzle ? ` · ${puzzle.rating}` : ''}`}
          {status === 'wrong' && 'Not that one. Try again.'}
          {status === 'solved' && (missed.current ? 'Solved (with a miss).' : 'Solved!')}
          {status === 'failed' && 'Here’s the line.'}
        </span>
        <span className="chz-btns">
          {status === 'play' && (
            <>
              <button className="btn small ghost" onClick={() => { missed.current = true; setHint(puzzle!.solution[step].slice(0, 2) as Square); }}>Hint</button>
              <button className="btn small ghost" onClick={showSolution}>Solution</button>
            </>
          )}
          {(status === 'solved' || status === 'failed') && <button className="btn small primary" onClick={() => void next()}>Next puzzle</button>}
        </span>
      </div>
    </div>
  );
}

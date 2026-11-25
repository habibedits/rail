// Runs Claude Code (`claude -p`) on this Mac for one-off questions, using the
// user's own Claude Code sign-in: no API key in Rail. No tools, no MCP
// servers, no hooks, nothing saved as a session: Claude only reads what Rail
// passes in and answers in the JSON shape Rail asks for.

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const CANDIDATES = [
  path.join(HOME, '.local/bin/claude'), // native installer
  path.join(HOME, '.claude/local/claude'), // older local install
  '/opt/homebrew/bin/claude',
  '/usr/local/bin/claude',
  path.join(HOME, '.npm-global/bin/claude'),
  path.join(HOME, '.bun/bin/claude'),
  path.join(HOME, '.volta/bin/claude'),
];

let found: { bin: string; env: NodeJS.ProcessEnv } | null = null;

// Rail starts from the Dock, so it doesn't have the shell's PATH (nvm,
// Homebrew…). Ask the user's login shell where claude is and what PATH it has.
function fromShell(): Promise<{ bin: string; path: string } | null> {
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', 'echo "__RAIL__$(command -v claude)__RAIL__${PATH}__RAIL__"'], { timeout: 8000 }, (_err, stdout) => {
      const m = /__RAIL__(.*?)__RAIL__(.*?)__RAIL__/.exec(String(stdout ?? ''));
      resolve(m && m[1] ? { bin: m[1].trim(), path: m[2].trim() } : null);
    });
  });
}

export async function findClaude() {
  if (found && fs.existsSync(found.bin)) return found;
  const sh = await fromShell();
  const env = { ...process.env, ...(sh?.path ? { PATH: sh.path } : {}) };
  const bin = sh?.bin && fs.existsSync(sh.bin) ? sh.bin : CANDIDATES.find((c) => fs.existsSync(c));
  found = bin ? { bin, env } : null;
  return found;
}

export class ClaudeError extends Error {}

/** Asks Claude once; resolves with the structured output (matching `schema`). */
export async function ask<T>(input: string, opts: { schema: object; system: string; timeoutMs?: number; cwd: string }): Promise<T> {
  const c = await findClaude();
  if (!c) throw new ClaudeError('Claude Code isn’t installed on this Mac.');
  fs.mkdirSync(opts.cwd, { recursive: true });
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(opts.schema),
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--settings', JSON.stringify({ disableAllHooks: true }),
    '--append-system-prompt', opts.system,
  ];
  return new Promise<T>((resolve, reject) => {
    const p = spawn(c.bin, args, { cwd: opts.cwd, env: c.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { p.kill(); reject(new ClaudeError('Claude took too long to answer.')); }, opts.timeoutMs ?? 240_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(timer); reject(new ClaudeError(`Couldn’t start Claude Code: ${e.message}`)); });
    p.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) throw new ClaudeError(String(j.result || 'Claude Code couldn’t answer.').slice(0, 300));
        const data = j.structured_output ?? JSON.parse(String(j.result ?? '').replace(/^```(?:json)?\s*|\s*```$/g, ''));
        resolve(data as T);
      } catch (e) {
        if (e instanceof ClaudeError) return reject(e);
        const why = /not logged in|login|authenticat/i.test(err + out) ? 'Sign in to Claude Code first: run `claude` in Terminal once.' : `Claude Code didn’t answer (exit ${code}).`;
        reject(new ClaudeError(why));
      }
    });
    p.stdin.end(input);
  });
}

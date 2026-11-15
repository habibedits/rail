// Agents space: a live view of every Claude Code session on this Mac.
//
// Claude Code runs a small curl command at each step of a session (its
// "hooks", set in ~/.claude/settings.json). The command posts the step to a
// server Rail runs on 127.0.0.1, so Rail can show what each agent is doing.
// For permission prompts and questions the command waits for Rail's answer:
// click Allow (or answer the question) in Rail, and Claude Code goes on
// without you opening its window. Answer in Claude Code instead and Rail's
// card goes away.
//
// Pure Node (no Electron import) so it can be run and tested on its own.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const PORT = 47615;
const MAX_STEPS = 200;
const BODY_LIMIT = 4 * 1024 * 1024;
// A request Rail never answers falls back to Claude Code's own prompt.
const HOLD_SECONDS = 60 * 60;

// ---- Types shared with the renderer (mirrored in src/renderer/rail.ts) -----

export type AgentStatus = 'working' | 'permission' | 'question' | 'idle' | 'ended';

export interface AgentStep {
  id: string;
  at: number;
  kind: 'prompt' | 'tool' | 'reply' | 'permission' | 'question' | 'note';
  title: string;
  detail?: string;
  state?: 'running' | 'waiting' | 'ok' | 'error' | 'denied';
}

export interface AgentQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: { label: string; description: string }[];
}

export interface AgentPending {
  id: string;
  kind: 'permission' | 'question';
  tool: string;
  title: string; // "Run a command", "Edit src/app.ts"
  detail: string; // the command, the diff, the URL…
  questions?: AgentQuestion[];
  canAlways: boolean; // Claude Code offered an "always allow" rule
  at: number;
}

export interface AgentSession {
  id: string;
  cwd: string;
  project: string;
  title: string; // first prompt, shortened
  host: string; // "VS Code", "Terminal", "Cursor"…
  status: AgentStatus;
  activity: string; // one line: what it's doing right now
  startedAt: number;
  updatedAt: number;
  steps: AgentStep[];
  pending: AgentPending | null;
  lastReply: string;
}

export interface AgentsSnapshot {
  connected: boolean; // Rail's hooks are in ~/.claude/settings.json
  listening: boolean;
  error: string | null;
  sessions: AgentSession[];
}

// ---- State -------------------------------------------------------------------

interface Internal extends AgentSession {
  bundleId: string;
  permissionMode: string;
  waiter: Waiter | null;
  openTools: Map<string, string>; // tool_use_id -> step id
  lastTool: Map<string, string>; // tool name -> latest step id
}

interface Waiter {
  pendingId: string;
  input: any;
  res: http.ServerResponse;
  timer: NodeJS.Timeout;
}

const sessions = new Map<string, Internal>();
let token = '';
let dataDir = '';
let listening = false;
let lastError: string | null = null;
let onChange: (snap: AgentsSnapshot) => void = () => {};
let onAttention: (s: AgentSession) => void = () => {};
let settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

const uid = () => crypto.randomBytes(6).toString('hex');
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function snapshot(): AgentsSnapshot {
  const list = [...sessions.values()]
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
    .map(({ waiter: _w, openTools: _o, bundleId: _b, permissionMode: _p, ...pub }) => pub);
  return { connected: hooksInstalled(), listening, error: lastError, sessions: list };
}

const rank = (s: AgentSession) => (s.pending ? 0 : s.status === 'working' ? 1 : s.status === 'idle' ? 2 : 3);

let changeTimer: NodeJS.Timeout | null = null;
function changed() {
  if (changeTimer) return;
  changeTimer = setTimeout(() => {
    changeTimer = null;
    onChange(snapshot());
  }, 60);
}

// ---- Describing tools in plain words ---------------------------------------

function rel(cwd: string, p: unknown) {
  if (typeof p !== 'string') return '';
  if (cwd && p.startsWith(cwd + '/')) return p.slice(cwd.length + 1);
  return p.replace(os.homedir(), '~');
}

export function describeTool(name: string, input: any, cwd: string): { title: string; detail: string } {
  const i = input ?? {};
  switch (name) {
    case 'Bash':
      return { title: i.description ? clip(oneLine(i.description), 80) : 'Run a command', detail: String(i.command ?? '') };
    case 'Read':
      return { title: `Read ${rel(cwd, i.file_path)}`, detail: '' };
    case 'Write':
      return { title: `Write ${rel(cwd, i.file_path)}`, detail: clip(String(i.content ?? ''), 4000) };
    case 'Edit':
    case 'MultiEdit': {
      const edits = name === 'MultiEdit' ? (i.edits ?? []) : [i];
      const diff = edits
        .map((e: any) => [
          ...String(e.old_string ?? '').split('\n').map((l) => `- ${l}`),
          ...String(e.new_string ?? '').split('\n').map((l) => `+ ${l}`),
        ].join('\n'))
        .join('\n…\n');
      return { title: `Edit ${rel(cwd, i.file_path)}`, detail: clip(diff, 4000) };
    }
    case 'NotebookEdit':
      return { title: `Edit ${rel(cwd, i.notebook_path)}`, detail: clip(String(i.new_source ?? ''), 4000) };
    case 'Grep':
      return { title: `Search for “${clip(String(i.pattern ?? ''), 50)}”`, detail: i.path ? rel(cwd, i.path) : '' };
    case 'Glob':
      return { title: `Find files ${clip(String(i.pattern ?? ''), 50)}`, detail: '' };
    case 'WebFetch':
      return { title: `Open ${hostOf(i.url)}`, detail: String(i.url ?? '') };
    case 'WebSearch':
      return { title: `Search the web: ${clip(String(i.query ?? ''), 60)}`, detail: '' };
    case 'Task':
    case 'Agent':
      return { title: `Start a helper: ${clip(oneLine(String(i.description ?? i.subagent_type ?? 'agent')), 60)}`, detail: clip(String(i.prompt ?? ''), 1500) };
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return { title: 'Update its to-do list', detail: Array.isArray(i.todos) ? i.todos.map((t: any) => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'} ${t.content}`).join('\n') : '' };
    case 'AskUserQuestion':
      return { title: clip(oneLine(String(i.questions?.[0]?.question ?? 'Asked you a question')), 120), detail: (i.questions ?? []).slice(1).map((q: any) => q.question).join('\n') };
    case 'ExitPlanMode':
      return { title: 'Show you its plan', detail: clip(String(i.plan ?? ''), 4000) };
    default: {
      const m = /^mcp__(.+?)__(.+)$/.exec(name);
      if (m) return { title: `${m[1].replace(/[_-]+/g, ' ')}: ${m[2].replace(/[_-]+/g, ' ')}`, detail: clip(JSON.stringify(i, null, 2), 1500) };
      return { title: name, detail: clip(JSON.stringify(i, null, 2), 1500) };
    }
  }
}

function hostOf(u: unknown) {
  try { return new URL(String(u)).hostname; } catch { return 'a web page'; }
}

function hostName(bundleId: string, entry: string, term: string) {
  const b = bundleId.toLowerCase();
  if (b.includes('vscode') || entry === 'claude-vscode' || term === 'vscode') return b.includes('insiders') ? 'VS Code Insiders' : 'VS Code';
  if (b.includes('cursor') || b.startsWith('com.todesktop.')) return 'Cursor';
  if (b.includes('windsurf')) return 'Windsurf';
  if (b.includes('iterm') || term === 'iTerm.app') return 'iTerm';
  if (b.includes('ghostty') || term === 'ghostty') return 'Ghostty';
  if (b.includes('warp') || term === 'WarpTerminal') return 'Warp';
  if (b.includes('jetbrains')) return 'JetBrains';
  if (b.includes('zed')) return 'Zed';
  if (b === 'com.apple.terminal' || term === 'Apple_Terminal') return 'Terminal';
  if (entry === 'claude-desktop' || b.includes('anthropic')) return 'Claude';
  return 'Terminal';
}

// ---- Sessions ----------------------------------------------------------------

function session(body: any, headers: http.IncomingHttpHeaders): Internal {
  const id = String(body.session_id ?? 'unknown');
  let s = sessions.get(id);
  const cwd = String(body.cwd ?? '');
  if (!s) {
    const bundleId = String(headers['x-rail-bundle'] ?? '');
    s = {
      id,
      cwd,
      project: path.basename(cwd) || 'Claude Code',
      title: '',
      host: hostName(bundleId, String(headers['x-rail-entry'] ?? ''), String(headers['x-rail-term'] ?? '')),
      bundleId,
      status: 'idle',
      activity: 'Ready',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      steps: [],
      pending: null,
      lastReply: '',
      permissionMode: '',
      waiter: null,
      openTools: new Map(),
      lastTool: new Map(),
    };
    sessions.set(id, s);
  }
  if (cwd && !s.cwd) { s.cwd = cwd; s.project = path.basename(cwd); }
  if (body.permission_mode) s.permissionMode = String(body.permission_mode);
  s.updatedAt = Date.now();
  return s;
}

function addStep(s: Internal, step: Omit<AgentStep, 'id' | 'at'>) {
  const full: AgentStep = { id: uid(), at: Date.now(), ...step };
  s.steps.push(full);
  if (s.steps.length > MAX_STEPS) s.steps.splice(0, s.steps.length - MAX_STEPS);
  return full;
}

function settleWaiter(s: Internal, output: object | null) {
  const w = s.waiter;
  if (!w) return;
  s.waiter = null;
  clearTimeout(w.timer);
  if (!w.res.writableEnded) {
    w.res.writeHead(200, { 'Content-Type': 'application/json' });
    w.res.end(output ? JSON.stringify(output) : '{}');
  }
}

// The tool's step stops "waiting": it runs (allowed/answered) or is denied.
function clearPending(s: Internal, outcome: 'allowed' | 'denied') {
  if (!s.pending) return;
  const step = s.steps.find((x) => x.state === 'waiting');
  if (step) step.state = outcome === 'denied' ? 'denied' : 'running';
  s.pending = null;
}

// Reads Claude's last written reply from the session transcript (JSONL).
function lastReplyFrom(transcript: unknown): string {
  if (typeof transcript !== 'string' || !transcript) return '';
  try {
    const st = fs.statSync(transcript);
    const fd = fs.openSync(transcript, 'r');
    const len = Math.min(st.size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue;
      try {
        const j = JSON.parse(line);
        if (j.type !== 'assistant' || j.isSidechain) continue;
        const content = j.message?.content;
        const text = Array.isArray(content) ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') : typeof content === 'string' ? content : '';
        if (text.trim()) return text.trim();
      } catch { /* partial line */ }
    }
  } catch { /* transcript gone */ }
  return '';
}

// ---- Hook events -------------------------------------------------------------

function handleHook(body: any, headers: http.IncomingHttpHeaders, res: http.ServerResponse) {
  const event = String(body.hook_event_name ?? '');
  const s = session(body, headers);
  const reply = (out: object | null = null) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(out ? JSON.stringify(out) : '{}');
  };

  switch (event) {
    case 'SessionStart':
      if (s.status === 'ended') s.status = 'idle';
      if (body.source === 'resume' || body.source === 'compact' || body.source === 'clear') addStep(s, { kind: 'note', title: body.source === 'compact' ? 'Compacted the conversation' : body.source === 'clear' ? 'Cleared the conversation' : 'Resumed the session' });
      break;

    case 'UserPromptSubmit': {
      const prompt = String(body.prompt ?? '');
      if (!s.title) s.title = clip(oneLine(prompt), 90);
      settleWaiter(s, null);
      clearPending(s, 'allowed');
      addStep(s, { kind: 'prompt', title: clip(oneLine(prompt), 140), detail: prompt.length > 140 ? clip(prompt, 4000) : undefined });
      s.status = 'working';
      s.activity = 'Thinking';
      break;
    }

    case 'PreToolUse': {
      const name = String(body.tool_name ?? '');
      const d = describeTool(name, body.tool_input, s.cwd);
      // A permission card that's still up but the tool is now starting means
      // it was answered in Claude Code itself.
      if (s.pending && s.pending.tool === name) { settleWaiter(s, null); clearPending(s, 'allowed'); }
      const helper = body.agent_id ? 'Helper: ' : '';
      const step = addStep(s, { kind: 'tool', title: helper + d.title, detail: d.detail || undefined, state: 'running' });
      if (body.tool_use_id) s.openTools.set(String(body.tool_use_id), step.id);
      s.lastTool.set(name, step.id);
      if (!s.pending) { s.status = 'working'; s.activity = d.title; }
      break;
    }

    case 'PostToolUse':
    case 'PostToolUseFailure': {
      // Ran after a prompt you answered in Claude Code itself: drop Rail's card.
      if (s.pending && s.pending.tool === body.tool_name) { settleWaiter(s, null); clearPending(s, 'allowed'); }
      const stepId = s.openTools.get(String(body.tool_use_id ?? ''));
      const step = stepId ? s.steps.find((x) => x.id === stepId) : [...s.steps].reverse().find((x) => x.kind === 'tool' && x.state === 'running');
      const failed = event === 'PostToolUseFailure' || body.tool_response?.is_error === true || body.tool_response?.interrupted === true;
      if (step) step.state = failed ? 'error' : 'ok';
      if (body.tool_use_id) s.openTools.delete(String(body.tool_use_id));
      if (!s.pending) { s.status = 'working'; s.activity = 'Thinking'; }
      break;
    }

    case 'PermissionRequest': {
      const name = String(body.tool_name ?? '');
      settleWaiter(s, null); // a newer request replaces an unanswered one
      const isQuestion = name === 'AskUserQuestion';
      const d = describeTool(name, body.tool_input, s.cwd);
      const pending: AgentPending = {
        id: uid(),
        kind: isQuestion ? 'question' : 'permission',
        tool: name,
        title: isQuestion ? 'Claude has a question' : d.title,
        detail: isQuestion ? '' : d.detail,
        questions: isQuestion ? parseQuestions(body.tool_input) : undefined,
        canAlways: Array.isArray(body.permission_suggestions) && body.permission_suggestions.length > 0,
        at: Date.now(),
      };
      s.pending = pending;
      s.status = isQuestion ? 'question' : 'permission';
      s.activity = isQuestion ? 'Has a question for you' : `Wants to: ${d.title}`;
      // The tool's own step (from PreToolUse) now waits on you.
      const toolStep = s.steps.find((x) => x.id === s.lastTool.get(name) && x.state === 'running');
      if (toolStep) toolStep.state = 'waiting';
      else addStep(s, { kind: 'tool', title: d.title, detail: d.detail || undefined, state: 'waiting' });
      const timer = setTimeout(() => {
        if (s.waiter?.pendingId === pending.id) { settleWaiter(s, null); clearPending(s, 'allowed'); changed(); }
      }, HOLD_SECONDS * 1000 - 5000);
      s.waiter = { pendingId: pending.id, input: body, res, timer };
      // curl goes away when Claude Code stops waiting (answered in its own
      // window, or the turn was interrupted): drop the card.
      res.on('close', () => {
        if (s.waiter?.pendingId === pending.id) {
          s.waiter = null;
          clearTimeout(timer);
          clearPending(s, 'allowed');
          if (s.status === 'permission' || s.status === 'question') { s.status = 'working'; s.activity = 'Thinking'; }
          changed();
        }
      });
      onAttention(publicOf(s));
      changed();
      return; // answered later
    }

    case 'Notification': {
      const type = String(body.notification_type ?? '');
      if (type === 'idle_prompt' && !s.pending) { s.status = 'idle'; s.activity = 'Your turn'; }
      break;
    }

    case 'Stop': {
      settleWaiter(s, null);
      clearPending(s, 'allowed');
      for (const st of s.steps) if (st.state === 'running' || st.state === 'waiting') st.state = 'ok';
      s.openTools.clear();
      const text = typeof body.last_assistant_message === 'string' && body.last_assistant_message.trim() ? body.last_assistant_message.trim() : lastReplyFrom(body.transcript_path);
      if (text) { s.lastReply = clip(text, 6000); addStep(s, { kind: 'reply', title: clip(oneLine(text), 160), detail: text.length > 160 ? clip(text, 6000) : undefined }); }
      s.status = 'idle';
      s.activity = 'Done, your turn';
      break;
    }

    case 'SubagentStop':
      break;

    case 'SessionEnd':
      settleWaiter(s, null);
      clearPending(s, 'allowed');
      s.status = 'ended';
      s.activity = 'Session closed';
      break;
  }
  reply();
  changed();
}

function parseQuestions(input: any): AgentQuestion[] {
  const qs = Array.isArray(input?.questions) ? input.questions : [];
  return qs.map((q: any) => ({
    question: String(q.question ?? ''),
    header: String(q.header ?? ''),
    multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).map((o: any) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') })),
  }));
}

function publicOf(s: Internal): AgentSession {
  const { waiter: _w, openTools: _o, bundleId: _b, permissionMode: _p, ...pub } = s;
  return pub;
}

// ---- Answers from Rail ---------------------------------------------------------

const decisionOutput = (decision: object) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });

export function decide(sessionId: string, pendingId: string, choice: 'allow' | 'always' | 'deny', message?: string) {
  const s = sessions.get(sessionId);
  if (!s?.waiter || s.waiter.pendingId !== pendingId) return false;
  const suggestions = s.waiter.input?.permission_suggestions;
  const what = s.pending?.title ?? '';
  const decision = choice === 'deny'
    ? { behavior: 'deny', message: message?.trim() || 'The user said no from Rail.' }
    : choice === 'always' && Array.isArray(suggestions) && suggestions.length
      ? { behavior: 'allow', updatedPermissions: suggestions }
      : { behavior: 'allow' };
  settleWaiter(s, decisionOutput(decision));
  clearPending(s, choice === 'deny' ? 'denied' : 'allowed');
  s.status = 'working';
  s.activity = choice === 'deny' || !what ? 'Thinking' : what;
  s.updatedAt = Date.now();
  changed();
  return true;
}

// answers: question text -> chosen label(s), comma-separated for multi-select.
export function answer(sessionId: string, pendingId: string, answers: Record<string, string>) {
  const s = sessions.get(sessionId);
  if (!s?.waiter || s.waiter.pendingId !== pendingId) return false;
  const input = s.waiter.input?.tool_input ?? {};
  settleWaiter(s, decisionOutput({ behavior: 'allow', updatedInput: { ...input, answers } }));
  const summary = Object.values(answers).join(' · ');
  clearPending(s, 'allowed');
  addStep(s, { kind: 'note', title: `You answered: ${clip(summary, 120)}` });
  s.status = 'working';
  s.activity = 'Thinking';
  s.updatedAt = Date.now();
  changed();
  return true;
}

export function dismiss(sessionId: string) {
  const s = sessions.get(sessionId);
  if (!s) return;
  settleWaiter(s, null);
  sessions.delete(sessionId);
  changed();
}

export function clearEnded() {
  for (const [id, s] of sessions) if (s.status === 'ended' || (s.status === 'idle' && !s.pending)) { settleWaiter(s, null); sessions.delete(id); }
  changed();
}

// Where "jump back" goes: the app it runs in, opened on its folder.
export function jumpTarget(sessionId: string): { bundleId: string; cwd: string; host: string } | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return { bundleId: s.bundleId, cwd: s.cwd, host: s.host };
}

// ---- Installing Rail's hooks into Claude Code ------------------------------------

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop', 'SessionEnd'];
const MARK = `127.0.0.1:${PORT}/hook`;

export function hookCommand() {
  // Never fails: if Rail isn't running, curl exits quietly and Claude Code
  // carries on as usual. __CFBundleIdentifier names the app Claude Code runs
  // in (VS Code, iTerm…), so Rail can jump back to it.
  return `curl -s -m ${HOLD_SECONDS} -X POST -H 'Content-Type: application/json' -H 'X-Rail-Token: ${token}' ` +
    `-H "X-Rail-Bundle: \${__CFBundleIdentifier:-}" -H "X-Rail-Term: \${TERM_PROGRAM:-}" -H "X-Rail-Entry: \${CLAUDE_CODE_ENTRYPOINT:-}" ` +
    `--data-binary @- http://${MARK} 2>/dev/null || true`;
}

function readSettings(): any {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Couldn’t read ${settingsPath.replace(os.homedir(), '~')}: ${(err as Error).message}`);
  }
}

const isOurs = (h: any) => typeof h?.command === 'string' && h.command.includes(MARK);

export function hooksInstalled() {
  try {
    const hooks = readSettings().hooks ?? {};
    return EVENTS.every((e) => (hooks[e] ?? []).some((m: any) => (m.hooks ?? []).some((h: any) => isOurs(h) && h.command.includes(token))));
  } catch {
    return false;
  }
}

function stripOurs(hooks: Record<string, any[]>) {
  for (const e of Object.keys(hooks)) {
    hooks[e] = (hooks[e] ?? [])
      .map((m: any) => ({ ...m, hooks: (m.hooks ?? []).filter((h: any) => !isOurs(h)) }))
      .filter((m: any) => m.hooks.length);
    if (!hooks[e].length) delete hooks[e];
  }
}

export function installHooks() {
  const settings = readSettings();
  const hooks: Record<string, any[]> = settings.hooks ?? {};
  stripOurs(hooks);
  for (const e of EVENTS) {
    const entry: any = { hooks: [{ type: 'command', command: hookCommand(), timeout: e === 'PermissionRequest' ? HOLD_SECONDS : 10 }] };
    if (e === 'PreToolUse' || e === 'PostToolUse' || e === 'PostToolUseFailure' || e === 'PermissionRequest') entry.matcher = '*';
    hooks[e] = [...(hooks[e] ?? []), entry];
  }
  settings.hooks = hooks;
  writeSettings(settings);
  changed();
}

export function uninstallHooks() {
  const settings = readSettings();
  if (settings.hooks) {
    stripOurs(settings.hooks);
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
  }
  writeSettings(settings);
  changed();
}

function writeSettings(settings: any) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  if (fs.existsSync(settingsPath)) fs.copyFileSync(settingsPath, settingsPath + '.rail-backup');
  const tmp = settingsPath + '.rail-tmp';
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(tmp, settingsPath);
}

// ---- Server ------------------------------------------------------------------------

export function start(opts: {
  dataDir: string;
  settingsPath?: string;
  onChange: (snap: AgentsSnapshot) => void;
  onAttention: (s: AgentSession) => void;
}) {
  dataDir = opts.dataDir;
  if (opts.settingsPath) settingsPath = opts.settingsPath;
  onChange = opts.onChange;
  onAttention = opts.onAttention;
  token = loadToken();

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/hook') { res.writeHead(404).end(); return; }
    // Only Rail's own hook command knows the token; a web page can't set it
    // (custom headers on a cross-site POST need a CORS preflight we never allow).
    if (req.headers['x-rail-token'] !== token) { res.writeHead(403).end(); return; }
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_LIMIT) { res.writeHead(413).end(); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body: any;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400).end(); return; }
      try { handleHook(body, req.headers, res); } catch (err) {
        console.error('[rail] agent hook failed', err);
        if (!res.writableEnded) res.writeHead(200).end('{}');
      }
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;
  server.on('error', (err: NodeJS.ErrnoException) => {
    listening = false;
    lastError = err.code === 'EADDRINUSE' ? `Port ${PORT} is in use by another app, so Rail can’t hear Claude Code.` : err.message;
    changed();
  });
  server.listen(PORT, '127.0.0.1', () => { listening = true; lastError = null; changed(); });
  return server;
}

function loadToken() {
  const file = path.join(dataDir, 'agents-token');
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(t)) return t;
  } catch { /* first run */ }
  const t = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, t, { mode: 0o600 });
  return t;
}

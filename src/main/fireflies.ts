// Fireflies GraphQL client and the text formats Rail copies/downloads (PRD §6.3).
// Field shapes verified against the live API (Nov 2026):
//   date: epoch ms · duration: minutes (float) · summary.action_items: string
//   sentences.start_time: seconds

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ENDPOINT = 'https://api.fireflies.ai/graphql';

export interface MeetingListItem {
  id: string;
  title: string;
  date: number;
  duration: number;
  participants: string[];
  transcript_url: string;
}

export interface MeetingDetail extends MeetingListItem {
  summary: { overview: string | null; action_items: string | null; keywords: string[] | null } | null;
  sentences: { speaker_name: string | null; text: string; start_time: number }[] | null;
}

export class FirefliesError extends Error {
  constructor(message: string, readonly auth = false) {
    super(message);
  }
}

async function gql<T>(key: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new FirefliesError('Can’t reach Fireflies. Check your connection.');
  }
  const body = await res.json().catch(() => null);
  const err = body?.errors?.[0];
  if (res.status === 401 || res.status === 403 || /auth|api key|token/i.test(err?.message ?? '')) {
    throw new FirefliesError('Fireflies rejected the API key.', true);
  }
  if (err) throw new FirefliesError(err.message ?? 'Fireflies returned an error.');
  if (!res.ok || !body?.data) throw new FirefliesError(`Fireflies error (${res.status}).`);
  return body.data as T;
}

const LIST_FIELDS = 'id title date duration participants transcript_url';

export async function listMeetings(key: string, search?: string): Promise<MeetingListItem[]> {
  const q = search?.trim();
  const data = await gql<{ transcripts: MeetingListItem[] }>(
    key,
    `query($limit: Int, $keyword: String) { transcripts(limit: $limit, keyword: $keyword) { ${LIST_FIELDS} } }`,
    { limit: 50, keyword: q || undefined },
  );
  return data.transcripts ?? [];
}

const detailCache = new Map<string, MeetingDetail>();

export async function getMeeting(key: string, id: string): Promise<MeetingDetail> {
  const hit = detailCache.get(id);
  if (hit) return hit;
  const data = await gql<{ transcript: MeetingDetail }>(
    key,
    `query($id: String!) { transcript(id: $id) {
      ${LIST_FIELDS}
      summary { overview action_items keywords }
      sentences { speaker_name text start_time }
    } }`,
    { id },
  );
  if (!data.transcript) throw new FirefliesError('Meeting not found.');
  detailCache.set(id, data.transcript);
  return data.transcript;
}

/**
 * Signed audio URL for the player. Fireflies only returns it on paid plans and
 * it expires (~24h), so it's fetched per open and never cached. Null when the
 * plan or meeting has no audio.
 */
export async function getAudioUrl(key: string, id: string): Promise<string | null> {
  try {
    const data = await gql<{ transcript: { audio_url: string | null } | null }>(
      key,
      `query($id: String!) { transcript(id: $id) { audio_url } }`,
      { id },
    );
    return data.transcript?.audio_url || null;
  } catch (e) {
    if (e instanceof FirefliesError && e.auth) throw e;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Live meetings (recorded right now by the Fireflies app or its bot)
// ---------------------------------------------------------------------------

export interface ActiveMeeting {
  id: string;
  title: string;
  meeting_link: string | null;
  start_time: string | null;
  end_time: string | null;
  state: string | null;
}

export async function activeMeetings(key: string): Promise<ActiveMeeting[]> {
  const data = await gql<{ active_meetings: ActiveMeeting[] | null }>(
    key,
    `{ active_meetings { id title meeting_link start_time end_time state } }`,
  );
  return data.active_meetings ?? [];
}

export type LiveSentence = { speaker_name: string | null; text: string; start_time: number };

/** Point-in-time snapshot of a live meeting's transcript; null until Fireflies has one. */
export async function liveTranscript(key: string, id: string): Promise<LiveSentence[] | null> {
  try {
    const data = await gql<{ transcript: { sentences: LiveSentence[] | null } | null }>(
      key,
      `query($id: String!) { transcript(id: $id) { sentences { speaker_name text start_time } } }`,
      { id },
    );
    return data.transcript?.sentences ?? null;
  } catch (e) {
    if (e instanceof FirefliesError && e.auth) throw e;
    return null;
  }
}

export function liveText(title: string, sentences: LiveSentence[]) {
  return transcriptText({ sentences } as MeetingDetail);
}

export function liveClaudePrompt(title: string, sentences: LiveSentence[]) {
  return `Here's the live transcript so far from "${title}" (still in progress):\n\n${liveText(title, sentences)}`;
}

export function clearCache() {
  detailCache.clear();
}

export async function validateKey(key: string) {
  await gql(key, '{ transcripts(limit: 1) { id } }');
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

function stamp(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}

export function formatDate(ms: number) {
  return new Date(ms).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** `Speaker [mm:ss]: text`, one line per sentence. */
export function transcriptText(m: MeetingDetail) {
  return (m.sentences ?? [])
    .map((s) => `${s.speaker_name || 'Speaker'} [${stamp(s.start_time)}]: ${s.text}`)
    .join('\n');
}

/** Overview, action items and keywords as Markdown. */
export function summaryMarkdown(m: MeetingDetail) {
  const parts = [`# ${m.title}`, `_${formatDate(m.date)} · ${Math.round(m.duration)} min_`];
  if (m.summary?.overview) parts.push(`## Overview\n\n${m.summary.overview.trim()}`);
  if (m.summary?.action_items) parts.push(`## Action items\n\n${m.summary.action_items.trim()}`);
  if (m.summary?.keywords?.length) parts.push(`## Keywords\n\n${m.summary.keywords.join(', ')}`);
  parts.push(`[Open in Fireflies](${m.transcript_url})`);
  return parts.join('\n\n');
}

export function claudePrompt(m: MeetingDetail) {
  const day = new Date(m.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `Here's the transcript from ${m.title} on ${day}:\n\n${summaryMarkdown(m)}\n\n## Transcript\n\n${transcriptText(m)}`;
}

/** Saves to ~/Documents/Rail/Meetings/YYYY-MM-DD – Title.(md|txt); returns the path. */
export function saveMeeting(m: MeetingDetail, format: 'md' | 'txt') {
  const dir = path.join(os.homedir(), 'Documents', 'Rail', 'Meetings');
  fs.mkdirSync(dir, { recursive: true });
  const d = new Date(m.date);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const safeTitle = m.title.replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Meeting';
  const file = path.join(dir, `${ymd} – ${safeTitle}.${format}`);
  const body = format === 'md'
    ? `${summaryMarkdown(m)}\n\n## Transcript\n\n${transcriptText(m)}\n`
    : `${transcriptText(m)}\n`;
  fs.writeFileSync(file, body);
  return file;
}

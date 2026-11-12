import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Non-secret settings only. Secrets (API keys, M4+) go through safeStorage.
export interface Config {
  widthPct: number; // 0.16–0.28 of the display work area
  splitRatio: number; // Claude's share of the Work space height
  collapsed: 'none' | 'claude' | 'notion';
  alwaysOnTop: boolean;
  activeSpace: number;
  notionLastUrl: string | null;
  notionTrail: { url: string; title: string }[]; // recent Notion pages, newest first
  loginItemInitialized: boolean; // set once we've applied the open-at-login default
  notionLinksInitialized: boolean; // Rail made itself the notion:// handler once
  calendarsOn: Record<string, boolean>; // Calendar space: per-calendar on/off (else Google's own setting)
  slackNoticeShown: boolean; // one-time "turn off Slack desktop notifications" tip
  spacesVersion: number; // 2 = Claude and Notion are separate spaces
}

const DEFAULTS: Config = {
  widthPct: 0.2,
  splitRatio: 0.6,
  collapsed: 'none',
  alwaysOnTop: false,
  activeSpace: 0,
  notionLastUrl: null,
  notionTrail: [],
  loginItemInitialized: false,
  slackNoticeShown: false,
  notionLinksInitialized: false,
  calendarsOn: {},
  spacesVersion: 1,
};

const file = () => path.join(app.getPath('userData'), 'config.json');

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const cfg: Config = { ...DEFAULTS, ...raw };
    // v2 split the Work space into Claude and Notion: later spaces moved up one.
    if (cfg.spacesVersion < 2) {
      if (cfg.activeSpace >= 1) cfg.activeSpace += 1;
      cfg.spacesVersion = 2;
    }
    return cfg;
  } catch {
    return { ...DEFAULTS };
  }
}

let timer: NodeJS.Timeout | undefined;
export function saveConfig(cfg: Config, immediate = false) {
  const write = () => {
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      fs.writeFileSync(file(), JSON.stringify(cfg, null, 2));
    } catch (err) {
      console.error('[rail] could not save config', err);
    }
  };
  clearTimeout(timer);
  if (immediate) write();
  else timer = setTimeout(write, 400);
}

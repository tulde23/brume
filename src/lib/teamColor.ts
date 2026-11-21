import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from '@/db';

/**
 * Scoresheets don't say a team's colours, so each team gets a steady colour from its
 * name until the scorekeeper picks one. All dark enough for white text on top.
 */
export const TEAM_COLORS = [
  { name: 'Maroon', value: '#8C2F2F' },
  { name: 'Royal', value: '#2F5DA8' },
  { name: 'Forest', value: '#2F6F3E' },
  { name: 'Purple', value: '#4B3F72' },
  { name: 'Gold', value: '#8A6A00' },
  { name: 'Teal', value: '#1F6E75' },
  { name: 'Orange', value: '#B4572A' },
  { name: 'Navy', value: '#1F2F55' },
  { name: 'Red', value: '#B42318' },
  { name: 'Grey', value: '#5C574E' },
];

export function defaultTeamColor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length].value;
}

const settingKey = (key: string) => `team.color.${key}`;

/** Colours for many teams at once: picked ones, else the default. */
export async function teamColors(db: SQLiteDatabase, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = (await getSetting(db, settingKey(k))) ?? defaultTeamColor(k);
  return out;
}

export const setTeamColor = (db: SQLiteDatabase, key: string, color: string) => setSetting(db, settingKey(key), color);

/** "Hawks" → "HAW"; "North Rams" → "NR". */
export function teamAbbr(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? '?').slice(0, 3).toUpperCase();
}

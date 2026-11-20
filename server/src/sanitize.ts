import { CATALOG as BASKETBALL, LIBRARY } from '@inkstat/basketball';
import { TRACK_CATALOG } from '@inkstat/track';
import { z } from 'zod';

import { ApiError } from './errors';

/**
 * What a shared template may carry. A template is made on a filled-in page, and its
 * anchors come from that page's text, which can include players' names (minors). So a
 * shared layout keeps only:
 *   - part boxes for parts the sport's catalog knows;
 *   - anchors whose text is printed scoresheet vocabulary (catalog labels and the words
 *     on the built-in reference books), or a run of those words, or an ordinal.
 * Never the photo.
 */

const CATALOGS = { basketball: BASKETBALL, track: TRACK_CATALOG } as const;
export type Sport = keyof typeof CATALOGS;
export const SPORTS = Object.keys(CATALOGS) as Sport[];

const GENERIC = [
  'home', 'visitor', 'visitors', 'away', 'team', 'teams', 'score', 'scores', 'scorebook', 'official', 'officials',
  'date', 'time', 'place', 'played', 'at', 'site', 'location', 'game', 'no', 'number', 'coach', 'coaches', 'asst',
  'assistant', 'referee', 'umpire', 'scorer', 'timer', 'final', 'total', 'totals', 'half', 'quarter', 'quarters',
  'period', 'periods', 'ot', 'overtime', 'first', 'second', 'third', 'fourth', 'timeouts', 'timeout', 'time', 'outs',
  'fouls', 'foul', 'team', 'technical', 'technicals', 'bench', 'running', 'possession', 'arrow', 'field', 'goals',
  'free', 'throws', 'throw', 'points', 'pts', 'fg', 'ft', 'tp', 'player', 'players', 'name', 'names', 'starters',
  'in', 'out', 'and', 'of', 'the', 'vs', 'versus', 'by', 'for', 'per', 'event', 'heat', 'lane', 'round', 'meet',
  'athlete', 'school', 'mark', 'result', 'results', 'wind', 'seed', 'bib', 'division', 'flight', 'attempt', 'attempts',
  'best', 'height', 'distance', 'jump', 'throws', 'relay', 'split', 'splits', 'place', 'pl', 'boys', 'girls', 'mens',
  'womens', 'varsity', 'jv', 'signature', 'remarks', 'notes', 'league', 'conference', 'tournament',
];

const words = new Set<string>(GENERIC);
for (const c of Object.values(CATALOGS)) {
  for (const p of c.parts) {
    for (const l of p.labels) words.add(l.toLowerCase().replace(/[^a-z0-9]/g, ''));
    for (const w of p.name.toLowerCase().split(/[^a-z0-9]+/)) if (w) words.add(w);
  }
}
for (const layout of LIBRARY) for (const a of layout.anchors) if (/^[a-z]+$/.test(a.text)) words.add(a.text);
words.delete('');

/** True when the text is vocabulary words run together (anchors join a whole line's letters). */
export function isPrintedVocabulary(text: string): boolean {
  if (/^\d(st|nd|rd|th)$/.test(text) || /^\d{1,2}$/.test(text)) return true;
  if (!/^[a-z]+$/.test(text) || text.length > 60) return false;
  const ok: boolean[] = new Array(text.length + 1).fill(false);
  ok[0] = true;
  for (let i = 1; i <= text.length; i++) {
    for (let j = Math.max(0, i - 16); j < i && !ok[i]; j++) if (ok[j] && words.has(text.slice(j, i))) ok[i] = true;
  }
  return ok[text.length];
}

const unit = z.number().min(0).max(1);
const box = z.object({ x: unit, y: unit, w: unit, h: unit });
const band = z.object({ x: unit, w: unit });

export const layoutSchema = z.object({
  sport: z.enum(SPORTS as [Sport, ...Sport[]]),
  name: z.string().trim().min(1).max(80),
  enabled: z.array(z.string().max(40)).max(60),
  parts: z.record(z.string().max(40), z.union([box, band])),
  variants: z.record(z.string().max(40), z.string().max(40)).default({}),
  anchors: z.array(z.object({ text: z.string().max(80), x: unit, y: unit })).max(400).optional(),
  builtinId: z.string().max(60).optional(),
});

export type SharedLayout = z.infer<typeof layoutSchema>;

/** Drops unknown parts and every anchor that is not printed vocabulary; refuses a layout with nothing left. */
export function sanitizeLayout(input: unknown): { layout: SharedLayout; droppedAnchors: number } {
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) {
    throw ApiError.badRequest('InvalidTemplate', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const l = parsed.data;
  const known = new Set<string>(CATALOGS[l.sport].parts.map((p) => p.id));
  const parts = Object.fromEntries(Object.entries(l.parts).filter(([id]) => known.has(id)));
  if (!Object.keys(parts).length) throw ApiError.badRequest('InvalidTemplate', 'The template has no marked parts.');
  const anchors = (l.anchors ?? []).filter((a) => isPrintedVocabulary(a.text));
  return {
    layout: {
      sport: l.sport,
      name: l.name,
      enabled: l.enabled.filter((id) => known.has(id)),
      parts,
      variants: Object.fromEntries(Object.entries(l.variants).filter(([id]) => known.has(id))),
      ...(anchors.length ? { anchors } : {}),
      ...(l.builtinId ? { builtinId: l.builtinId } : {}),
    },
    droppedAnchors: (l.anchors?.length ?? 0) - anchors.length,
  };
}

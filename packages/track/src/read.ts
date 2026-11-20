import {
  markedParts,
  resultsFor,
  variantOf,
  type Band,
  type DocumentTemplate,
  type ExtractionRun,
  type FieldSchema,
  type NormRect,
  type RegionSpec,
  type Template,
} from '@inkstat/ocr-engine';

import { TRACK_CATALOG, type TrackPart } from './catalog';
import { parseMark, type MarkKind, type ParsedMark } from './marks';

/**
 * Reading a meet sheet with a track template. Lessons carried over from
 * basketball: each table column is read beside the athlete name in its own
 * narrow pass (one wide image of many columns loses values), and each event
 * detail is read from its own small box, enlarged.
 */

export type TrackTemplate = Template<TrackPart>;

export interface AthleteResult {
  name: string;
  team: string | null;
  lane: string | null;
  bib: string | null;
  seed: ParsedMark | null;
  result: ParsedMark | null;
  place: number | null;
}

export interface TrackPage {
  eventName: string | null;
  heat: string | null;
  round: string | null;
  division: string | null;
  meet: string | null;
  date: string | null;
  wind: string | null;
  kind: MarkKind;
  athletes: AthleteResult[];
  /** Regions the model failed on entirely. */
  failures: string[];
}

const SYSTEM =
  'You transcribe track and field meet sheets exactly as written, printed or handwritten. ' +
  'You never invent athletes, times or marks. If a value is blank or you cannot read it, use null.';

/** Columns read beside the athlete name, each in its own pass: [part, answer key, description]. */
const COLUMN_PASSES: [TrackPart, string, string][] = [
  ['result', 'result', 'the final time or mark exactly as written (e.g. 12.34, 1:02.45, 18-04.50, 5.62m, DNF, DQ)'],
  ['place', 'place', 'the place number'],
  ['team', 'team', 'the team, school or club'],
  ['lane', 'lane', 'the lane or competition order'],
  ['bib', 'bib', 'the bib or competitor number'],
  ['seed', 'seed', 'the seed time or entry mark exactly as written'],
];

const DETAILS: [TrackPart, string, string][] = [
  ['eventName', 'event', 'event name (e.g. Girls 100 Meter Dash)'],
  ['heat', 'heat', 'heat, flight or section'],
  ['round', 'round', 'round (prelims, semis or finals)'],
  ['division', 'division', 'division (boys/girls, varsity/JV, age group)'],
  ['meet', 'meet', 'meet name'],
  ['date', 'date', 'date'],
  ['wind', 'wind', 'wind reading (e.g. +1.2, -0.4)'],
];

const str = (description: string): FieldSchema => ({ type: 'string', nullable: true, description });

export const passRegion = (part: TrackPart) => `athletes_${part}`;
export const detailRegion = (part: TrackPart) => `event_${part}`;

export function documentFor(t: TrackTemplate): DocumentTemplate {
  const has = (id: TrackPart) => markedParts(t, TRACK_CATALOG).includes(id) && TRACK_CATALOG.parts.find((p) => p.id === id)!.status !== 'planned';
  const rows = t.parts.rows as NormRect | undefined;
  const athlete = t.parts.athlete as Band | undefined;
  const regions: RegionSpec[] = [];

  if (rows && athlete && has('athlete')) {
    for (const [part, key, description] of COLUMN_PASSES) {
      if (!has(part)) continue;
      const band = t.parts[part] as Band;
      regions.push({
        id: passRegion(part),
        label: `Athletes: ${TRACK_CATALOG.parts.find((p) => p.id === part)!.name.toLowerCase()}`,
        rect: rows,
        columns: [
          { ...athlete, label: 'athlete name' },
          { ...band, label: description },
        ].sort((a, b) => a.x - b.x),
        joinColumns: true,
        tiles: { targetAspect: 1.2, overlap: 0.1, minRows: 1, maxRows: 12 },
        maxImageSide: 2048,
        maxTokens: 400,
        prompt:
          'These are rows from a track and field meet sheet. Each row is one athlete. ' +
          `For each row with an athlete, give the athlete's name and ${description}. ` +
          'Use null for a blank cell. Skip empty rows and printed headings.',
        schema: {
          type: 'object',
          properties: {
            athletes: {
              type: 'array',
              maxItems: 12,
              items: { type: 'object', properties: { name: str('athlete name'), [key]: str(description) } },
            },
          },
        },
      });
    }
  }

  for (const [part, key, label] of DETAILS) {
    if (!has(part)) continue;
    regions.push({
      id: detailRegion(part),
      label: TRACK_CATALOG.parts.find((p) => p.id === part)!.name,
      rect: t.parts[part] as NormRect,
      maxImageSide: 1024,
      maxTokens: 50,
      prompt: `This box is from a track and field meet sheet and holds the ${label}. Copy it exactly as written. Use null if it is blank.`,
      schema: { type: 'object', properties: { [key]: str(label) } },
    });
  }

  return { id: 'track.meet-sheet', name: 'Track and field meet sheet', version: 1, systemPrompt: SYSTEM, regions };
}

/** Same athlete in two passes or overlapping strips: compare names loosely. */
const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '');

export function readTrackPage(t: TrackTemplate, run: ExtractionRun): TrackPage {
  const kind = (variantOf(t, TRACK_CATALOG, 'result') ?? 'time') as MarkKind;
  const failures: string[] = [];
  const byName = new Map<string, AthleteResult>();
  const order: string[] = [];

  for (const [part, key] of COLUMN_PASSES) {
    const tiles = resultsFor(run, passRegion(part));
    for (const tile of tiles) {
      const rows = (tile.data as { athletes: Record<string, string | null>[] } | null)?.athletes;
      if (!rows) {
        failures.push(`${part} strip ${tile.tileIndex + 1}`);
        continue;
      }
      for (const r of rows) {
        const name = (r.name ?? '').trim();
        const k = nameKey(name);
        if (!k) continue;
        if (!byName.has(k)) {
          byName.set(k, { name, team: null, lane: null, bib: null, seed: null, result: null, place: null });
          order.push(k);
        }
        const a = byName.get(k)!;
        const v = r[key];
        if (v == null || v === '') continue;
        if (part === 'result') a.result ??= parseMark(v, kind);
        else if (part === 'seed') a.seed ??= parseMark(v, kind);
        else if (part === 'place') a.place ??= Number(String(v).replace(/[^0-9]/g, '')) || null;
        else if (part === 'team') a.team ??= v;
        else if (part === 'lane') a.lane ??= v;
        else if (part === 'bib') a.bib ??= v;
      }
    }
  }

  const detail = (part: TrackPart, key: string): string | null => {
    const [r] = resultsFor(run, detailRegion(part));
    if (!r) return null;
    if (!r.data) failures.push(part);
    const v = (r.data as Record<string, string | null> | null)?.[key];
    return v && v.trim() ? v.trim() : null;
  };

  return {
    eventName: detail('eventName', 'event'),
    heat: detail('heat', 'heat'),
    round: detail('round', 'round'),
    division: detail('division', 'division'),
    meet: detail('meet', 'meet'),
    date: detail('date', 'date'),
    wind: detail('wind', 'wind'),
    kind,
    athletes: order.map((k) => byName.get(k)!),
    failures,
  };
}

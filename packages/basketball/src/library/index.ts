import { anchorsFrom, mapRect, matchLayout, type Anchor, type LayoutMatch, type NormRect, type TextLine } from '@brume/ocr-engine';

import { partSpec, type Band, type PartId, type ScorebookTemplate } from '../scorebook';
import championAnchors from './nfhs-champion.anchors.json';
import scoreRightAnchors from './scoreright.anchors.json';

/**
 * Built-in templates for common scorebooks. Each keeps the printed labels of a
 * reference page (anchors) and its boxes, both as fractions of that reference
 * image. A photo is matched by its labels and the boxes are mapped onto it, so
 * nothing has to be marked by hand for these books.
 *
 * Layouts only: no photos, names or scores are stored here.
 */
export interface BuiltinLayout {
  id: string;
  name: string;
  family: 'NFHS' | 'NCAA' | 'FIBA';
  description: string;
  anchors: Anchor[];
  enabled: PartId[];
  parts: Partial<Record<PartId, NormRect | Band>>;
  foulsKind: ScorebookTemplate['foulsKind'];
}

export const LIBRARY: BuiltinLayout[] = [
  {
    id: 'nfhs-champion',
    name: 'NFHS official scorebook (Champion)',
    family: 'NFHS',
    description: 'The NFHS-approved high school book: P1–P5 foul boxes, a scoring summary ending in TP, quarter scores above the table.',
    anchors: championAnchors,
    enabled: ['rows', 'names', 'points', 'fouls', 'teamName', 'coach', 'date', 'timeouts', 'teamFouls', 'quarters'],
    // Marked on the blank reference page (3000 x 3000 product image), checked by drawing them on it.
    parts: {
      rows: { x: 0.048, y: 0.392, w: 0.905, h: 0.388 },
      names: { x: 0.11, w: 0.211 },
      fouls: { x: 0.321, w: 0.065 },
      points: { x: 0.92, w: 0.032 },
      date: { x: 0.072, y: 0.174, w: 0.1, h: 0.027 },
      teamName: { x: 0.072, y: 0.203, w: 0.08, h: 0.028 },
      coach: { x: 0.05, y: 0.246, w: 0.06, h: 0.016 },
      quarters: { x: 0.175, y: 0.292, w: 0.777, h: 0.025 },
      timeouts: { x: 0.048, y: 0.806, w: 0.273, h: 0.022 },
      teamFouls: { x: 0.321, y: 0.793, w: 0.437, h: 0.014 },
    },
    foulsKind: 'boxes',
  },
  {
    id: 'nfhs-scoreright',
    name: 'Score-Right scorebook (NFHS style)',
    family: 'NFHS',
    description: 'Spiral book common in Georgia (GHSA) schools: numbered 1–5 foul boxes, PF and TP columns, a timeouts grid top right, no score-by-quarter box.',
    anchors: scoreRightAnchors,
    enabled: ['rows', 'names', 'points', 'fouls', 'teamName', 'coach', 'location', 'timeouts'],
    // Marked on a filled youth-league page (3264 x 1836 photo), checked by drawing them on it.
    parts: {
      rows: { x: 0.157, y: 0.178, w: 0.689, h: 0.785 },
      names: { x: 0.157, w: 0.15 },
      fouls: { x: 0.307, w: 0.054 },
      points: { x: 0.823, w: 0.022 },
      teamName: { x: 0.183, y: 0.024, w: 0.126, h: 0.022 },
      coach: { x: 0.183, y: 0.046, w: 0.126, h: 0.022 },
      location: { x: 0.183, y: 0.068, w: 0.126, h: 0.022 },
      timeouts: { x: 0.644, y: 0.028, w: 0.194, h: 0.107 },
    },
    foulsKind: 'boxes',
  },
];

/** A match is believable when enough labels line up: a share of the layout's anchors, and a minimum count. */
const MIN_SCORE = 0.25;
const MIN_INLIERS = 6;

export interface LibraryMatch {
  layout: BuiltinLayout;
  match: LayoutMatch;
}

/** The built-in layout this photo is, if any (best match by share of anchors found). */
export function matchLibrary(lines: TextLine[], library: BuiltinLayout[] = LIBRARY): LibraryMatch | null {
  let best: LibraryMatch | null = null;
  for (const layout of library) {
    const match = matchLayout(layout.anchors, lines);
    if (!match || match.score < MIN_SCORE || match.inliers < MIN_INLIERS) continue;
    if (!best || match.score > best.match.score) best = { layout, match };
  }
  return best;
}

/**
 * Parts mapped from reference coordinates onto a photo. Bands are mapped as the
 * full column (rows height) and keep only their new left edge and width.
 */
export function alignParts(
  parts: Partial<Record<PartId, NormRect | Band>>,
  match: LayoutMatch,
): Partial<Record<PartId, NormRect | Band>> {
  const rows = parts.rows as NormRect | undefined;
  const out: Partial<Record<PartId, NormRect | Band>> = {};
  for (const [id, v] of Object.entries(parts) as [PartId, NormRect | Band][]) {
    if (!v) continue;
    if (partSpec(id).shape === 'band') {
      if (!rows) continue;
      const r = mapRect(match.transform, { x: v.x, w: v.w, y: rows.y, h: rows.h });
      out[id] = { x: r.x, w: r.w };
    } else {
      out[id] = mapRect(match.transform, v as NormRect);
    }
  }
  return out;
}

/** Anchors to keep with a user's own template, so later photos can be lined up with it. */
export const anchorsForTemplate = (lines: TextLine[]): Anchor[] =>
  anchorsFrom(lines).map((a) => ({ text: a.text, x: Math.round(a.x * 1000) / 1000, y: Math.round(a.y * 1000) / 1000 }));

export type TemplateSource = 'aligned' | 'as-saved' | 'library' | 'none';

/**
 * The template to read this photo with:
 * - the user's template, lined up with this photo when its saved labels match;
 * - else the user's template as saved (older templates, or labels not found);
 * - with no template, a built-in book the photo is recognised as.
 */
export function templateForPhoto(
  template: ScorebookTemplate | null,
  lines: TextLine[] | null,
  library: BuiltinLayout[] = LIBRARY,
): { template: ScorebookTemplate | null; source: TemplateSource; detail: string } {
  if (template) {
    if (template.anchors?.length && lines) {
      const m = matchLayout(template.anchors, lines);
      if (m && m.score >= MIN_SCORE && m.inliers >= MIN_INLIERS) {
        return {
          template: { ...template, parts: alignParts(template.parts, m) },
          source: 'aligned',
          detail: `${m.inliers}/${m.total} labels`,
        };
      }
    }
    return { template, source: 'as-saved', detail: template.anchors?.length ? 'labels not found on this photo' : 'no saved labels' };
  }
  const lib = lines ? matchLibrary(lines, library) : null;
  if (!lib) return { template: null, source: 'none', detail: '' };
  const now = Date.now();
  return {
    template: {
      version: 2,
      id: `builtin-${lib.layout.id}`,
      name: lib.layout.name,
      enabled: lib.layout.enabled,
      parts: alignParts(lib.layout.parts, lib.match),
      foulsKind: lib.layout.foulsKind,
      photoUri: null,
      test: null,
      builtinId: lib.layout.id,
      createdAt: now,
      updatedAt: now,
    },
    source: 'library',
    detail: `${lib.layout.id} ${lib.match.inliers}/${lib.match.total} labels`,
  };
}

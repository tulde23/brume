import {
  alignTemplateParts as alignIn,
  anchorsForTemplate,
  matchLibrary as matchIn,
  templateForPhoto as forPhotoIn,
  type BuiltinLayout as GenericLayout,
  type LayoutMatch,
  type LibraryMatch as GenericMatch,
  type NormRect,
  type TemplateSource,
  type TextLine,
} from '@inkstat/ocr-engine';

import { CATALOG, SPORT_ID, type Band, type PartId, type ScorebookTemplate } from '../scorebook';
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
export type BuiltinLayout = GenericLayout<PartId>;
export type LibraryMatch = GenericMatch<PartId>;

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
    variants: { fouls: 'boxes' },
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
    variants: { fouls: 'boxes' },
  },
];

/** The built-in scorebook this photo is, if any. */
export const matchLibrary = (lines: TextLine[], library: BuiltinLayout[] = LIBRARY): LibraryMatch | null => matchIn(lines, library);

/** Parts mapped from reference coordinates onto a photo. */
export const alignParts = (parts: Partial<Record<PartId, NormRect | Band>>, match: LayoutMatch) => alignIn(parts, match, CATALOG);

export { anchorsForTemplate, type TemplateSource };

/**
 * The template to read this photo with: the user's template lined up with the
 * photo when its saved labels match, else as saved; with no template, a built-in
 * book the photo is recognised as.
 */
export const templateForPhoto = (template: ScorebookTemplate | null, lines: TextLine[] | null, library: BuiltinLayout[] = LIBRARY) =>
  forPhotoIn(template, lines, { id: SPORT_ID, catalog: CATALOG, library });

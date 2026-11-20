import { placeFromHeadings, type SportModule } from '@inkstat/ocr-engine';

import { TRACK_CATALOG, type TrackGroup, type TrackPart } from './catalog';
import { trackChecks } from './checks';
import { documentFor, readTrackPage } from './read';

export { TRACK_CATALOG, TRACK_PARTS, type TrackGroup, type TrackPart } from './catalog';
export { better, parseMark, type MarkKind, type ParsedMark } from './marks';
export { detailRegion, documentFor, passRegion, readTrackPage, type AthleteResult, type TrackPage, type TrackTemplate } from './read';
export { trackChecks } from './checks';

/** Track and field, plugged into the shared template machinery. */
export const TRACK: SportModule<TrackPart, TrackGroup> = {
  id: 'track',
  name: 'Track & field',
  pageNoun: 'meet sheet',
  catalog: TRACK_CATALOG,
  // Built-in layouts (e.g. meet-software result printouts) come with real samples.
  library: [],
  // Meet sheets are regular tables: start from the printed column headings.
  placeParts: (lines) => placeFromHeadings(lines, TRACK_CATALOG),
  documentFor,
  checks: (t, run) => trackChecks(t, readTrackPage(t, run)),
};

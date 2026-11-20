import { withRegionOverrides, type DocumentTemplate, type NormRect } from '@brume/ocr-engine';

/**
 * Where things are on one brand of scorebook, marked once by the user on a
 * photo of a page. Positions are fractions of the page (0..1), so they carry
 * over to later photos of the same book taken with the page filling the frame.
 */
export interface ScorebookLayout {
  version: 1;
  /** Box around the player rows only (no headers, no running-score grid). */
  table: NormRect;
  /** Vertical band over the jersey number and player name columns. */
  nameColumn: { x: number; w: number };
  /** Vertical band over the total points (TP / PTS) column. */
  pointsColumn: { x: number; w: number };
}

export const DEFAULT_LAYOUT: ScorebookLayout = {
  version: 1,
  table: { x: 0.06, y: 0.35, w: 0.88, h: 0.5 },
  nameColumn: { x: 0.08, w: 0.22 },
  pointsColumn: { x: 0.8, w: 0.08 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keep a layout inside the page and its columns inside the table. */
export function normalizeLayout(l: ScorebookLayout): ScorebookLayout {
  const x = clamp(l.table.x, 0, 0.95);
  const y = clamp(l.table.y, 0, 0.95);
  const table = { x, y, w: clamp(l.table.w, 0.05, 1 - x), h: clamp(l.table.h, 0.05, 1 - y) };
  const band = (c: { x: number; w: number }) => {
    const cx = clamp(c.x, table.x, table.x + table.w - 0.02);
    return { x: cx, w: clamp(c.w, 0.02, table.x + table.w - cx) };
  };
  return { version: 1, table, nameColumn: band(l.nameColumn), pointsColumn: band(l.pointsColumn) };
}

/**
 * The page template with the player table read from the marked box: only the
 * name and points columns, joined side by side, in near-square strips.
 */
export function applyScorebookLayout(template: DocumentTemplate, raw: ScorebookLayout): DocumentTemplate {
  const layout = normalizeLayout(raw);
  const [left, right] =
    layout.nameColumn.x <= layout.pointsColumn.x
      ? [
          { ...layout.nameColumn, label: 'jersey number and player name' },
          { ...layout.pointsColumn, label: 'total points (TP or PTS)' },
        ]
      : [
          { ...layout.pointsColumn, label: 'total points (TP or PTS)' },
          { ...layout.nameColumn, label: 'jersey number and player name' },
        ];
  return withRegionOverrides(template, {
    players: {
      rect: layout.table,
      columns: [left, right],
      joinColumns: true,
      // Near-square crops: nothing is squeezed when a model resizes to a square.
      tiles: { targetAspect: 1.2, overlap: 0.1, minRows: 2, maxRows: 10 },
      prompt:
        'These are rows from the player table of a basketball scorebook. Each row is one player. ' +
        'For each row with a player written in, give the jersey number, the name, and the total points. ' +
        'Fouls are not shown here: use null for f. Use null for any blank cell; do not write 0 unless a 0 is written. ' +
        'Skip empty rows.',
    },
  });
}

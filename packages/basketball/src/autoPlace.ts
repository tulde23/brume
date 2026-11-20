import type { NormRect, TextLine, TextWord } from '@brume/ocr-engine';

import type { Band, PartId } from './scorebook';

/**
 * Guess where each template part is from a page's printed labels (TEAM:, COACH:,
 * Player, No., TP, FOULS, TIMEOUTS, SCORE BY QUARTERS, Final...), as found by
 * on-device text recognition. Every guess is a starting point the user reviews;
 * parts whose labels aren't found are left out so the caller can use a default.
 */
export interface Placement {
  parts: Partial<Record<PartId, NormRect | Band>>;
  /** Parts placed from labels found on this page. */
  found: PartId[];
}

interface Word extends TextWord {
  line: number;
  index: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9.]/g, '');
const cy = (r: NormRect) => r.y + r.h / 2;
const cx = (r: NormRect) => r.x + r.w / 2;
const right = (r: NormRect) => r.x + r.w;
const bottom = (r: NormRect) => r.y + r.h;

function box(x0: number, y0: number, x1: number, y1: number): NormRect {
  const x = clamp(Math.min(x0, x1), 0, 0.99);
  const y = clamp(Math.min(y0, y1), 0, 0.99);
  return { x, y, w: clamp(Math.abs(x1 - x0), 0.01, 1 - x), h: clamp(Math.abs(y1 - y0), 0.01, 1 - y) };
}

function union(rs: NormRect[]): NormRect {
  const x0 = Math.min(...rs.map((r) => r.x));
  const y0 = Math.min(...rs.map((r) => r.y));
  return box(x0, y0, Math.max(...rs.map(right)), Math.max(...rs.map(bottom)));
}

export function placeParts(lines: TextLine[]): Placement {
  const words: Word[] = lines.flatMap((l, line) =>
    (l.words.length ? l.words : [{ text: l.text, rect: l.rect }]).map((w, index) => ({ ...w, line, index })),
  );
  const parts: Placement['parts'] = {};
  const found: PartId[] = [];
  const set = (id: PartId, v: NormRect | Band) => {
    parts[id] = v;
    found.push(id);
  };

  const all = (re: RegExp) => words.filter((w) => re.test(norm(w.text)));
  const next = (w: Word) => words.find((o) => o.line === w.line && o.index === w.index + 1);
  /** Words on the same printed row as r (centres within about a label's height). */
  const sameRow = (r: NormRect, w: Word) => Math.abs(cy(w.rect) - cy(r)) < Math.max(r.h, w.rect.h) * 0.9;
  const topmost = (ws: Word[]) => [...ws].sort((a, b) => a.rect.y - b.rect.y)[0];

  // ── Header labels: TEAM:, COACH:, PLAYED AT:, DATE: ──
  const teamLabel = topmost(all(/^team$/).filter((w) => !/^fouls?$/.test(norm(next(w)?.text ?? ''))));
  const coachLabel = topmost(all(/^coach$/));
  const playedLabel = topmost(
    [...all(/^played$/).filter((w) => /^at$/.test(norm(next(w)?.text ?? ''))), ...all(/^(location|site|gym)$/)],
  );
  const playedEnd = playedLabel && /^played$/.test(norm(playedLabel.text)) ? next(playedLabel) ?? playedLabel : playedLabel;
  const dateLabel = topmost(all(/^date$/));

  const header: { id: PartId; label?: Word; end?: Word }[] = [
    { id: 'teamName', label: teamLabel },
    { id: 'coach', label: coachLabel },
    { id: 'location', label: playedLabel, end: playedEnd },
    { id: 'date', label: dateLabel },
  ];
  const headerLabels = header.filter((h) => h.label).map((h) => h.label!);
  for (const h of header) {
    if (!h.label) continue;
    const r = h.label.rect;
    const start = right((h.end ?? h.label).rect) + 0.005;
    // The field runs to the next label on the same row, or the page edge.
    const nextOnRow = headerLabels
      .filter((o) => o !== h.label && sameRow(r, o) && o.rect.x > start)
      .sort((a, b) => a.rect.x - b.rect.x)[0];
    const end = nextOnRow ? nextOnRow.rect.x - 0.008 : Math.min(0.99, start + 0.3);
    // Handwriting sits on, and often above, the label's baseline.
    // Handwriting sits on the label's line and a little above it; not so far up that
    // scribbles over the header (possession arrows) get in.
    set(h.id, box(start, r.y - r.h * 0.8, end, bottom(r) + r.h * 0.4));
  }

  // ── Player table: header row with Player / No. / TP ──
  // Books also print "Player Scoring" in the running-score grid, so the table's
  // heading is the "Player" with a "No." beside it (else the lowest one).
  const isNo = (w: Word) => /^(no|no.|#|num|number)$/.test(norm(w.text));
  const players = all(/^players?$/).filter((w) => !/^scoring$/.test(norm(next(w)?.text ?? '')));
  const playerLabel =
    players.find((p) => words.some((w) => isNo(w) && sameRow(p.rect, w) && w.rect.x > p.rect.x)) ??
    [...players].sort((a, b) => b.rect.y - a.rect.y)[0];
  if (playerLabel) {
    const head = playerLabel.rect;
    const rowWords = words.filter((w) => sameRow(head, w) || Math.abs(w.rect.y - head.y) < head.h * 1.5);
    const noLabel = rowWords.filter(isNo).sort((a, b) => a.rect.x - b.rect.x)[0];
    const headerBottom = Math.max(...[playerLabel, noLabel].filter(Boolean).map((w) => bottom(w!.rect)));
    const top = headerBottom + head.h * 0.3;

    // Printed per-row cell labels (P1..P5, T1, Q1..Q4) mark how far the rows go.
    const cells = words.filter((w) => /^(p[1-6]|t[12]|q[1-4])$/.test(norm(w.text)) && w.rect.y > top);
    const lastCell = cells.length >= 6 ? Math.max(...cells.map((w) => bottom(w.rect))) : null;
    const end = lastCell ?? Math.min(0.97, top + 0.55);

    const headerRow = words.filter((w) => w.rect.y > head.y - head.h * 2 && w.rect.y < headerBottom + head.h);
    const tableRight = Math.min(0.99, Math.max(...headerRow.map((w) => right(w.rect)), right(head) + 0.3) + 0.01);
    // "Player" is centred over its column; the names start further left.
    const nameColumnEnd = noLabel ? noLabel.rect.x : right(head) + 0.05;
    const leftmost = words
      .filter((w) => w.rect.y > top && w.rect.y < end && right(w.rect) < nameColumnEnd + 0.01)
      .map((w) => w.rect.x);
    const tableLeft = Math.max(0, Math.min(head.x - 0.02, ...leftmost) - 0.012);
    set('rows', box(tableLeft, top, tableRight, end));

    const namesRight = noLabel ? right(noLabel.rect) + 0.012 : right(head) + 0.12;
    set('names', { x: tableLeft, w: clamp(namesRight - tableLeft, 0.05, 0.6) });

    // OCR often misreads the small printed "TP" (seen: "TE").
    const tp = headerRow.filter((w) => /^(tp|t.p.|te|tf|pts|pts.|points|tot|total|totalpoints)$/.test(norm(w.text))).sort((a, b) => b.rect.x - a.rect.x)[0];
    if (tp) {
      const w = Math.max(tp.rect.w * 1.8, 0.025);
      set('points', { x: clamp(cx(tp.rect) - w / 2, tableLeft, tableRight - w), w });
    }

    const foulBoxes = words.filter((w) => /^p[1-5]$/.test(norm(w.text)) && w.rect.y > head.y - 0.01 && w.rect.y < top + 0.08);
    const foulsLabel = headerRow.find((w) => /^fouls?$/.test(norm(w.text)));
    if (foulBoxes.length >= 3) {
      const u = union(foulBoxes.map((w) => w.rect));
      set('fouls', { x: u.x - 0.004, w: u.w + 0.008 });
    } else if (foulsLabel) {
      const w = Math.max(foulsLabel.rect.w * 1.4, 0.04);
      set('fouls', { x: clamp(cx(foulsLabel.rect) - w / 2, tableLeft, tableRight - w), w });
    }
  }
  const tableTop = (parts.rows as NormRect | undefined)?.y ?? 0.45;

  // ── Boxes above the table: TIMEOUTS, TEAM FOULS, SCORE BY QUARTERS ... FINAL ──
  const sectionLabels: { id: PartId; rect: NormRect }[] = [];
  const timeouts = topmost(all(/^(timeouts?|timeout|timeouts.)$/).filter((w) => w.rect.y < tableTop));
  if (timeouts) sectionLabels.push({ id: 'timeouts', rect: timeouts.rect });
  // "TEAM FOULS" on one line, or TEAM stacked over FOULS.
  const teamFoulsWord = all(/^team$/).find((w) => {
    if (w === teamLabel || w.rect.y > tableTop) return false;
    const n = next(w);
    if (n && /^fouls?$/.test(norm(n.text))) return true;
    return words.some((o) => /^fouls?$/.test(norm(o.text)) && Math.abs(o.rect.x - w.rect.x) < 0.03 && o.rect.y > w.rect.y && o.rect.y - bottom(w.rect) < w.rect.h * 1.5);
  });
  if (teamFoulsWord) sectionLabels.push({ id: 'teamFouls', rect: teamFoulsWord.rect });
  const score = topmost(
    all(/^score$/).filter((w) => w.rect.y < tableTop && /^by$/.test(norm(next(w)?.text ?? ''))),
  );
  const finalLabel = topmost(all(/^(final|total)$/).filter((w) => w.rect.y < tableTop));
  if (score) sectionLabels.push({ id: 'quarters', rect: score.rect });

  for (const s of sectionLabels) {
    const r = s.rect;
    const neighbours = sectionLabels.filter((o) => o !== s && o.rect.x > r.x + 0.02 && Math.abs(o.rect.y - r.y) < 0.06);
    const nextX = neighbours.length ? Math.min(...neighbours.map((o) => o.rect.x)) - 0.012 : null;
    // Each box ends at the next section's label, but no wider than a typical box.
    let x1 = Math.min(nextX ?? 1, r.x + (s.id === 'quarters' ? 0.3 : 0.24), 0.995);
    // The score boxes end just after the Final box.
    if (s.id === 'quarters' && finalLabel && finalLabel.rect.x > r.x) x1 = Math.min(0.995, right(finalLabel.rect) + 0.02);
    // About one row of labelled boxes under the label; never into the player table.
    const y1 = Math.min(tableTop - 0.01, r.y + 0.08);
    // The first quarter's cell ("1st Qtr", "1", "Q1") can sit left of the centred label.
    let x0 = r.x;
    if (s.id === 'quarters') {
      const firsts = words.filter(
        (w) => /^(1st|1stqtr|1q|q1|1|i)$/.test(norm(w.text)) && w.rect.y > r.y && w.rect.y < r.y + 0.05 && w.rect.x < r.x && w.rect.x > r.x - 0.06,
      );
      if (firsts.length) x0 = Math.min(...firsts.map((w) => w.rect.x));
    }
    set(s.id, box(x0 - 0.01, r.y - r.h * 0.5, x1, Math.max(y1, bottom(r) + 0.03)));
  }

  // TEAM FOULS is often printed too small to read; its boxes usually sit between
  // the timeouts and the score boxes. A guess, so it is not reported as found.
  if (!parts.teamFouls && parts.timeouts && parts.quarters) {
    const t = parts.timeouts as NormRect;
    const q = parts.quarters as NormRect;
    if (q.x - right(t) > 0.08) parts.teamFouls = box(right(t) + 0.01, Math.min(t.y, q.y), q.x - 0.01, Math.max(bottom(t), bottom(q)));
  }

  return { parts, found };
}

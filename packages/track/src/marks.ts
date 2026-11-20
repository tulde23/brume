/**
 * Track and field results as written: times (12.34, 1:02.45, 4:32.1h),
 * distances and heights (18-04.50 feet-inches, 5.62m metric), and the
 * non-results (DNF, DQ, DNS, NH, NM, FOUL, SCR).
 */

export type MarkKind = 'time' | 'distance' | 'height';

export interface ParsedMark {
  /** As written, trimmed. */
  text: string;
  /** Seconds for times; metres for distances and heights; null when not a result. */
  value: number | null;
  /** DNF, DQ, DNS, NH, NM, FOUL, SCR when that is what was written. */
  status: string | null;
}

const STATUSES = ['DNF', 'DQ', 'DNS', 'NH', 'NM', 'FOUL', 'SCR', 'FS', 'NT'];

export function parseMark(raw: string | null | undefined, kind: MarkKind): ParsedMark | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const upper = text.toUpperCase().replace(/[^A-Z]/g, '');
  const status = STATUSES.find((s) => upper === s || upper.startsWith(s)) ?? null;
  if (status) return { text, value: null, status };

  if (kind === 'time') {
    // h:mm:ss.xx, mm:ss.xx or ss.xx; a trailing h (hand-timed) or q/Q (qualified) is ignored.
    const m = text.replace(/[hHqQ*]+$/, '').match(/^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2}(?:\.\d{1,3})?)$/);
    if (!m) return { text, value: null, status: null };
    const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
    const value = parts.reduce((acc, p) => acc * 60 + p, 0);
    return { text, value: Math.round(value * 1000) / 1000, status: null };
  }

  // Metric: 5.62, 5.62m
  const metric = text.match(/^(\d{1,3}(?:\.\d{1,2})?)\s*m?$/i);
  // Imperial: 18-04.50, 18' 4.5", 18-4
  const imperial = text.match(/^(\d{1,3})\s*(?:-|'|ft)\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:"|in)?$/i);
  if (imperial) {
    const metres = (Number(imperial[1]) * 12 + Number(imperial[2])) * 0.0254;
    return { text, value: Math.round(metres * 1000) / 1000, status: null };
  }
  if (metric) return { text, value: Number(metric[1]), status: null };
  return { text, value: null, status: null };
}

/** Lower is better for times; higher for distances and heights. */
export const better = (kind: MarkKind, a: number, b: number) => (kind === 'time' ? a < b : a > b);

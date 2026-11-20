import type { NormRect } from '@brume/ocr-engine';

import { placeParts } from '../autoPlace';
// What ML Kit text recognition returned for the Stars training sheet on a Pixel 10 Pro
// (2026-11-20): real OCR, including its misreads ("TE" for TP, "Timeouts,").
import lines from './fixtures/stars-ocr.json';

describe('placeParts on real OCR of the Stars sheet', () => {
  const { parts, found } = placeParts(lines);
  const rect = (id: keyof typeof parts) => parts[id] as NormRect;
  const covers = (r: { x: number; w: number }, x: number) => r.x <= x && r.x + r.w >= x;

  it('places 10 of 11 parts from printed labels', () => {
    expect(found.sort()).toEqual(
      ['coach', 'date', 'fouls', 'location', 'names', 'points', 'quarters', 'rows', 'teamName', 'timeouts'].sort(),
    );
  });

  it('uses the table heading, not "Player Scoring" in the running-score grid', () => {
    // "Player" / "No." heading sits at y≈0.388; the first player row just below it.
    expect(rect('rows').y).toBeGreaterThan(0.395);
    expect(rect('rows').y).toBeLessThan(0.42);
    expect(rect('rows').y + rect('rows').h).toBeGreaterThan(0.89);
  });

  it('starts the rows at the names, which sit left of the centred "Player" heading', () => {
    expect(rect('rows').x).toBeLessThan(0.126);
    expect(covers(parts.names!, 0.13)).toBe(true);
    expect(covers(parts.names!, 0.25)).toBe(true); // jersey numbers
  });

  it('finds TP even though OCR read it as "TE"', () => {
    expect(covers(parts.points!, 0.824)).toBe(true);
    expect(parts.points!.w).toBeLessThan(0.04);
  });

  it('spans the P1-P5 foul boxes', () => {
    expect(covers(parts.fouls!, 0.452)).toBe(true);
    expect(covers(parts.fouls!, 0.505)).toBe(true);
  });

  it('covers every score box from 1st Qtr through Final', () => {
    const q = rect('quarters');
    expect(covers(q, 0.69)).toBe(true); // 1st Qtr: 15
    expect(covers(q, 0.86)).toBe(true); // Final: 50
  });

  it('guesses team fouls between timeouts and the score boxes without claiming it found them', () => {
    expect(parts.teamFouls).toBeDefined();
    expect(found).not.toContain('teamFouls');
  });
});

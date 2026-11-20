import { anchorsFrom, applyAffine, mapRect, matchLayout } from '../align';
import type { TextLine } from '../types';
// Real ML Kit OCR of a scoresheet, as returned on a Pixel 10 Pro.
import stars from './stars-ocr.json';

/** The same page photographed differently: smaller, shifted, rotated ~2°. */
function rephotograph(lines: TextLine[], s: number, dx: number, dy: number, deg: number): TextLine[] {
  const r = (deg * Math.PI) / 180;
  const move = (x: number, y: number) => ({
    x: s * (Math.cos(r) * (x - 0.5) - Math.sin(r) * (y - 0.5)) + 0.5 + dx,
    y: s * (Math.sin(r) * (x - 0.5) + Math.cos(r) * (y - 0.5)) + 0.5 + dy,
  });
  const rect = (q: { x: number; y: number; w: number; h: number }) => {
    const c = move(q.x + q.w / 2, q.y + q.h / 2);
    return { x: c.x - (q.w * s) / 2, y: c.y - (q.h * s) / 2, w: q.w * s, h: q.h * s };
  };
  return lines.map((l) => ({ text: l.text, rect: rect(l.rect), words: l.words.map((w) => ({ text: w.text, rect: rect(w.rect) })) }));
}

describe('matchLayout', () => {
  const anchors = anchorsFrom(stars);

  it('keeps printed words that say where they are, not repeated cell labels', () => {
    const texts = anchors.map((a) => a.text);
    expect(texts).toEqual(expect.arrayContaining(['team', 'player', 'fouls', 'final']));
    expect(texts).not.toContain('p1');
    expect(anchors.length).toBeGreaterThan(20);
  });

  it('finds the identity on the same page', () => {
    const m = matchLayout(anchors, stars)!;
    expect(m.score).toBeGreaterThan(0.9);
    const p = applyAffine(m.transform, 0.3, 0.6);
    expect(p.x).toBeCloseTo(0.3, 2);
    expect(p.y).toBeCloseTo(0.6, 2);
  });

  it('recovers a page shot smaller, shifted and slightly rotated', () => {
    const photo = rephotograph(stars, 0.85, 0.03, -0.02, 2);
    const m = matchLayout(anchors, photo)!;
    expect(m.score).toBeGreaterThan(0.7);
    // The TP column on the reference, mapped onto the new photo.
    const tp = mapRect(m.transform, { x: 0.812, y: 0.406, w: 0.025, h: 0.5 });
    const expectedCentre = rephotograph([{ text: 'x', rect: { x: 0.8245, y: 0.656, w: 0, h: 0 }, words: [] }], 0.85, 0.03, -0.02, 2)[0].rect;
    expect(tp.x + tp.w / 2).toBeCloseTo(expectedCentre.x, 2);
    expect(tp.y + tp.h / 2).toBeCloseTo(expectedCentre.y, 2);
  });

  it('does not match a page with different words', () => {
    const other: TextLine[] = [
      { text: 'Hello world', rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.02 }, words: [] },
      { text: 'Quarterly report', rect: { x: 0.5, y: 0.6, w: 0.2, h: 0.02 }, words: [] },
    ];
    expect(matchLayout(anchors, other)).toBeNull();
  });
});

import type { NormRect, TextLine } from '@inkstat/ocr-engine';

import { placeParts } from '../autoPlace';

// A page laid out like the Stars training sheet, in a 700 x 480 coordinate space.
const W = 700;
const H = 480;
const r = (x: number, y: number, w: number, h: number): NormRect => ({ x: x / W, y: y / H, w: w / W, h: h / H });
const line = (...words: [string, number, number, number?][]): TextLine => {
  const ws = words.map(([text, x, y, w]) => ({ text, rect: r(x, y, w ?? text.length * 5, 9) }));
  return { text: ws.map((w) => w.text).join(' '), rect: ws[0].rect, words: ws };
};

const page: TextLine[] = [
  line(['TEAM:', 18, 20]),
  line(['STARS', 56, 12, 40]),
  line(['COACH:', 262, 20]),
  line(['PLAYED', 440, 20], ['AT:', 474, 20]),
  line(['DATE:', 600, 20]),
  line(['Timeouts', 22, 95]),
  line(['TEAM', 232, 95], ['FOULS', 258, 95]),
  line(['SCORE', 482, 95], ['BY', 512, 95], ['QUARTERS', 526, 95]),
  line(['Final', 660, 107]),
  line(['Player', 60, 160], ['No.', 140, 160]),
  line(['FOULS', 322, 160]),
  line(['TP', 630, 160, 12]),
  ...Array.from({ length: 13 }, (_, i) =>
    line(['P1', 309, 180 + i * 22, 9], ['P2', 320, 180 + i * 22, 9], ['P3', 332, 180 + i * 22, 9], ['P4', 343, 180 + i * 22, 9], ['P5', 355, 180 + i * 22, 9]),
  ),
];

describe('placeParts', () => {
  const { parts, found } = placeParts(page);
  const box = (id: string) => parts[id as keyof typeof parts] as NormRect;

  it('finds every part this layout prints a label for', () => {
    expect(found.sort()).toEqual(['coach', 'date', 'fouls', 'location', 'names', 'points', 'quarters', 'rows', 'teamFouls', 'teamName', 'timeouts'].sort());
  });

  it('puts each header field between its label and the next one', () => {
    expect(box('teamName').x).toBeGreaterThan(r(18, 0, 25, 0).x);
    expect(box('teamName').x + box('teamName').w).toBeLessThan(262 / W);
    expect(box('location').x).toBeGreaterThan(489 / W);
    expect(box('date').x).toBeGreaterThan(625 / W);
  });

  it('starts the rows below the column headings and runs to the last printed row', () => {
    expect(box('rows').y).toBeGreaterThan(169 / H);
    expect(box('rows').y + box('rows').h).toBeGreaterThan((180 + 12 * 22) / H);
  });

  it('centres the points band on TP and spans the foul boxes', () => {
    const tp = parts.points!;
    expect(tp.x).toBeLessThan(636 / W);
    expect(tp.x + tp.w).toBeGreaterThan(636 / W);
    const f = parts.fouls!;
    expect(f.x).toBeLessThan(309 / W);
    expect(f.x + f.w).toBeGreaterThan(364 / W);
  });

  it('stretches the score box over the Final box, and stops the timeouts box at team fouls', () => {
    expect(box('quarters').x + box('quarters').w).toBeGreaterThan(685 / W);
    expect(box('timeouts').x + box('timeouts').w).toBeLessThan(232 / W);
  });

  it('places nothing it has no label for', () => {
    expect(placeParts([line(['Hello', 10, 10])]).found).toEqual([]);
  });
});

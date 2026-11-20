import type { NormRect, TextLine } from '@brume/ocr-engine';

import { LIBRARY, alignParts, matchLibrary, templateForPhoto } from '../library';
import champion from './fixtures/nfhs-champion-blank-ocr.json';
import stars from './fixtures/stars-ocr.json';

/** The blank NFHS page photographed smaller and off-centre. */
const moved = (lines: TextLine[], s: number, dx: number, dy: number): TextLine[] => {
  const r = (q: NormRect): NormRect => ({ x: q.x * s + dx, y: q.y * s + dy, w: q.w * s, h: q.h * s });
  return lines.map((l) => ({ text: l.text, rect: r(l.rect), words: l.words.map((w) => ({ text: w.text, rect: r(w.rect) })) }));
};

describe('template library', () => {
  it('recognises the NFHS book and not the Stars sheet', () => {
    expect(matchLibrary(champion)?.layout.id).toBe('nfhs-champion');
    expect(matchLibrary(stars)).toBeNull();
  });

  it('moves every box onto a photo framed differently', () => {
    const photo = moved(champion, 0.8, 0.1, 0.05);
    const m = matchLibrary(photo)!;
    expect(m.layout.id).toBe('nfhs-champion');
    const parts = alignParts(LIBRARY[0].parts, m.match);
    const rows = parts.rows as NormRect;
    expect(rows.x).toBeCloseTo(0.048 * 0.8 + 0.1, 2);
    expect(rows.y).toBeCloseTo(0.392 * 0.8 + 0.05, 2);
    expect(parts.points!.x).toBeCloseTo(0.92 * 0.8 + 0.1, 2);
    expect(parts.points!.w).toBeCloseTo(0.032 * 0.8, 2);
  });
});

describe('templateForPhoto', () => {
  const mine = {
    ...LIBRARY[0],
    version: 2 as const,
    id: 'mine',
    name: 'Mine',
    photoUri: null,
    test: null,
    createdAt: 0,
    updatedAt: 0,
    anchors: LIBRARY[0].anchors,
  };

  it("lines up the user's template with a photo framed differently", () => {
    const r = templateForPhoto(mine, moved(champion, 0.8, 0.1, 0.05));
    expect(r.source).toBe('aligned');
    expect((r.template!.parts.rows as NormRect).x).toBeCloseTo(0.048 * 0.8 + 0.1, 2);
  });

  it('falls back to the saved boxes when the labels are not on the photo', () => {
    expect(templateForPhoto(mine, stars).source).toBe('as-saved');
    expect(templateForPhoto({ ...mine, anchors: undefined }, champion).source).toBe('as-saved');
  });

  it('recognises a built-in book when there is no template', () => {
    const r = templateForPhoto(null, champion);
    expect(r.source).toBe('library');
    expect(r.template!.builtinId).toBe('nfhs-champion');
    expect(templateForPhoto(null, stars).source).toBe('none');
  });
});

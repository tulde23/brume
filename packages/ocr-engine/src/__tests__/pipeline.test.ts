import { tileRects, toPixels } from '../geometry';
import { resultsFor, runTemplate } from '../pipeline';
import type { DocumentTemplate, GenerateRequest, ImageOps, VisionBackend } from '../types';

describe('tileRects', () => {
  it('returns the region itself without tiling', () => {
    const r = { x: 0, y: 0.1, w: 1, h: 0.8 };
    expect(tileRects(r)).toEqual([r]);
  });

  it('covers the region exactly with overlapping strips', () => {
    const r = { x: 0, y: 0.1, w: 1, h: 0.8 };
    const tiles = tileRects(r, { rows: 3, overlap: 0.2 });
    expect(tiles).toHaveLength(3);
    expect(tiles[0].y).toBeCloseTo(0.1);
    const last = tiles[2];
    expect(last.y + last.h).toBeCloseTo(0.9);
    // Each strip starts before the previous one ends.
    expect(tiles[1].y).toBeLessThan(tiles[0].y + tiles[0].h);
  });
});

describe('toPixels', () => {
  it('maps and clamps to the image', () => {
    expect(toPixels({ x: 0.5, y: 0.5, w: 0.7, h: 0.7 }, 1000, 800)).toEqual({
      originX: 500,
      originY: 400,
      width: 500,
      height: 400,
    });
  });
});

const fakeImages: ImageOps = {
  size: async () => ({ width: 1000, height: 1000 }),
  crop: async (_uri, rect) => `crop://${rect.originY}`,
};

function fakeBackend(replies: string[]): VisionBackend & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  return {
    modelId: 'fake',
    calls,
    generate: async (req) => {
      calls.push(req);
      const next = replies.shift();
      if (next === undefined) throw new Error('no more replies');
      return next;
    },
  };
}

const template: DocumentTemplate = {
  id: 'test',
  name: 'Test',
  version: 1,
  regions: [
    {
      id: 'rows',
      label: 'Rows',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      tiles: { rows: 2, overlap: 0 },
      prompt: 'Read rows',
      schema: { type: 'object', properties: { n: { type: 'integer', nullable: true } } },
    },
  ],
};

describe('runTemplate', () => {
  it('runs every tile and coerces the output', async () => {
    const backend = fakeBackend(['{"n": "4"}', '{"n": 7}']);
    const run = await runTemplate(backend, fakeImages, 'page.jpg', template);
    const rows = resultsFor(run, 'rows');
    expect(rows.map((r) => r.data)).toEqual([{ n: 4 }, { n: 7 }]);
    expect(rows.map((r) => r.imageUri)).toEqual(['crop://0', 'crop://500']);
    expect(backend.calls[1].prompt).toContain('strip 2 of 2');
    expect(backend.calls[0].jsonSchema).toBeDefined();
  });

  it('retries once on unreadable output, with a little temperature', async () => {
    const backend = fakeBackend(['garbage', '{"n": 1}', '{"n": 2}']);
    const run = await runTemplate(backend, fakeImages, 'page.jpg', template);
    expect(run.results[0]).toMatchObject({ data: { n: 1 }, attempts: 2, error: undefined });
    expect(backend.calls.map((c) => c.temperature)).toEqual([0, 0.3, 0]);
  });

  it('records a failure instead of throwing when retries run out', async () => {
    const backend = fakeBackend(['nope', 'still nope', '{"n": 2}']);
    const run = await runTemplate(backend, fakeImages, 'page.jpg', template);
    expect(run.results[0].data).toBeNull();
    expect(run.results[0].error).toMatch(/No JSON/);
    expect(run.results[1].data).toEqual({ n: 2 });
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runTemplate(fakeBackend([]), fakeImages, 'page.jpg', template, { signal: controller.signal }),
    ).rejects.toThrow('cancelled');
  });
});

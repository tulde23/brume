import { newTemplate, normalizeTemplate, suggestParts, type ExtractionRun, type NormRect, type RegionResult, type TextLine } from '@inkstat/ocr-engine';

import { TRACK, TRACK_CATALOG, documentFor, parseMark, passRegion, readTrackPage, trackChecks, type TrackTemplate } from '../index';

describe('parseMark', () => {
  it('reads times, with minutes, hours and hand-timing marks', () => {
    expect(parseMark('12.34', 'time')?.value).toBe(12.34);
    expect(parseMark('1:02.45', 'time')?.value).toBe(62.45);
    expect(parseMark('4:32.1h', 'time')?.value).toBe(272.1);
    expect(parseMark('1:02:03.5', 'time')?.value).toBe(3723.5);
  });
  it('reads distances in feet-inches and metres', () => {
    expect(parseMark('18-04.50', 'distance')?.value).toBeCloseTo(5.601, 3);
    expect(parseMark("5' 8\"", 'height')?.value).toBeCloseTo(1.727, 3);
    expect(parseMark('5.62m', 'distance')?.value).toBe(5.62);
  });
  it('keeps non-results as a status, and unreadable text as text', () => {
    expect(parseMark('DNF', 'time')).toMatchObject({ value: null, status: 'DNF' });
    expect(parseMark('FOUL', 'distance')).toMatchObject({ status: 'FOUL' });
    expect(parseMark('12.3.4', 'time')).toMatchObject({ value: null, status: null });
    expect(parseMark('  ', 'time')).toBeNull();
  });
});

const template = (over: Partial<TrackTemplate> = {}): TrackTemplate => ({
  ...newTemplate('track', TRACK_CATALOG, 't', '100m results', null, 0),
  parts: {
    rows: { x: 0.05, y: 0.25, w: 0.9, h: 0.6 },
    place: { x: 0.05, w: 0.06 },
    athlete: { x: 0.2, w: 0.3 },
    team: { x: 0.5, w: 0.25 },
    result: { x: 0.8, w: 0.12 },
    eventName: { x: 0.05, y: 0.05, w: 0.5, h: 0.05 },
    heat: { x: 0.6, y: 0.05, w: 0.15, h: 0.05 },
    date: { x: 0.8, y: 0.05, w: 0.15, h: 0.05 },
  },
  ...over,
});

const result = (regionId: string, tileIndex: number, data: unknown): RegionResult => ({
  regionId,
  tileIndex,
  tileCount: 1,
  rect: { x: 0, y: 0, w: 1, h: 1 },
  imageUri: `crop-${regionId}`,
  imageUris: [`crop-${regionId}`],
  data,
  raw: '',
  warnings: [],
  attempts: 1,
  durationMs: 1,
});

const run = (results: RegionResult[]): ExtractionRun => ({
  templateId: 'track.meet-sheet',
  templateVersion: 1,
  modelId: 'test',
  sourceUri: 'page',
  startedAt: 0,
  finishedAt: 1,
  results,
});

describe('documentFor', () => {
  it('reads each marked column beside the athlete name in its own pass, and each detail on its own', () => {
    const ids = documentFor(template()).regions.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([passRegion('result'), passRegion('place'), passRegion('team'), 'event_eventName', 'event_heat', 'event_date']));
    const resultPass = documentFor(template()).regions.find((r) => r.id === passRegion('result'))!;
    expect(resultPass.columns).toHaveLength(2);
    expect(resultPass.joinColumns).toBe(true);
  });
  it('leaves planned parts out of the read', () => {
    const t = template({ enabled: [...TRACK_CATALOG.defaultEnabled, 'attempts'], parts: { ...template().parts, attempts: { x: 0.5, w: 0.3 } } });
    expect(documentFor(t).regions.some((r) => r.id.includes('attempts'))).toBe(false);
  });
});

describe('readTrackPage and checks', () => {
  const t = template();
  const page = (places: [string, string][]) =>
    readTrackPage(
      t,
      run([
        result(passRegion('result'), 0, { athletes: [{ name: 'Ava Lee', result: '12.41' }, { name: 'Mia Cole', result: '12.03' }, { name: 'Zoe Park', result: 'DNF' }] }),
        result(passRegion('place'), 0, { athletes: places.map(([name, place]) => ({ name, place })) }),
        result(passRegion('team'), 0, { athletes: [{ name: 'Ava  Lee', team: 'Decatur' }, { name: 'Mia Cole', team: 'Grady' }, { name: 'Zoe Park', team: 'Decatur' }] }),
        result('event_eventName', 0, { event: 'Girls 100 Meter Dash' }),
        result('event_heat', 0, { heat: 'Heat 2' }),
        result('event_date', 0, { date: '4/12/26' }),
      ]),
    );

  it('merges every pass onto the athlete by name', () => {
    const p = page([['Mia Cole', '1'], ['Ava Lee', '2']]);
    expect(p.athletes.map((a) => [a.name, a.result?.value ?? a.result?.status, a.place, a.team])).toEqual([
      ['Ava Lee', 12.41, 2, 'Decatur'],
      ['Mia Cole', 12.03, 1, 'Grady'],
      ['Zoe Park', 'DNF', null, 'Decatur'],
    ]);
    expect(p.eventName).toBe('Girls 100 Meter Dash');
  });

  it('passes places that agree with the times, and flags ones that do not', () => {
    const ok = trackChecks(t, page([['Mia Cole', '1'], ['Ava Lee', '2']]));
    expect(ok.find((c) => c.part === 'place')).toMatchObject({ ok: true });
    const bad = trackChecks(t, page([['Mia Cole', '2'], ['Ava Lee', '1']]));
    expect(bad.find((c) => c.part === 'place')).toMatchObject({ ok: false, value: 'out of order' });
    expect(ok.find((c) => c.part === 'eventName')).toMatchObject({ ok: true, value: 'Girls 100 Meter Dash' });
  });

  it('uses the result type: longer is better for distances', () => {
    const field = template({ variants: { result: 'distance' } });
    const p = readTrackPage(
      field,
      run([
        result(passRegion('result'), 0, { athletes: [{ name: 'A', result: '30-02' }, { name: 'B', result: '32-06.5' }] }),
        result(passRegion('place'), 0, { athletes: [{ name: 'B', place: '1' }, { name: 'A', place: '2' }] }),
      ]),
    );
    expect(trackChecks(field, p).find((c) => c.part === 'place')).toMatchObject({ ok: true });
  });
});

// A printed heat sheet, laid out like typical high-school meet results (fractions of the page).
const line = (...words: [string, number, number][]): TextLine => {
  const ws = words.map(([text, x, y]) => ({ text, rect: { x, y, w: text.length * 0.01, h: 0.012 } as NormRect }));
  return { text: ws.map((w) => w.text).join(' '), rect: ws[0].rect, words: ws };
};
const heatSheet: TextLine[] = [
  line(['Event', 0.05, 0.05], ['3', 0.11, 0.05], ['Girls', 0.13, 0.05], ['100', 0.19, 0.05], ['Meter', 0.23, 0.05], ['Dash', 0.29, 0.05]),
  line(['Heat', 0.6, 0.05], ['2', 0.65, 0.05]),
  line(['Place', 0.05, 0.22], ['Lane', 0.12, 0.22], ['Name', 0.25, 0.22], ['School', 0.52, 0.22], ['Time', 0.82, 0.22]),
  line(['1', 0.06, 0.26], ['4', 0.13, 0.26], ['Mia', 0.25, 0.26], ['Cole', 0.29, 0.26], ['Grady', 0.52, 0.26], ['12.03', 0.82, 0.26]),
];

describe('placeFromHeadings on a heat sheet', () => {
  const { parts, found } = TRACK.placeParts(heatSheet);
  const covers = (b: { x: number; w: number }, x: number) => b.x <= x && b.x + b.w >= x;

  it('puts the rows under the headings and a column under each heading', () => {
    expect((parts.rows as NormRect).y).toBeGreaterThan(0.23);
    expect(covers(parts.athlete!, 0.27)).toBe(true);
    expect(covers(parts.team!, 0.55)).toBe(true);
    expect(covers(parts.result!, 0.84)).toBe(true);
    expect(covers(parts.place!, 0.07)).toBe(true);
    expect(found).toEqual(expect.arrayContaining(['rows', 'athlete', 'team', 'result', 'place', 'lane']));
  });

  it('boxes the event and heat right of their labels', () => {
    expect((parts.eventName as NormRect).x).toBeGreaterThan(0.09);
    expect((parts.heat as NormRect).x).toBeGreaterThan(0.63);
  });

  it('suggests the shared machinery works for track: column meanings from headings', () => {
    expect(suggestParts({ x: 0.8, y: 0.24, w: 0.12, h: 0.6 }, heatSheet, TRACK_CATALOG)[0]).toBe('result');
    expect(suggestParts({ x: 0.5, y: 0.24, w: 0.2, h: 0.6 }, heatSheet, TRACK_CATALOG)[0]).toBe('team');
  });

  it('keeps bands inside the rows box', () => {
    const t = normalizeTemplate({ ...template(), parts: { rows: { x: 0.2, y: 0.3, w: 0.5, h: 0.5 }, result: { x: 0.9, w: 0.2 } } }, TRACK_CATALOG);
    expect(t.parts.result!.x + t.parts.result!.w).toBeLessThanOrEqual(0.7 + 1e-9);
  });
});

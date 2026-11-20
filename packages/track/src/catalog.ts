import type { Band, Catalog, NormRect, PartSpec } from '@inkstat/ocr-engine';

/**
 * The track and field region bank: every part a meet sheet can have, for
 * running events (heat sheets and results: lane, athlete, team, time, place)
 * and field events (athlete, attempts, best mark, place).
 */
export type TrackPart =
  // Event details
  | 'eventName'
  | 'heat'
  | 'round'
  | 'division'
  | 'meet'
  | 'date'
  | 'wind'
  // Athlete table
  | 'rows'
  | 'athlete'
  | 'team'
  | 'lane'
  | 'bib'
  | 'seed'
  | 'result'
  | 'place'
  | 'attempts'
  | 'splits'
  | 'teamPoints';

export type TrackGroup = 'event' | 'table';

type Raw = Omit<PartSpec<TrackPart, TrackGroup>, 'color'>;

const planned = (id: TrackPart, name: string, labels: string[], short: string): Raw => ({
  id,
  name,
  group: 'table',
  shape: 'band',
  status: 'planned',
  labels,
  instruction: `Drag across the ${name.toLowerCase()} column.`,
  why: `${short} Kept with the template; reading it is coming soon.`,
  short,
});

const RAW: Raw[] = [
  // ── Athlete table ──
  {
    id: 'rows',
    name: 'Athlete rows',
    group: 'table',
    shape: 'box',
    status: 'untested',
    labels: ['name', 'athlete', 'competitor'],
    instruction: 'Draw a box around every athlete row, from the first to the last. Leave out the column headings.',
    why: 'InkStat only looks for athletes inside this box, so meet headers and footers aren’t read as results.',
    short: 'Keeps headers and footers out of the results.',
  },
  {
    id: 'athlete',
    name: 'Athlete name',
    group: 'table',
    shape: 'band',
    status: 'untested',
    labels: ['name', 'athlete', 'competitor', 'participant'],
    instruction: 'Drag across the athlete name column.',
    why: 'Who each row is. Every other column is matched to the athlete on the same row.',
    short: 'Who each row is.',
  },
  {
    id: 'result',
    name: 'Time / mark',
    group: 'table',
    shape: 'band',
    status: 'untested',
    variants: [
      { id: 'time', name: 'A time', sub: 'Running events: 12.34, 1:02.45, 4:32.1h' },
      { id: 'distance', name: 'A distance', sub: 'Throws and jumps: 18-04.50 or 5.62m' },
      { id: 'height', name: 'A height', sub: 'High jump, pole vault: 5-08 or 1.73m' },
    ],
    labels: ['time', 'mark', 'result', 'final', 'finals', 'best', 'perf', 'performance'],
    instruction: 'Drag across the final time or mark column only.',
    why: 'The result. Read from just this column, so seed times and splits beside it aren’t mixed in.',
    short: 'The result for each athlete.',
  },
  {
    id: 'place',
    name: 'Place',
    group: 'table',
    shape: 'band',
    status: 'untested',
    labels: ['place', 'pl', 'plc', 'rank', 'pos'],
    instruction: 'Drag across the place column.',
    why: 'InkStat checks places against results: a faster time (or longer mark) should never place lower.',
    short: 'Checked against the results.',
  },
  {
    id: 'team',
    name: 'Team / school',
    group: 'table',
    shape: 'band',
    status: 'untested',
    labels: ['team', 'school', 'club', 'affiliation'],
    instruction: 'Drag across the team or school column.',
    why: 'Groups results by team, for team scoring and season stats.',
    short: 'Groups results by team.',
  },
  {
    id: 'lane',
    name: 'Lane / order',
    group: 'table',
    shape: 'band',
    status: 'untested',
    labels: ['lane', 'ln', 'flight', 'order', 'ord'],
    instruction: 'Drag across the lane or throwing/jumping order column.',
    why: 'Where each athlete ran or competed in order.',
    short: 'Lane or competition order.',
  },
  {
    id: 'bib',
    name: 'Bib / ID',
    group: 'table',
    shape: 'band',
    status: 'untested',
    labels: ['bib', 'id', 'hip', 'comp'],
    instruction: 'Drag across the bib or competitor number column.',
    why: 'Tells athletes with the same name apart, and matches them across events.',
    short: 'Tells athletes apart.',
  },
  {
    id: 'seed',
    name: 'Seed time / mark',
    group: 'table',
    shape: 'band',
    status: 'untested',
    labels: ['seed', 'entry', 'sd'],
    instruction: 'Drag across the seed time or entry mark column.',
    why: 'Shows improvement from seed to result.',
    short: 'Entry time or mark.',
  },
  planned('attempts', 'Attempts', ['1', '2', '3', '4', '5', '6', 'attempts', 'trials'], 'Each field-event attempt, including fouls (X) and passes.'),
  planned('splits', 'Splits', ['split', 'splits', 'lap'], 'Lap or split times.'),
  planned('teamPoints', 'Team points', ['pts', 'points'], 'Points scored for the team.'),
  // ── Event details ──
  {
    id: 'eventName',
    name: 'Event',
    group: 'event',
    shape: 'box',
    status: 'untested',
    labels: ['event', 'evt'],
    instruction: 'Box the event name (e.g. Girls 100 Meter Dash, Boys Shot Put).',
    why: 'Which event these results belong to. Read up close, on its own.',
    short: 'Which event this is.',
  },
  {
    id: 'heat',
    name: 'Heat / flight',
    group: 'event',
    shape: 'box',
    status: 'untested',
    labels: ['heat', 'flight', 'section'],
    instruction: 'Box the heat, flight or section number.',
    why: 'Keeps heats of the same event apart.',
    short: 'Which heat or flight.',
  },
  {
    id: 'round',
    name: 'Round',
    group: 'event',
    shape: 'box',
    status: 'untested',
    labels: ['round', 'prelim', 'prelims', 'final', 'finals', 'semi'],
    instruction: 'Box the round (prelims, semis, finals).',
    why: 'Prelim and final results of the same event are kept apart.',
    short: 'Prelims, semis or finals.',
  },
  {
    id: 'division',
    name: 'Division',
    group: 'event',
    shape: 'box',
    status: 'untested',
    labels: ['division', 'div', 'gender', 'age', 'level', 'varsity', 'jv'],
    instruction: 'Box the division (boys/girls, varsity/JV, age group).',
    why: 'Which competition the results count toward.',
    short: 'Boys/girls, varsity/JV, age group.',
  },
  {
    id: 'meet',
    name: 'Meet',
    group: 'event',
    shape: 'box',
    status: 'untested',
    labels: ['meet', 'invitational', 'championship', 'championships'],
    instruction: 'Box the meet name.',
    why: 'Groups events from the same meet together.',
    short: 'Which meet.',
  },
  {
    id: 'date',
    name: 'Date',
    group: 'event',
    shape: 'box',
    status: 'untested',
    labels: ['date'],
    instruction: 'Box the date.',
    why: 'Puts the results in the right season.',
    short: 'Puts results in the right season.',
  },
  {
    id: 'wind',
    name: 'Wind',
    group: 'event',
    shape: 'box',
    status: 'untested',
    labels: ['wind', 'w'],
    instruction: 'Box the wind reading.',
    why: 'Sprint and jump marks with too much tailwind don’t count for records.',
    short: 'Wind reading for sprints and jumps.',
  },
];

const COLORS: Record<TrackPart, string> = {
  rows: '#0F6E75',
  athlete: '#2F7D4F',
  result: '#C77700',
  place: '#7A4FB5',
  team: '#2563A8',
  lane: '#0E7490',
  bib: '#57534E',
  seed: '#A16207',
  attempts: '#BE185D',
  splits: '#4338CA',
  teamPoints: '#3F3F46',
  eventName: '#1D4ED8',
  heat: '#9D174D',
  round: '#4D7C0F',
  division: '#B03A78',
  meet: '#334155',
  date: '#C2410C',
  wind: '#0369A1',
};

export const TRACK_PARTS: PartSpec<TrackPart, TrackGroup>[] = RAW.map((p) => ({ ...p, color: COLORS[p.id] }));

const DEFAULTS: Record<TrackPart, NormRect | Band> = {
  rows: { x: 0.04, y: 0.2, w: 0.92, h: 0.74 },
  place: { x: 0.04, w: 0.06 },
  lane: { x: 0.1, w: 0.06 },
  bib: { x: 0.16, w: 0.08 },
  athlete: { x: 0.24, w: 0.28 },
  team: { x: 0.52, w: 0.2 },
  seed: { x: 0.72, w: 0.1 },
  result: { x: 0.82, w: 0.12 },
  attempts: { x: 0.52, w: 0.3 },
  splits: { x: 0.72, w: 0.2 },
  teamPoints: { x: 0.92, w: 0.05 },
  eventName: { x: 0.04, y: 0.04, w: 0.5, h: 0.05 },
  heat: { x: 0.56, y: 0.04, w: 0.15, h: 0.05 },
  round: { x: 0.72, y: 0.04, w: 0.12, h: 0.05 },
  division: { x: 0.04, y: 0.1, w: 0.3, h: 0.05 },
  meet: { x: 0.36, y: 0.1, w: 0.4, h: 0.05 },
  date: { x: 0.78, y: 0.1, w: 0.18, h: 0.05 },
  wind: { x: 0.85, y: 0.04, w: 0.11, h: 0.05 },
};

export const TRACK_CATALOG: Catalog<TrackPart, TrackGroup> = {
  parts: TRACK_PARTS,
  groups: [
    { group: 'table', title: 'Athlete table', shape: 'Athlete rows box, then columns inside it' },
    { group: 'event', title: 'Event details', shape: 'Small boxes, one value each' },
  ],
  rowsPart: 'rows',
  required: ['rows', 'athlete', 'result'],
  defaultEnabled: ['rows', 'athlete', 'result', 'place', 'team', 'eventName', 'heat', 'date'],
  defaults: DEFAULTS,
  sharedStepGroups: ['event'],
};

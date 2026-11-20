import type { PartId } from '@brume/basketball';

/** One color per template part, as on the approved designs. They differ in lightness too, and every box is also labelled. */
export const PART_COLORS: Record<PartId, string> = {
  rows: '#0F6E75',
  names: '#2F7D4F',
  points: '#C77700',
  fouls: '#7A4FB5',
  teamName: '#2563A8',
  coach: '#0E7490',
  location: '#4D7C0F',
  date: '#9D174D',
  timeouts: '#C2410C',
  teamFouls: '#B03A78',
  quarters: '#475569',
};

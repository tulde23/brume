import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { Side } from '@inkstat/basketball';

/** Where the home team sits on a page that holds both teams. */
export type HomeAt = 'top' | 'bottom' | 'left' | 'right';

/**
 * Cuts a page that holds both teams into the home half and the away half, so each
 * half reads exactly like a team's own page. The halves overlap by a few percent so a
 * row that sits on the fold is not cut in two on both sides.
 */
export async function splitPage(uri: string, homeAt: HomeAt): Promise<Record<Side, string>> {
  const { width, height } = await ImageManipulator.manipulate(uri).renderAsync();
  const across = homeAt === 'left' || homeAt === 'right';
  const full = across ? width : height;
  const half = Math.round(full * 0.53);
  const first = { start: 0, size: half };
  const second = { start: full - half, size: half };
  const cut = async (part: { start: number; size: number }) => {
    const rect = across
      ? { originX: part.start, originY: 0, width: part.size, height }
      : { originX: 0, originY: part.start, width, height: part.size };
    const ref = await ImageManipulator.manipulate(uri).crop(rect).renderAsync();
    return (await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 })).uri;
  };
  const [a, b] = await Promise.all([cut(first), cut(second)]);
  const homeFirst = homeAt === 'top' || homeAt === 'left';
  return homeFirst ? { home: a, away: b } : { home: b, away: a };
}

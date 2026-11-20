import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { ImageOps, PixelRect } from './types';

/** ImageOps backed by expo-image-manipulator. Crops are written to the cache directory. */
export const expoImageOps: ImageOps = {
  async size(uri) {
    const ref = await ImageManipulator.manipulate(uri).renderAsync();
    return { width: ref.width, height: ref.height };
  },

  async crop(uri: string, rect: PixelRect, maxSide: number) {
    const ctx = ImageManipulator.manipulate(uri).crop(rect);
    const longest = Math.max(rect.width, rect.height);
    if (longest > maxSide) {
      ctx.resize(rect.width >= rect.height ? { width: maxSide, height: null } : { width: null, height: maxSide });
    }
    const ref = await ctx.renderAsync();
    // PNG keeps pencil strokes crisp; JPEG artifacts hurt small-model reading.
    const saved = await ref.saveAsync({ format: SaveFormat.PNG });
    return saved.uri;
  },
};

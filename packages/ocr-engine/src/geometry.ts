import type { NormRect, PixelRect, TileSpec } from './types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Split a region into overlapping horizontal strips (top to bottom). */
export function tileRects(rect: NormRect, tiles?: TileSpec): NormRect[] {
  const rows = Math.max(1, Math.floor(tiles?.rows ?? 1));
  if (rows === 1) return [rect];
  const overlap = Math.min(0.5, Math.max(0, tiles?.overlap ?? 0));
  // Strip height h satisfies: rows*h - (rows-1)*overlap*h = rect.h
  const h = rect.h / (rows - (rows - 1) * overlap);
  const step = h * (1 - overlap);
  return Array.from({ length: rows }, (_, i) => ({
    x: rect.x,
    y: rect.y + i * step,
    w: rect.w,
    h: i === rows - 1 ? rect.y + rect.h - (rect.y + i * step) : h,
  }));
}

/** Map a normalized rect onto an image, clamped to its bounds and at least 1px. */
export function toPixels(rect: NormRect, width: number, height: number): PixelRect {
  const x0 = clamp01(rect.x);
  const y0 = clamp01(rect.y);
  const x1 = clamp01(rect.x + rect.w);
  const y1 = clamp01(rect.y + rect.h);
  const originX = Math.floor(x0 * width);
  const originY = Math.floor(y0 * height);
  return {
    originX,
    originY,
    width: Math.max(1, Math.min(width - originX, Math.ceil(x1 * width) - originX)),
    height: Math.max(1, Math.min(height - originY, Math.ceil(y1 * height) - originY)),
  };
}

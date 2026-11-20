import type { MiddlewareHandler } from 'hono';

import { ApiError } from './errors';

/**
 * A fixed-window counter in memory. One replica on Railway, so memory is the whole
 * truth; a restart forgives everyone, which is fine for the volumes here.
 */
export function rateLimit<E extends { Variables: Record<string, unknown> }>(
  limit: number,
  windowMs: number,
  keyOf: (c: Parameters<MiddlewareHandler<E>>[0]) => string,
  now: () => number = Date.now,
): MiddlewareHandler<E> {
  const hits = new Map<string, { n: number; until: number }>();
  return async (c, next) => {
    const t = now();
    const key = keyOf(c);
    let h = hits.get(key);
    if (!h || h.until <= t) {
      h = { n: 0, until: t + windowMs };
      hits.set(key, h);
      if (hits.size > 50_000) for (const [k, v] of hits) if (v.until <= t) hits.delete(k);
    }
    if (++h.n > limit) throw ApiError.tooMany();
    await next();
  };
}

/** The caller's address behind Railway's proxy: the first hop it appended. */
export function clientAddress(header: string | undefined, fallback = 'unknown'): string {
  return header?.split(',')[0]?.trim() || fallback;
}

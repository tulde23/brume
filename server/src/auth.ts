import { createHash } from 'node:crypto';

/** sha256(key) -> space. Keys are never kept in plain text after startup. */
export type KeyRing = Map<string, string>;

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

/**
 * BRUME_API_KEYS="eagles:<key>,lakeview:<key>". Each key unlocks one space
 * (a team, a league). Keys must be long and random: `openssl rand -hex 32`.
 */
export function parseKeys(spec: string | undefined): KeyRing {
  const ring: KeyRing = new Map();
  for (const entry of (spec ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const at = entry.indexOf(':');
    const space = entry.slice(0, at).trim();
    const key = entry.slice(at + 1).trim();
    if (at < 1 || !/^[a-z0-9-]{1,40}$/.test(space)) {
      throw new Error(`BRUME_API_KEYS: "${space || entry.slice(0, 8)}…" needs a lowercase space name before the colon`);
    }
    if (key.length < 32) throw new Error(`BRUME_API_KEYS: the key for "${space}" must be at least 32 characters`);
    ring.set(hashKey(key), space);
  }
  return ring;
}

export function spaceFor(ring: KeyRing, authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  return match ? (ring.get(hashKey(match[1])) ?? null) : null;
}

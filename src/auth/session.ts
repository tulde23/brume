import Constants from 'expo-constants';
import { useSyncExternalStore } from 'react';

import { signInWithProvider, type IdentityProvider } from './socialSignIn';

/**
 * The InkStat session: an access token (15 minutes) and a rotating refresh token,
 * kept in the platform's secure storage. Follows Orbit's client rules:
 *
 * - One refresh at a time (single flight), and storage is re-read before believing a
 *   401: another context may already have rotated the token.
 * - `RefreshRaced` is never a sign-out. The session is alive; wait, re-read, retry.
 * - Only a plain 401 from /auth/refresh ends the session. A network failure never does.
 */

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
  user: AccountUser;
}

const STORE_KEY = 'inkstat.session';
const REFRESH_EARLY_MS = 60_000;

export const apiUrl = (): string =>
  String((Constants.expoConfig?.extra as Record<string, unknown> | undefined)?.apiUrl ?? 'https://api.inkstat.app').replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const store = () => require('expo-secure-store') as typeof import('expo-secure-store');

let current: Session | null = null;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function readStored(): Promise<Session | null> {
  try {
    const raw = await store().getItemAsync(STORE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

async function write(next: Session | null) {
  current = next;
  if (next) await store().setItemAsync(STORE_KEY, JSON.stringify(next));
  else await store().deleteItemAsync(STORE_KEY);
  emit();
}

/** Loads the stored session once; later calls return the cached one. */
export async function loadSession(): Promise<Session | null> {
  if (!loaded) {
    current = await readStored();
    loaded = true;
    emit();
  }
  return current;
}

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Offline', 'Could not reach InkStat. Check your connection.');
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!res.ok) throw new ApiError(res.status, json.code ?? 'Error', json.error ?? `Server answered ${res.status}`);
  return json as T;
}

/** Runs the provider's sheet, then trades its token for an InkStat session. */
export async function signIn(provider: IdentityProvider): Promise<Session> {
  const credential = await signInWithProvider(provider);
  const session = await post<Session>('/v1/auth/social', credential);
  await write(session);
  return session;
}

export async function signOut(): Promise<void> {
  const s = current ?? (await readStored());
  await write(null);
  if (s) await post('/v1/auth/logout', { refreshToken: s.refreshToken }).catch(() => undefined);
}

let inflight: Promise<Session | null> | null = null;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One refresh at a time; null means signed out. */
function refreshOnce(): Promise<Session | null> {
  inflight ??= (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        // Re-read storage first: another context may have rotated the token already.
        const stored = await readStored();
        if (!stored) {
          await write(null);
          return null;
        }
        if (stored.expiresAt - REFRESH_EARLY_MS > Date.now()) {
          current = stored;
          return stored;
        }
        try {
          const next = await post<Session>('/v1/auth/refresh', { refreshToken: stored.refreshToken });
          await write(next);
          return next;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'RefreshRaced') {
            // The session is alive; the winner's token lands in storage. Never sign out on this.
            await wait(1500 * (attempt + 1));
            continue;
          }
          if (e instanceof ApiError && e.status === 401) {
            await write(null);
            return null;
          }
          // Offline or the server is down: keep the session and try again later.
          throw e;
        }
      }
      return await readStored();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * fetch against the API as the signed-in account. Refreshes the access token when it
 * is about to expire, and once more on a 401. Throws ApiError(401, 'SignedOut') when
 * there is no session.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let s = await loadSession();
  if (!s) throw new ApiError(401, 'SignedOut', 'Sign in to sync.');
  if (s.expiresAt - REFRESH_EARLY_MS <= Date.now()) s = await refreshOnce();
  if (!s) throw new ApiError(401, 'SignedOut', 'Sign in again to sync.');
  const go = (token: string) =>
    fetch(`${apiUrl()}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${token}`,
      },
    }).catch(() => {
      throw new ApiError(0, 'Offline', 'Could not reach InkStat. Check your connection.');
    });
  let res = await go(s.accessToken);
  if (res.status === 401) {
    // Expired early or the signing key changed: refresh once and retry.
    await write({ ...s, expiresAt: 0 });
    const next = await refreshOnce();
    if (!next) throw new ApiError(401, 'SignedOut', 'Sign in again to sync.');
    res = await go(next.accessToken);
  }
  return res;
}

/** The current session for React; re-renders on sign-in, refresh and sign-out. */
export function useSession(): Session | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      void loadSession();
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

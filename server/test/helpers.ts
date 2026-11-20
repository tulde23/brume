import { createHash } from 'node:crypto';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { createApp } from '../src/app';
import { createAccounts } from '../src/auth/accounts';
import type { AppleAccountClient } from '../src/auth/apple';
import { createProtector } from '../src/auth/apple';
import { createIdentityVerifier, type IdentityProvider } from '../src/auth/identity';
import { parseKeys } from '../src/auth/keys';
import { createDocs, createStore, openDb } from '../src/db';
import { createGroups } from '../src/groups';
import { createRegistry } from '../src/registry';

// Response bodies are untyped JSON; tests assert on their shape directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const json = async (res: Response): Promise<any> => res.json();

export const GOOGLE_AUD = 'web-client.apps.googleusercontent.com';
export const APPLE_AUD = 'com.inkstat.app';
const ISS: Record<IdentityProvider, string> = { Google: 'https://accounts.google.com', Apple: 'https://appleid.apple.com' };

/** A fake provider: its own key pair, published as a local JWKS the verifier trusts. */
async function provider(name: IdentityProvider) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: `${name}-1`, alg: 'RS256', use: 'sig' };
  return {
    keys: createLocalJWKSet({ keys: [jwk] }),
    sign: (claims: Record<string, unknown>, opts: { aud?: string; iss?: string; expSeconds?: number } = {}) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: `${name}-1` })
        .setIssuer(opts.iss ?? ISS[name])
        .setAudience(opts.aud ?? (name === 'Google' ? GOOGLE_AUD : APPLE_AUD))
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + (opts.expSeconds ?? 600))
        .sign(privateKey),
  };
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function makeServer({ keys = '' }: { keys?: string } = {}) {
  const google = await provider('Google');
  const apple = await provider('Apple');
  const clock = { t: Date.UTC(2026, 10, 20, 12) };
  const now = () => clock.t;
  const revoked: string[] = [];
  const appleClient: AppleAccountClient = {
    isConfigured: true,
    exchangeCode: async (code) => (code === 'bad' ? null : `apple-refresh-for-${code}`),
    revoke: async (t) => {
      revoked.push(t);
      return true;
    },
  };
  const db = openDb(':memory:');
  const identities = createIdentityVerifier({ googleClientIds: GOOGLE_AUD, appleClientIds: APPLE_AUD }, () => undefined, {
    Google: google.keys,
    Apple: apple.keys,
  });
  const accounts = createAccounts({
    db,
    identities,
    apple: appleClient,
    protector: createProtector('p'.repeat(40)),
    signingKey: 's'.repeat(40),
    now,
    log: () => undefined,
  });
  const app = createApp({
    store: createStore(db),
    docs: createDocs(db),
    keys: parseKeys(keys),
    accounts,
    groups: createGroups(db, now),
    registry: createRegistry(db, now),
    log: false,
  });

  const call = (method: string, path: string, body?: unknown, token?: string) =>
    app.request(path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Signs in with Google as `who`; returns the session. */
  const signIn = async (who: string, extra: Record<string, unknown> = {}) => {
    const idToken = await google.sign({ sub: `g-${who}`, email: `${who}@example.com`, email_verified: true, name: who, ...extra });
    const res = await call('POST', '/v1/auth/social', { provider: 'Google', idToken });
    if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    return json(res);
  };

  return { app, call, signIn, google, apple, clock, revoked, db };
}

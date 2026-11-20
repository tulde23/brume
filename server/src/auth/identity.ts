import { createHash, timingSafeEqual } from 'node:crypto';

import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

import { ApiError } from '../errors';

/**
 * Checks an ID token from Sign in with Apple or Google Sign-In, and says who it is for.
 * Ported from Orbit's IdentityTokenVerifier.
 *
 * The signature against the provider's published keys, the issuer, the audience
 * (InkStat's own client ids, from configuration), the expiry, and the nonce. Anything
 * else is refused with 401 `InvalidIdentityToken`, the same answer for every reason, so
 * the endpoint teaches nothing about which check failed.
 *
 * Keys come from each provider's JWKS. jose caches them and refetches when a token
 * names a key it has not seen, which is what a rotation looks like from here.
 */

export type IdentityProvider = 'Apple' | 'Google';

export interface ExternalIdentity {
  provider: IdentityProvider;
  /** The provider's permanent id for this person in this app. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** A name, when the token carries one. Apple's never does. */
  name: string | null;
  /** An Apple "Hide My Email" relay address. */
  isPrivateRelay: boolean;
}

export interface AppleAccountEvent {
  /** consent-revoked, account-delete, email-disabled or email-enabled. */
  type: string;
  subject: string;
}

const PROVIDERS: Record<IdentityProvider, { jwks: string; issuers: string[] }> = {
  Apple: { jwks: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'] },
  // Google documents both spellings of its issuer, and issues either.
  Google: {
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
};

export interface IdentityConfig {
  /** Comma-separated: the Google *web* client id is the audience on both platforms. */
  googleClientIds?: string;
  /** Comma-separated: the iOS bundle id (and a Services ID if a web flow is added). */
  appleClientIds?: string;
}

const split = (s: string | undefined) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const refused = () => new ApiError(401, 'InvalidIdentityToken', 'That sign-in could not be verified. Try again.');

/** Apple sends some booleans as the strings "true" and "false". */
const flag = (v: unknown) => v === true || v === 'true';
const text = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * The nonce the app made, against the token's.
 *
 * The app passes Apple the SHA-256 of a random value it keeps, so the token carries
 * the hash and the app sends us the value; either form is accepted. Apple requires
 * one, which is what stops a token lifted from one sign-in being replayed in another.
 *
 * Google's is checked only when the app sent one: Google's iOS SDK puts a nonce of its
 * own into every ID token, one the app never sees (Orbit, 2026-10-08).
 */
export function nonceMatches(provider: IdentityProvider, sent: string | undefined | null, claimed: unknown): boolean {
  if (!sent) return provider !== 'Apple';
  if (typeof claimed !== 'string' || !claimed) return false;
  const hashed = createHash('sha256').update(sent, 'utf8').digest('hex');
  return equal(claimed, sent) || equal(claimed, hashed);
}

export interface IdentityVerifier {
  isConfigured(provider: IdentityProvider): boolean;
  verify(provider: IdentityProvider, idToken: string, nonce?: string | null): Promise<ExternalIdentity>;
  verifyAppleEvent(payload: string): Promise<AppleAccountEvent>;
}

export function createIdentityVerifier(
  config: IdentityConfig,
  log: (line: string) => void = console.log,
  /** Tests pass local key sets; production fetches the providers'. */
  keySets?: Partial<Record<IdentityProvider, JWTVerifyGetKey>>,
): IdentityVerifier {
  const audiences: Record<IdentityProvider, string[]> = {
    Apple: split(config.appleClientIds),
    Google: split(config.googleClientIds),
  };
  const sets = new Map<IdentityProvider, JWTVerifyGetKey>();
  const keysFor = (p: IdentityProvider) => {
    let set = sets.get(p) ?? keySets?.[p];
    if (!set) {
      set = createRemoteJWKSet(new URL(PROVIDERS[p].jwks), { cooldownDuration: 30_000, cacheMaxAge: 6 * 3600_000 });
      sets.set(p, set);
    }
    return set;
  };

  async function check(provider: IdentityProvider, token: string, required: string[]): Promise<JWTPayload> {
    const aud = audiences[provider];
    if (!aud.length) throw ApiError.notConfigured(`Sign in with ${provider}`);
    try {
      const { payload } = await jwtVerify(token, keysFor(provider), {
        issuer: PROVIDERS[provider].issuers,
        audience: aud,
        clockTolerance: 120,
        requiredClaims: required,
      });
      return payload;
    } catch (e) {
      // The providers' keys unreachable: not the caller's fault, and not a 401.
      if (e instanceof errors.JWKSTimeout || (e instanceof Error && /fetch failed|ENOTFOUND|ECONNRE/.test(e.message))) {
        throw ApiError.upstream('IdentityProviderUnavailable', `${provider} could not be reached. Try again.`);
      }
      // The reason, for whoever reads the log; never the token, and never to the caller.
      log(`${provider} identity token refused: ${e instanceof Error ? e.constructor.name : 'invalid'}`);
      throw refused();
    }
  }

  return {
    isConfigured: (p) => audiences[p].length > 0,

    async verify(provider, idToken, nonce) {
      const claims = await check(provider, idToken, ['exp', 'sub']);
      if (!nonceMatches(provider, nonce, claims.nonce)) {
        log(`${provider} identity token refused: nonce mismatch`);
        throw refused();
      }
      const subject = text(claims.sub);
      if (!subject) throw refused();
      return {
        provider,
        subject,
        email: text(claims.email),
        emailVerified: flag(claims.email_verified),
        name: text(claims.name),
        isPrivateRelay: flag(claims.is_private_email),
      };
    },

    async verifyAppleEvent(payload) {
      // Notifications carry no top-level subject; it is inside the event.
      const claims = await check('Apple', payload, ['iat']);
      // The event is a JSON object Apple sends as a string inside the "events" claim.
      try {
        const ev = JSON.parse(typeof claims.events === 'string' ? claims.events : '{}') as Record<string, unknown>;
        const type = text(ev.type);
        const subject = text(ev.sub);
        if (!type || !subject) throw refused();
        return { type, subject };
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw refused();
      }
    },
  };
}

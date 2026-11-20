import { createCipheriv, createDecipheriv, createHash, createPrivateKey, randomBytes, type KeyObject } from 'node:crypto';

import { SignJWT } from 'jose';

/**
 * Apple's token endpoint: exchanges the one-time authorization code from a sign-in
 * for the refresh token that account deletion must revoke (App Store guideline
 * 5.1.1(v)), and revokes it. Ported from Orbit's AppleAccountClient.
 *
 * Best effort throughout: a failure is logged and returns null/false, because the
 * cost is a revocation that cannot happen, not an account nobody can get into.
 */

const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

export interface AppleConfig {
  /** The bundle id the app signs in as. */
  clientId?: string;
  teamId?: string;
  keyId?: string;
  /** The .p8 key's PEM, with literal "\n" allowed for env vars. */
  privateKey?: string;
}

export interface AppleAccountClient {
  isConfigured: boolean;
  exchangeCode(code: string): Promise<string | null>;
  revoke(refreshToken: string): Promise<boolean>;
}

export function createAppleClient(
  config: AppleConfig,
  log: (line: string) => void = console.log,
  fetchImpl: typeof fetch = fetch,
): AppleAccountClient {
  let key: KeyObject | null = null;
  if (config.clientId && config.teamId && config.keyId && config.privateKey) {
    try {
      key = createPrivateKey(config.privateKey.replace(/\\n/g, '\n'));
    } catch {
      log('APPLE_PRIVATE_KEY is not a readable .p8 key; Apple tokens will not be exchanged or revoked.');
    }
  }

  let secret: { value: string; expires: number } | null = null;
  const clientSecret = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (secret && now < secret.expires - 300) return secret.value;
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: config.keyId! })
      .setIssuer(config.teamId!.trim())
      .setAudience('https://appleid.apple.com')
      .setSubject(config.clientId!)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key!);
    secret = { value, expires: now + 3600 };
    return value;
  };

  const post = async (url: string, form: Record<string, string>) =>
    fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });

  return {
    isConfigured: key !== null,

    async exchangeCode(code) {
      if (!key) return null;
      try {
        const res = await post(TOKEN_URL, {
          client_id: config.clientId!,
          client_secret: await clientSecret(),
          code,
          grant_type: 'authorization_code',
        });
        const body = (await res.json().catch(() => ({}))) as { refresh_token?: string; error?: string };
        if (!res.ok) {
          // Apple's error code only; the body can echo what was sent.
          log(`Apple refused the authorization code exchange: ${res.status} ${body.error ?? ''}`);
          return null;
        }
        return body.refresh_token || null;
      } catch (e) {
        log(`Apple's token endpoint could not be reached: ${e instanceof Error ? e.name : 'error'}`);
        return null;
      }
    },

    async revoke(refreshToken) {
      if (!key) return false;
      try {
        const res = await post(REVOKE_URL, {
          client_id: config.clientId!,
          client_secret: await clientSecret(),
          token: refreshToken,
          token_type_hint: 'refresh_token',
        });
        if (!res.ok) log(`Apple refused a token revocation: ${res.status}`);
        return res.ok;
      } catch (e) {
        log(`Apple's revoke endpoint could not be reached: ${e instanceof Error ? e.name : 'error'}`);
        return false;
      }
    },
  };
}

/**
 * AES-256-GCM for the one secret InkStat keeps at rest (Apple's refresh token).
 * The key is derived from INKSTAT_DATA_KEY; without it, nothing is kept.
 */
export interface Protector {
  protect(plain: string): string;
  unprotect(sealed: string): string | null;
}

export function createProtector(secret: string | undefined): Protector | null {
  if (!secret || secret.length < 32) return null;
  const key = createHash('sha256').update(`inkstat-protect:${secret}`).digest();
  return {
    protect(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
    },
    unprotect(sealed) {
      try {
        const [v, iv, tag, body] = sealed.split('.');
        if (v !== 'v1') return null;
        const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
        d.setAuthTag(Buffer.from(tag, 'base64url'));
        return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
      } catch {
        return null;
      }
    },
  };
}

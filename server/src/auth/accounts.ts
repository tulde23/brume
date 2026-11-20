import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { jwtVerify, SignJWT } from 'jose';

import type { DB } from '../db';
import { ApiError } from '../errors';
import type { AppleAccountClient, Protector } from './apple';
import type { ExternalIdentity, IdentityProvider, IdentityVerifier } from './identity';

/**
 * Accounts and sessions, ported from Orbit's AuthService.
 *
 * - No passwords. Apple or Google prove who someone is; InkStat issues its own session.
 * - Identities key on (provider, subject), never the address. A first sign-in links to
 *   an existing account only through a provider-verified address.
 * - A session is a short access token (HS256 JWT) plus a rotating refresh token, kept
 *   hashed. A replayed refresh token ends its own chain, never the account; a stale copy
 *   presented within a minute of its rotation is a race (`RefreshRaced`, nothing ends);
 *   a rotation whose answer was lost is reissued within `LOST_ANSWER_WINDOW_MS`.
 */

export const ACCESS_TOKEN_MS = 15 * 60_000;
export const REFRESH_TOKEN_MS = 90 * 24 * 3600_000;
/** A second presentation of a just-rotated token inside this is a race between two app contexts. */
export const REPLAY_GRACE_MS = 60_000;
/** A rotated token whose replacement was never used, inside this, is an answer the client lost. */
export const LOST_ANSWER_WINDOW_MS = 30 * 60_000;
export const REFRESH_RACED = 'RefreshRaced';
const MAX_NAME = 60;
const DEFAULT_NAME = 'InkStat scorekeeper';

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: number;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  /** ms since epoch */
  expiresAt: number;
  user: User;
}

export interface SocialSignIn {
  provider: IdentityProvider;
  idToken: string;
  nonce?: string | null;
  /** Apple gives the name to the app on the first sign-in only, never in the token. */
  displayName?: string | null;
  /** Apple's one-time code, exchanged for the token deletion must revoke. */
  authorizationCode?: string | null;
}

interface TokenRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  replaced_by: string | null;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  created_at: number;
}

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, displayName: r.display_name, createdAt: r.created_at });
const normalizeEmail = (e: string) => e.trim().toLowerCase();

function socialName(given: string | null | undefined, email: string, privateRelay: boolean) {
  let name = given?.trim();
  // Never a relay address's local part, which is a random string.
  if (!name) name = privateRelay ? DEFAULT_NAME : email.split('@')[0];
  return name.slice(0, MAX_NAME);
}

export interface AccountsDeps {
  db: DB;
  identities: IdentityVerifier;
  apple: AppleAccountClient;
  protector: Protector | null;
  /** INKSTAT_AUTH_KEY: signs access tokens. */
  signingKey: string;
  now?: () => number;
  log?: (line: string) => void;
}

export function createAccounts({ db, identities, apple, protector, signingKey, now = Date.now, log = console.log }: AccountsDeps) {
  if (signingKey.length < 32) throw new Error('INKSTAT_AUTH_KEY must be at least 32 characters');
  const key = new TextEncoder().encode(signingKey);
  const ISSUER = 'inkstat';
  const AUDIENCE = 'inkstat-app';

  const q = {
    userById: db.prepare<[string], UserRow>('SELECT id, email, display_name, created_at FROM users WHERE id = ?'),
    userByEmail: db.prepare<[string], UserRow>('SELECT id, email, display_name, created_at FROM users WHERE email = ?'),
    login: db.prepare<[string, string], { user_id: string }>('SELECT user_id FROM user_logins WHERE provider = ? AND subject = ?'),
    insertUser: db.prepare('INSERT INTO users (id, email, email_verified_at, display_name, created_at) VALUES (?, ?, ?, ?, ?)'),
    verifyEmail: db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?'),
    insertLogin: db.prepare('INSERT INTO user_logins (provider, subject, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)'),
    touchLogin: db.prepare('UPDATE user_logins SET last_used_at = ? WHERE provider = ? AND subject = ?'),
    keepApple: db.prepare("UPDATE user_logins SET apple_refresh = ? WHERE provider = 'Apple' AND subject = ?"),
    appleTokens: db.prepare<[string], { apple_refresh: string }>(
      "SELECT apple_refresh FROM user_logins WHERE user_id = ? AND provider = 'Apple' AND apple_refresh IS NOT NULL",
    ),
    loginsFor: db.prepare<[string], { provider: string }>('SELECT provider FROM user_logins WHERE user_id = ?'),
    deleteLogin: db.prepare('DELETE FROM user_logins WHERE provider = ? AND subject = ?'),
    insertToken: db.prepare('INSERT INTO refresh_tokens (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    tokenByHash: db.prepare<[string], TokenRow>(
      'SELECT id, user_id, created_at, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE token_hash = ?',
    ),
    tokenById: db.prepare<[string], TokenRow>(
      'SELECT id, user_id, created_at, expires_at, revoked_at, replaced_by FROM refresh_tokens WHERE id = ?',
    ),
    rotate: db.prepare('UPDATE refresh_tokens SET revoked_at = ?, replaced_by = ? WHERE id = ?'),
    revoke: db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
    revokeAll: db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'),
    rename: db.prepare('UPDATE users SET display_name = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    pruneTokens: db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?'),
  };

  async function accessToken(user: User, issuedAt: number, expiresAt: number) {
    return new SignJWT({ name: user.displayName })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(issuedAt / 1000))
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(key);
  }

  /** Mints an access/refresh pair; when rotating, the old token is revoked and linked to the new one. */
  const issueRefresh = db.transaction((userId: string, at: number, rotating: TokenRow | null) => {
    const raw = randomBytes(32).toString('base64url');
    const id = randomUUID();
    q.insertToken.run(id, userId, hashToken(raw), at, at + REFRESH_TOKEN_MS);
    if (rotating) q.rotate.run(at, id, rotating.id);
    return raw;
  });

  async function issue(user: User, rotating: TokenRow | null = null): Promise<Session> {
    const at = now();
    const refreshToken = issueRefresh(user.id, at, rotating);
    const expiresAt = at + ACCESS_TOKEN_MS;
    return { accessToken: await accessToken(user, at, expiresAt), refreshToken, expiresAt, user };
  }

  /** First sign-in with this identity: link it to the account with its address, or make one. */
  const linkOrCreate = db.transaction((identity: ExternalIdentity, displayName: string | null | undefined): User => {
    // Only a provider-verified address links or creates: otherwise anybody who can put an
    // address on their Apple or Google account could claim somebody else's InkStat account.
    if (!identity.email || !identity.emailVerified) {
      throw ApiError.badRequest('IdentityEmailRequired', 'InkStat needs your email address to create an account. Share it when you sign in.');
    }
    const email = normalizeEmail(identity.email);
    const at = now();
    let row = q.userByEmail.get(email);
    if (!row) {
      const id = randomUUID();
      q.insertUser.run(id, email, at, socialName(displayName ?? identity.name, email, identity.isPrivateRelay), at);
      row = q.userById.get(id)!;
      log(`Created ${id} with ${identity.provider}.`);
    } else {
      q.verifyEmail.run(at, row.id);
    }
    q.insertLogin.run(identity.provider, identity.subject, row.id, at, at);
    return toUser(row);
  });

  /** Walks forward from a rejected token, ending its chain and nothing else. */
  function endFamily(start: TokenRow) {
    const at = now();
    let cursor: TokenRow | undefined = start;
    // Bounded: a cycle in the links must not hang a request on an anonymous endpoint.
    for (let hop = 0; hop < 64 && cursor; hop++) {
      q.revoke.run(at, cursor.id);
      cursor = cursor.replaced_by ? q.tokenById.get(cursor.replaced_by) : undefined;
    }
  }

  return {
    async socialSignIn(req: SocialSignIn): Promise<Session> {
      const identity = await identities.verify(req.provider, req.idToken, req.nonce);
      const linked = q.login.get(identity.provider, identity.subject);
      let user: User;
      if (linked) {
        const row = q.userById.get(linked.user_id);
        if (!row) throw ApiError.unauthorized();
        user = toUser(row);
        q.touchLogin.run(now(), identity.provider, identity.subject);
      } else {
        try {
          user = linkOrCreate(identity, req.displayName);
        } catch (e) {
          // Two first sign-ins with one identity raced (a double tap, a retry): take the linked path.
          if (e instanceof Error && /UNIQUE constraint failed: user_logins/.test(e.message)) return this.socialSignIn(req);
          throw e;
        }
      }
      if (identity.provider === 'Apple' && req.authorizationCode && apple.isConfigured && protector) {
        const token = await apple.exchangeCode(req.authorizationCode);
        if (token) q.keepApple.run(protector.protect(token), identity.subject);
        else log(`Signed in with Apple but kept no token to revoke for ${user.id}.`);
      }
      // The id and the provider, never the address.
      log(`Signed in ${user.id} with ${identity.provider}.`);
      return issue(user);
    },

    async refresh(refreshToken: string): Promise<Session> {
      const existing = q.tokenByHash.get(hashToken(refreshToken));
      if (!existing) {
        // Never issued here: ordinary after a restore, and not a replay.
        throw ApiError.unauthorized('Invalid refresh token.');
      }
      const at = now();
      const active = existing.revoked_at === null && existing.expires_at > at;
      if (!active) {
        // Rotated a moment ago: two contexts raced. Refuse without ending the family;
        // the client re-reads storage and retries with the winner's token.
        if (existing.replaced_by && existing.revoked_at !== null && at - existing.revoked_at <= REPLAY_GRACE_MS) {
          throw new ApiError(401, REFRESH_RACED, 'That refresh token was replaced moments ago. Try again shortly.');
        }
        // Rotated, and the replacement never used: the client lost the answer. Issue from the replacement.
        if (existing.replaced_by && existing.revoked_at !== null && at - existing.revoked_at <= LOST_ANSWER_WINDOW_MS) {
          const next = q.tokenById.get(existing.replaced_by);
          if (next && next.revoked_at === null && next.replaced_by === null && next.expires_at > at) {
            log(`Refresh answer for ${existing.user_id} was lost; reissuing from the unused replacement.`);
            const owner = q.userById.get(existing.user_id);
            if (!owner) throw ApiError.unauthorized('Invalid refresh token.');
            return issue(toUser(owner), next);
          }
        }
        log(
          existing.revoked_at === null
            ? `Refresh refused: the session for ${existing.user_id} expired; ending token family ${existing.id}.`
            : `WARNING refresh token replayed for ${existing.user_id}; ending token family ${existing.id}.`,
        );
        endFamily(existing);
        throw ApiError.unauthorized('Refresh token is no longer valid.');
      }
      const owner = q.userById.get(existing.user_id);
      if (!owner) throw ApiError.unauthorized('Invalid refresh token.');
      return issue(toUser(owner), existing);
    },

    /** Anonymous and idempotent: signing out twice is not an event. */
    logout(refreshToken: string) {
      const existing = q.tokenByHash.get(hashToken(refreshToken));
      if (existing && existing.revoked_at === null) q.revoke.run(now(), existing.id);
    },

    /** Ends every session the account has: "sign out everywhere". */
    signOutEverywhere(userId: string) {
      q.revokeAll.run(now(), userId);
    },

    /** The user an access token names, or a 401. */
    async authenticate(token: string): Promise<User> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'], currentDate: new Date(now()) });
        const row = payload.sub ? q.userById.get(payload.sub) : undefined;
        if (!row) throw ApiError.unauthorized();
        return toUser(row);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw ApiError.unauthorized();
      }
    },

    get(userId: string): User | null {
      const row = q.userById.get(userId);
      return row ? toUser(row) : null;
    },

    providers(userId: string): string[] {
      return q.loginsFor.all(userId).map((r) => r.provider);
    },

    rename(userId: string, name: string): User {
      const clean = name.trim().slice(0, MAX_NAME);
      if (!clean) throw ApiError.badRequest('NameRequired', 'Enter a name.');
      q.rename.run(clean, userId);
      return toUser(q.userById.get(userId)!);
    },

    /** Deletes the account and everything it owns; revokes Apple's token first (best effort). */
    async deleteAccount(userId: string) {
      if (protector) {
        for (const { apple_refresh } of q.appleTokens.all(userId)) {
          const token = protector.unprotect(apple_refresh);
          if (token) await apple.revoke(token);
        }
      }
      q.deleteUser.run(userId);
      log(`Deleted ${userId}.`);
    },

    /**
     * Someone stopped using Sign in with Apple for InkStat, or deleted their Apple ID.
     * The link goes; the InkStat account never does (the app's own delete does that).
     * Sessions end only when that link was the account's last way in.
     */
    async appleNotification(payload: string) {
      const notice = await identities.verifyAppleEvent(payload);
      if (notice.type !== 'consent-revoked' && notice.type !== 'account-delete') {
        log(`Apple ${notice.type} received.`);
        return;
      }
      const linked = q.login.get('Apple', notice.subject);
      if (!linked) return;
      q.deleteLogin.run('Apple', notice.subject);
      const anotherWayIn = q.loginsFor.all(linked.user_id).length > 0;
      if (!anotherWayIn) q.revokeAll.run(now(), linked.user_id);
      log(`Apple ${notice.type} for ${linked.user_id}: link removed${anotherWayIn ? '' : ', sessions ended'}.`);
    },

    /** Housekeeping: expired refresh tokens are worth nothing. */
    prune() {
      q.pruneTokens.run(now() - LOST_ANSWER_WINDOW_MS);
    },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;

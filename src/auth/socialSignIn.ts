import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Sign in with Apple and Google, on the phone. Ported from Orbit's client.
 *
 * The phone does the provider's sign-in and hands the ID token to the API
 * (`POST /v1/auth/social`), which checks it against the provider's keys and answers
 * with an InkStat session. Nothing here decides who anybody is; the server does.
 *
 * The SDKs are required lazily: both reach native code at import, which would make
 * every screen that offers the buttons untestable under Jest.
 */

export type IdentityProvider = 'Apple' | 'Google';

export interface ProviderCredential {
  readonly provider: IdentityProvider;
  readonly idToken: string;
  /** The raw nonce this sign-in was made with. Apple's token carries its hash. */
  readonly nonce?: string;
  /** Apple gives the full name to the app on the first sign-in only, never in the token. */
  readonly displayName?: string;
  /** Apple's one-time code; the server exchanges it for the token deletion must revoke. */
  readonly authorizationCode?: string;
}

/** The person closed the provider's sheet. Not an error, and not shown as one. */
export class SignInCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SignInCancelled';
  }
}

interface SocialConfig {
  readonly appleSignIn: boolean;
  readonly googleWebClientId?: string;
  readonly googleIosClientId?: string;
}

function config(): SocialConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
  return {
    appleSignIn: extra.appleSignIn === true,
    googleWebClientId: text(extra.googleWebClientId),
    googleIosClientId: text(extra.googleIosClientId),
  };
}

/**
 * Which buttons this build can offer. Apple only on iOS (Apple first there, per App
 * Store guideline 4.8). Google on Android with the web client id; on iOS it also
 * needs the iOS client id.
 */
export function availableProviders(platform: string = Platform.OS, built: SocialConfig = config()): IdentityProvider[] {
  const providers: IdentityProvider[] = [];
  if (platform === 'ios' && built.appleSignIn) providers.push('Apple');
  if (platform === 'android' && built.googleWebClientId) providers.push('Google');
  if (platform === 'ios' && built.googleWebClientId && built.googleIosClientId) providers.push('Google');
  return providers;
}

/** A provider's error as a line for the log: its code and message. Never a token. */
export function describeProviderError(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return [code, message].filter((p) => p !== undefined && p !== '').map(String).join(': ') || 'unknown';
  }
  return String(error);
}

/** "Dana Ghastly" from Apple's name parts, or undefined when it gave none. */
export function fullName(parts: { givenName?: string | null; familyName?: string | null } | null | undefined) {
  const name = [parts?.givenName, parts?.familyName]
    .map((p) => p?.trim())
    .filter((p): p is string => !!p)
    .join(' ');
  return name.length > 0 ? name : undefined;
}

/** Runs the provider's own sign-in sheet. Throws SignInCancelled when the person backs out. */
export async function signInWithProvider(provider: IdentityProvider): Promise<ProviderCredential> {
  return provider === 'Apple' ? signInWithApple() : signInWithGoogle();
}

async function signInWithApple(): Promise<ProviderCredential> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Apple = require('expo-apple-authentication') as typeof import('expo-apple-authentication');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as typeof import('expo-crypto');
  // A nonce, so a token lifted from one sign-in cannot be replayed in another.
  const nonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  try {
    const credential = await Apple.signInAsync({
      requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!credential.identityToken) throw new Error('Apple returned no identity token.');
    return {
      provider: 'Apple',
      idToken: credential.identityToken,
      nonce,
      displayName: fullName(credential.fullName),
      authorizationCode: credential.authorizationCode ?? undefined,
    };
  } catch (error) {
    if ((error as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled();
    throw error;
  }
}

async function signInWithGoogle(): Promise<ProviderCredential> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GoogleSignin, isCancelledResponse, isErrorWithCode, statusCodes } = require(
    '@react-native-google-signin/google-signin',
  ) as typeof import('@react-native-google-signin/google-signin');
  const built = config();
  // The web client id as the server client id makes it the token's audience on both
  // platforms, and so the one id the API has to list.
  GoogleSignin.configure({ webClientId: built.googleWebClientId, iosClientId: built.googleIosClientId });
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the remembered account so the picker always shows: a scorer's phone is
    // often shared, and signing out of InkStat does not sign out of the library.
    await GoogleSignin.signOut().catch(() => undefined);
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) throw new SignInCancelled();
    const idToken = response.data.idToken;
    if (!idToken) throw new Error('Google returned no ID token.');
    return { provider: 'Google', idToken, displayName: response.data.user.name ?? undefined };
  } catch (error) {
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) throw new SignInCancelled();
    throw error;
  }
}

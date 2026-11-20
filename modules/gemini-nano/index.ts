import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

export type NanoStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface NativeGeminiNano {
  setPreference(preference: 'full' | 'fast'): void;
  checkStatus(): Promise<NanoStatus>;
  baseModelName(): Promise<string>;
  download(): Promise<void>;
  warmup(): Promise<void>;
  /** Side by side (or stacked when vertical), with a dark bar between; returns a file:// URI. */
  joinImages(uris: string[], outPath: string, vertical?: boolean): Promise<string>;
  generate(
    requestId: number,
    imageUris: string[],
    system: string | null,
    prompt: string,
    maxOutputTokens: number,
    temperature: number,
  ): Promise<{ text: string; hitTokenLimit: boolean }>;
  addListener(
    event: 'onDownloadProgress',
    listener: (e: { bytes: number; total: number }) => void,
  ): EventSubscription;
  addListener(event: 'onText', listener: (e: { requestId: number; chars: number }) => void): EventSubscription;
}

/** Null on iOS, web, or builds without the module; callers fall back to llama.rn. */
const native: NativeGeminiNano | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeGeminiNano>('GeminiNano') : null;

/** ML Kit GenAI error codes (com.google.mlkit.genai.common.GenAiException.ErrorCode). */
export const NanoError = {
  BUSY: 9,
  NOT_AVAILABLE: 8,
  REQUEST_TOO_LARGE: 12,
  NOT_SUPPORTED: 16,
  BATTERY_QUOTA: 27,
  BACKGROUND_USE_BLOCKED: 30,
  NOT_ENOUGH_DISK_SPACE: 501,
  INVALID_INPUT_IMAGE: -102,
} as const;

export function nanoErrorCode(e: unknown): number | null {
  const code = (e as { code?: unknown })?.code;
  const m = typeof code === 'string' ? code.match(/^ERR_GEMINI_NANO_(-?\d+)$/) : null;
  return m ? Number(m[1]) : null;
}

export const GeminiNano = native;

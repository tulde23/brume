import type { GenerateRequest, GenerateResult, VisionBackend } from '@brume/ocr-engine';

import { GeminiNano, NanoError, nanoErrorCode } from '../../modules/gemini-nano';

export const GEMINI_NANO_ID = 'gemini-nano';

/** Gemini Nano writes roughly 3.5 characters per token; good enough for a progress bar. */
const CHARS_PER_TOKEN = 3.5;
const MAX_BUSY_RETRIES = 4;

let nextRequestId = 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * VisionBackend on Gemini Nano (Android AICore). On Pixel 10 this runs on the
 * Tensor TPU, which llama.rn cannot use. No JSON grammar is available, so the
 * engine's extractJson/coerce do the parsing, as they already do for retries.
 */
export class GeminiNanoBackend implements VisionBackend {
  readonly modelId = GEMINI_NANO_ID;

  static isSupported(): boolean {
    return GeminiNano !== null;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (!GeminiNano) throw new Error('Gemini Nano is not available on this device');
    const requestId = nextRequestId++;
    let chars = 0;
    const sub = GeminiNano.addListener('onText', (e) => {
      if (e.requestId !== requestId) return;
      chars += e.chars;
      req.onToken?.(Math.round(chars / CHARS_PER_TOKEN));
    });
    const stop = () => {
      // ML Kit has no cancel for a request in flight; the pipeline checks the signal after it returns.
    };
    req.signal?.addEventListener('abort', stop);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await GeminiNano.generate(
            requestId,
            req.imageUris,
            req.system ?? null,
            req.prompt,
            req.maxTokens,
            req.temperature ?? 0,
          );
          if (req.signal?.aborted) throw new Error('Extraction cancelled');
          return {
            text: result.text,
            hitTokenLimit: result.hitTokenLimit,
            tokens: Math.round(result.text.length / CHARS_PER_TOKEN),
          };
        } catch (e) {
          const code = nanoErrorCode(e);
          // AICore rate-limits bursts per app; back off and try again.
          if (code === NanoError.BUSY && attempt < MAX_BUSY_RETRIES && !req.signal?.aborted) {
            await sleep(1000 * 2 ** attempt);
            continue;
          }
          throw new Error(describeNanoError(code, e));
        }
      }
    } finally {
      sub.remove();
      req.signal?.removeEventListener('abort', stop);
    }
  }
}

export function describeNanoError(code: number | null, e: unknown): string {
  switch (code) {
    case NanoError.BACKGROUND_USE_BLOCKED:
      return 'Gemini Nano only works while Brume is on screen. Keep Brume open while it reads.';
    case NanoError.BATTERY_QUOTA:
      return "Android's daily limit for on-device AI in Brume was reached. Try again later, or switch models.";
    case NanoError.BUSY:
      return 'Gemini Nano is busy. Wait a moment and try again.';
    case NanoError.NOT_ENOUGH_DISK_SPACE:
      return 'Not enough free storage for Gemini Nano.';
    case NanoError.REQUEST_TOO_LARGE:
      return 'That crop was too large for Gemini Nano.';
    default:
      return e instanceof Error ? e.message : String(e);
  }
}

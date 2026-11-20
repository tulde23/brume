import {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  getModel,
  runTemplate,
  type DocumentTemplate,
  type ExtractionRun,
  type ImageOps,
  type RunOptions,
  type VisionBackend,
} from '@inkstat/ocr-engine';
import {
  LlamaVisionBackend,
  expoImageOps,
  modelPaths,
  modelStatus,
} from '@inkstat/ocr-engine/native';
import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { getSetting, setSetting } from '@/db';

import { GeminiNano, type NanoStatus } from '../../modules/gemini-nano';
import { GEMINI_NANO_ID, GeminiNanoBackend } from './geminiNanoBackend';

export { GEMINI_NANO_ID };

/**
 * Keeps at most one model in memory for the whole app. Any domain (basketball
 * today) calls `extract` with its own template; loading is shared.
 *
 * Two kinds of backend:
 * - llama.rn with a downloaded GGUF (every platform; GPU on iOS and Snapdragon)
 * - Gemini Nano through Android AICore (Pixel 10 and similar; uses the Tensor TPU)
 */
let loaded: LlamaVisionBackend | null = null;
let loading: Promise<LlamaVisionBackend> | null = null;

const ACTIVE_MODEL_KEY = 'activeModelId';

export async function getActiveModelId(db: SQLiteDatabase): Promise<string> {
  const saved = await getSetting(db, ACTIVE_MODEL_KEY);
  if (saved) return saved;
  // First run: prefer the system model when this phone has one ready, since it needs no download.
  return (await nanoStatus()) === 'available' ? GEMINI_NANO_ID : DEFAULT_MODEL_ID;
}

export async function setActiveModelId(db: SQLiteDatabase, id: string): Promise<void> {
  await setSetting(db, ACTIVE_MODEL_KEY, id);
  if (loaded && loaded.modelId !== id) await unloadModel();
}

export async function nanoStatus(): Promise<NanoStatus> {
  return (await nanoStatusDetail()).status;
}

/** Status plus why, for the model screen and the device log. */
export async function nanoStatusDetail(): Promise<{ status: NanoStatus; detail: string | null }> {
  if (!GeminiNano) return { status: 'unavailable', detail: 'Gemini Nano module not in this build' };
  try {
    const status = await GeminiNano.checkStatus();
    console.log(`[gemini-nano] checkStatus -> ${status}`);
    return { status, detail: status === 'unavailable' ? 'AICore reports UNAVAILABLE for this app' : null };
  } catch (e) {
    const code = (e as { code?: string }).code;
    const message = e instanceof Error ? e.message : String(e);
    console.log(`[gemini-nano] checkStatus failed: ${code ?? ''} ${message}`);
    return { status: 'unavailable', detail: `${code ? `${code}: ` : ''}${message}` };
  }
}

export interface ActiveModel {
  id: string;
  name: string;
  ready: boolean;
  /** Rough RAM needed; null for system-managed models. */
  approxRamBytes: number | null;
}

/** What Home needs to know: which model, and can it read a page right now. */
export async function activeModel(db: SQLiteDatabase): Promise<ActiveModel> {
  const id = await getActiveModelId(db);
  if (id === GEMINI_NANO_ID) {
    return { id, name: 'Gemini Nano', ready: (await nanoStatus()) === 'available', approxRamBytes: null };
  }
  const spec = MODEL_CATALOG.find((m) => m.id === id) ?? getModel(DEFAULT_MODEL_ID);
  return { id: spec.id, name: spec.name, ready: modelStatus(spec) === 'ready', approxRamBytes: spec.approxRamBytes };
}

async function llamaBackendFor(modelId: string, onLoad?: (fraction: number) => void): Promise<LlamaVisionBackend> {
  if (loaded?.modelId === modelId) return loaded;
  if (loading) {
    const b = await loading;
    if (b.modelId === modelId) return b;
  }
  await unloadModel();
  const spec = getModel(modelId);
  if (modelStatus(spec) !== 'ready') throw new Error(`${spec.name} is not downloaded yet`);
  // llama.rn picks 4 threads on 8-core Android phones; 6 keeps the big and mid cores busy
  // without contending with the UI thread. Elsewhere its default is already sensible.
  const threads = Platform.OS === 'android' ? 6 : undefined;
  loading = LlamaVisionBackend.load(spec, modelPaths(spec), onLoad, { threads });
  try {
    loaded = await loading;
    return loaded;
  } finally {
    loading = null;
  }
}

async function backendFor(modelId: string, onLoad?: (fraction: number) => void): Promise<VisionBackend> {
  if (modelId === GEMINI_NANO_ID) {
    if ((await nanoStatus()) !== 'available') throw new Error('Gemini Nano is not ready on this phone');
    // Free llama.rn's memory; AICore runs in its own process.
    await unloadModel();
    onLoad?.(1);
    return new GeminiNanoBackend();
  }
  return llamaBackendFor(modelId, onLoad);
}

export async function extract(
  modelId: string,
  imageUri: string,
  template: DocumentTemplate,
  options: RunOptions & { onModelLoad?: (fraction: number) => void } = {},
): Promise<ExtractionRun> {
  const backend = await backendFor(modelId, options.onModelLoad);
  return runTemplate(backend, imageOps, imageUri, template, options);
}

let joinCount = 0;

/**
 * expo-image-manipulator can crop and resize but not composite, so joining
 * column slices uses the native module where it exists (Android). Elsewhere
 * `join` is absent and templates fall back to full-width strips.
 */
const imageOps: ImageOps = GeminiNano
  ? {
      ...expoImageOps,
      join: (uris, options) =>
        GeminiNano!.joinImages(uris, new File(Paths.cache, `join-${Date.now()}-${joinCount++}.png`).uri, !!options?.vertical),
    }
  : expoImageOps;

export async function unloadModel(): Promise<void> {
  const b = loaded;
  loaded = null;
  await b?.release();
}

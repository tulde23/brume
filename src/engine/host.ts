import {
  DEFAULT_MODEL_ID,
  getModel,
  runTemplate,
  type DocumentTemplate,
  type ExtractionRun,
  type RunOptions,
} from '@brume/ocr-engine';
import {
  LlamaVisionBackend,
  expoImageOps,
  modelPaths,
  modelStatus,
} from '@brume/ocr-engine/native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';

import { getSetting, setSetting } from '@/db';

/**
 * Keeps at most one model in memory for the whole app. Any domain (basketball
 * today) calls `extract` with its own template; loading is shared.
 */
let loaded: LlamaVisionBackend | null = null;
let loading: Promise<LlamaVisionBackend> | null = null;

const ACTIVE_MODEL_KEY = 'activeModelId';

export async function getActiveModelId(db: SQLiteDatabase): Promise<string> {
  return (await getSetting(db, ACTIVE_MODEL_KEY)) ?? DEFAULT_MODEL_ID;
}

export async function setActiveModelId(db: SQLiteDatabase, id: string): Promise<void> {
  await setSetting(db, ACTIVE_MODEL_KEY, id);
  if (loaded && loaded.modelId !== id) await unloadModel();
}

async function backendFor(modelId: string, onLoad?: (fraction: number) => void): Promise<LlamaVisionBackend> {
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

export async function extract(
  modelId: string,
  imageUri: string,
  template: DocumentTemplate,
  options: RunOptions & { onModelLoad?: (fraction: number) => void } = {},
): Promise<ExtractionRun> {
  const backend = await backendFor(modelId, options.onModelLoad);
  return runTemplate(backend, expoImageOps, imageUri, template, options);
}

export async function unloadModel(): Promise<void> {
  const b = loaded;
  loaded = null;
  await b?.release();
}

import { Directory, File, Paths } from 'expo-file-system';

import type { ModelFile, ModelSpec } from './models';

export type ModelStatus = 'missing' | 'partial' | 'ready';

export interface DownloadProgress {
  bytesWritten: number;
  totalBytes: number;
  /** Which file is downloading right now. */
  fileName: string;
}

const modelsRoot = () => new Directory(Paths.document, 'models');
const modelDir = (spec: ModelSpec) => new Directory(modelsRoot(), spec.id);
const fileFor = (spec: ModelSpec, f: ModelFile) => new File(modelDir(spec), f.fileName);

/** A file is "ready" when it exists with the exact expected size (the hash is checked once, at download). */
function isComplete(spec: ModelSpec, f: ModelFile): boolean {
  const file = fileFor(spec, f);
  return file.exists && file.size === f.sizeBytes;
}

export function modelStatus(spec: ModelSpec): ModelStatus {
  const done = [spec.model, spec.mmproj].filter((f) => isComplete(spec, f)).length;
  if (done === 2) return 'ready';
  return done === 0 && !modelDir(spec).exists ? 'missing' : 'partial';
}

export function modelPaths(spec: ModelSpec): { model: string; mmproj: string } {
  return { model: fileFor(spec, spec.model).uri, mmproj: fileFor(spec, spec.mmproj).uri };
}

/**
 * Download both model files, skipping any already complete. Each file lands as
 * `<name>.part`, is size- and SHA-256-checked, then renamed, so a killed app
 * never leaves a truncated file that looks ready.
 */
export async function downloadModel(
  spec: ModelSpec,
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const dir = modelDir(spec);
  dir.create({ intermediates: true, idempotent: true });

  const files = [spec.model, spec.mmproj];
  const totalBytes = files.reduce((n, f) => n + f.sizeBytes, 0);
  let doneBytes = files.filter((f) => isComplete(spec, f)).reduce((n, f) => n + f.sizeBytes, 0);

  for (const f of files) {
    if (isComplete(spec, f)) continue;
    if (signal?.aborted) throw new Error('Download cancelled');

    const part = new File(dir, `${f.fileName}.part`);
    if (part.exists) part.delete();
    const final = fileFor(spec, f);
    if (final.exists) final.delete();

    const base = doneBytes;
    const task = File.createDownloadTask(f.url, part, {
      signal,
      onProgress: ({ bytesWritten }) =>
        onProgress?.({ bytesWritten: base + bytesWritten, totalBytes, fileName: f.fileName }),
    });
    const downloaded = await task.downloadAsync();
    if (!downloaded) throw new Error('Download paused');

    if (part.size !== f.sizeBytes) {
      part.delete();
      throw new Error(`${f.fileName}: expected ${f.sizeBytes} bytes, got ${part.size}`);
    }
    const hash = await part.digest('SHA-256');
    if (hash.toLowerCase() !== f.sha256) {
      part.delete();
      throw new Error(`${f.fileName}: checksum mismatch, file discarded`);
    }
    part.rename(f.fileName);
    doneBytes += f.sizeBytes;
  }
  onProgress?.({ bytesWritten: totalBytes, totalBytes, fileName: '' });
}

export function deleteModel(spec: ModelSpec): void {
  const dir = modelDir(spec);
  if (dir.exists) dir.delete();
}

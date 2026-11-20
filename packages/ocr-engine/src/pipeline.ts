import { tileRects, toPixels } from './geometry';
import { coerce, describeSchema, extractJson, toJsonSchema } from './schema';
import type {
  DocumentTemplate,
  ExtractionProgress,
  ExtractionRun,
  ImageOps,
  RegionResult,
  RegionSpec,
  VisionBackend,
} from './types';

export interface RunOptions {
  onProgress?: (p: ExtractionProgress) => void;
  signal?: AbortSignal;
  /** Extra attempts when the output is not valid JSON. */
  retries?: number;
  /** Only run these regions (e.g. re-read one area after the user fixes a crop). */
  regionIds?: string[];
}

const DEFAULT_MAX_SIDE = 1024;

export function buildPrompt(template: DocumentTemplate, region: RegionSpec, tile: number, tiles: number) {
  const part =
    tiles > 1
      ? `\nThis image is strip ${tile + 1} of ${tiles} cut from the same area, top to bottom. ` +
        'Rows cut off at the top or bottom edge may be partial; include them only if you can read them.'
      : '';
  return (
    `${region.prompt}${part}\n\n` +
    'Respond with JSON only, in exactly this shape:\n' +
    describeSchema(region.schema) +
    '\nUse null for anything blank or unreadable. Do not guess.'
  );
}

/** Read every region of a page image with the given backend. */
export async function runTemplate(
  backend: VisionBackend,
  images: ImageOps,
  sourceUri: string,
  template: DocumentTemplate,
  options: RunOptions = {},
): Promise<ExtractionRun> {
  const startedAt = Date.now();
  const { width, height } = await images.size(sourceUri);
  const regions = options.regionIds
    ? template.regions.filter((r) => options.regionIds!.includes(r.id))
    : template.regions;

  const jobs = regions.flatMap((region) =>
    tileRects(region.rect, region.tiles).map((rect, tileIndex, all) => ({
      region,
      rect,
      tileIndex,
      tileCount: all.length,
    })),
  );

  const results: RegionResult[] = [];
  for (const [i, job] of jobs.entries()) {
    if (options.signal?.aborted) throw new Error('Extraction cancelled');
    options.onProgress?.({ done: i, total: jobs.length, regionId: job.region.id, tileIndex: job.tileIndex });

    const t0 = Date.now();
    const imageUri = await images.crop(
      sourceUri,
      toPixels(job.rect, width, height),
      job.region.maxImageSide ?? DEFAULT_MAX_SIDE,
    );
    const prompt = buildPrompt(template, job.region, job.tileIndex, job.tileCount);
    const jsonSchema = toJsonSchema(job.region.schema);
    const maxAttempts = 1 + (options.retries ?? 1);

    let raw = '';
    let error: string | undefined;
    let data: unknown = null;
    let warnings: string[] = [];
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        raw = await backend.generate({
          imageUri,
          system: template.systemPrompt,
          prompt,
          jsonSchema,
          maxTokens: job.region.maxTokens,
          // Deterministic first; nudge on retry so we do not repeat the same failure.
          temperature: attempts === 1 ? 0 : 0.3,
          signal: options.signal,
        });
        const coerced = coerce(job.region.schema, extractJson(raw));
        data = coerced.value;
        warnings = coerced.warnings;
        error = undefined;
        break;
      } catch (e) {
        if (options.signal?.aborted) throw e;
        error = e instanceof Error ? e.message : String(e);
      }
    }

    results.push({
      regionId: job.region.id,
      tileIndex: job.tileIndex,
      tileCount: job.tileCount,
      rect: job.rect,
      imageUri,
      data,
      raw,
      warnings,
      error,
      attempts,
      durationMs: Date.now() - t0,
    });
  }
  options.onProgress?.({ done: jobs.length, total: jobs.length, regionId: '', tileIndex: 0 });

  return {
    templateId: template.id,
    templateVersion: template.version,
    modelId: backend.modelId,
    sourceUri,
    results,
    startedAt,
    finishedAt: Date.now(),
  };
}

/** Results for one region, in tile order. */
export function resultsFor(run: ExtractionRun, regionId: string): RegionResult[] {
  return run.results
    .filter((r) => r.regionId === regionId)
    .sort((a, b) => a.tileIndex - b.tileIndex);
}

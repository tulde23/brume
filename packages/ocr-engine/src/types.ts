/**
 * Core types for the OCR engine. Nothing in this package may know about a
 * specific document type (basketball, receipts, ...). Domains describe their
 * documents with a DocumentTemplate and interpret the JSON that comes back.
 */

/** Rectangle in normalized page coordinates: 0..1 on both axes, origin top-left. */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangle in source-image pixels. */
export interface PixelRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * The small JSON Schema subset the engine understands. It is sent to llama.cpp
 * as a grammar constraint, and used again after generation to coerce and check
 * the output, because small models still drift (numbers as strings, etc.).
 */
export type FieldSchema =
  | { type: 'string'; description?: string; nullable?: boolean; enum?: string[] }
  | {
      type: 'integer' | 'number';
      description?: string;
      nullable?: boolean;
      minimum?: number;
      maximum?: number;
    }
  | { type: 'boolean'; description?: string; nullable?: boolean }
  | { type: 'array'; items: FieldSchema; description?: string; maxItems?: number }
  | {
      type: 'object';
      properties: Record<string, FieldSchema>;
      required?: string[];
      description?: string;
    };

export interface TileSpec {
  /** Number of horizontal strips to cut the region into. */
  rows: number;
  /** Fraction of a strip's height shared with its neighbour, so rows on a seam are not lost. */
  overlap: number;
}

/** One area of the page to read, and what to read out of it. */
export interface RegionSpec {
  id: string;
  label: string;
  rect: NormRect;
  prompt: string;
  schema: FieldSchema;
  /** Split tall, dense regions (tables) into strips; small models read small crops far better. */
  tiles?: TileSpec;
  /** Longest side, in pixels, of each crop sent to the model. */
  maxImageSide?: number;
  maxTokens?: number;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  version: number;
  /** Prepended to every region's prompt. */
  systemPrompt?: string;
  regions: RegionSpec[];
}

export interface RegionResult {
  regionId: string;
  tileIndex: number;
  tileCount: number;
  /** Where on the page this crop came from (normalized). */
  rect: NormRect;
  /** The crop that was sent to the model; useful for side-by-side review. */
  imageUri: string;
  /** Parsed and coerced output, or null if the model never produced valid JSON. */
  data: unknown;
  raw: string;
  /** Problems found while coercing the output against the schema. */
  warnings: string[];
  error?: string;
  attempts: number;
  durationMs: number;
}

export interface ExtractionRun {
  templateId: string;
  templateVersion: number;
  modelId: string;
  sourceUri: string;
  results: RegionResult[];
  startedAt: number;
  finishedAt: number;
}

export interface ExtractionProgress {
  done: number;
  total: number;
  regionId: string;
  tileIndex: number;
}

/**
 * Anything that can turn (image, prompt, schema) into text. The on-device
 * llama.rn backend implements this; tests use a fake; a LAN server backend
 * could implement it later without touching the pipeline or any domain.
 */
export interface VisionBackend {
  readonly modelId: string;
  generate(request: GenerateRequest): Promise<string>;
}

export interface GenerateRequest {
  imageUri: string;
  system?: string;
  prompt: string;
  /** Plain JSON Schema (already converted from FieldSchema). */
  jsonSchema?: object;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Image operations the pipeline needs, abstracted so the pipeline is testable off-device. */
export interface ImageOps {
  size(uri: string): Promise<{ width: number; height: number }>;
  crop(uri: string, rect: PixelRect, maxSide: number): Promise<string>;
}

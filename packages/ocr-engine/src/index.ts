// Pure core: safe to import anywhere (domains, tests). No native modules.
export * from './types';
export { coerce, describeSchema, extractJson, toJsonSchema } from './schema';
export { tileRects, toPixels } from './geometry';
export {
  buildPrompt,
  columnLayout,
  nextAttempt,
  resultsFor,
  runTemplate,
  type ColumnLayout,
  type RunOptions,
} from './pipeline';
export { DEFAULT_MODEL_ID, MODEL_CATALOG, getModel, type ModelFile, type ModelSpec } from './models';

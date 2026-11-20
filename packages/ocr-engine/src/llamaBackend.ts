import { initLlama, type LlamaContext, type RNLlamaOAICompatibleMessage } from 'llama.rn';

import type { ModelSpec } from './models';
import type { GenerateRequest, GenerateResult, VisionBackend } from './types';

/** On-device vision backend: llama.cpp via llama.rn, with the model's mmproj for images. */
export class LlamaVisionBackend implements VisionBackend {
  private constructor(
    private readonly ctx: LlamaContext,
    readonly modelId: string,
    readonly usingGpu: boolean,
  ) {}

  static async load(
    spec: ModelSpec,
    paths: { model: string; mmproj: string },
    onProgress?: (fraction: number) => void,
    options: { threads?: number } = {},
  ): Promise<LlamaVisionBackend> {
    const ctx = await initLlama(
      {
        model: paths.model,
        n_ctx: spec.contextSize,
        n_gpu_layers: 99,
        ...(options.threads ? { n_threads: options.threads } : {}),
        // Context shifting corrupts image tokens; llama.rn requires it off for multimodal.
        ctx_shift: false,
        // Map weights from the file instead of copying them, so Android can page them
        // out under pressure rather than killing the app.
        use_mmap: true,
        use_mlock: false,
        // 8-bit keys cut the KV cache ~25% with no measurable accuracy loss.
        // (Quantized values would need flash attention, which not every device has.)
        cache_type_k: 'q8_0',
      },
      (p) => onProgress?.(p / 100),
    );
    const ok = await ctx.initMultimodal({
      path: paths.mmproj,
      use_gpu: true,
      image_max_tokens: spec.imageMaxTokens,
    });
    if (!ok) {
      await ctx.release();
      throw new Error('This model could not load its vision projector');
    }
    // One line in the device log saying where inference runs; invaluable when a phone is slow.
    console.log(
      `[ocr-engine] ${spec.id} loaded: gpu=${ctx.gpu}` +
        (ctx.gpu ? '' : ` (${ctx.reasonNoGPU || 'no reason given'})`) +
        ` devices=${JSON.stringify(ctx.devices ?? [])} threads=${options.threads ?? 'default'}`,
    );
    return new LlamaVisionBackend(ctx, spec.id, Boolean(ctx.gpu));
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const messages: RNLlamaOAICompatibleMessage[] = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({
      role: 'user',
      content: [
        ...req.imageUris.map((url) => ({ type: 'image_url', image_url: { url } })),
        { type: 'text', text: req.prompt },
      ],
    });

    const stop = () => void this.ctx.stopCompletion();
    req.signal?.addEventListener('abort', stop);
    let count = 0;
    try {
      const result = await this.ctx.completion(
        {
          messages,
          response_format: req.jsonSchema
            ? { type: 'json_schema', json_schema: { strict: true, schema: req.jsonSchema } }
            : undefined,
          n_predict: req.maxTokens,
          temperature: req.temperature ?? 0,
          top_k: 20,
        },
        () => req.onToken?.(++count),
      );
      if (req.signal?.aborted) throw new Error('Extraction cancelled');
      return {
        text: result.content || result.text,
        hitTokenLimit: Boolean(result.stopped_limit),
        tokens: result.tokens_predicted ?? count,
      };
    } finally {
      req.signal?.removeEventListener('abort', stop);
    }
  }

  async release(): Promise<void> {
    await this.ctx.release();
  }
}

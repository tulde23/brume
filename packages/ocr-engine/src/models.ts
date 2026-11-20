export interface ModelFile {
  url: string;
  fileName: string;
  sizeBytes: number;
  /** Hex SHA-256 from the Hugging Face LFS pointer. */
  sha256: string;
}

export interface ModelSpec {
  id: string;
  name: string;
  description: string;
  model: ModelFile;
  /** Vision projector that turns images into tokens the model can read. */
  mmproj: ModelFile;
  /**
   * Tokens of KV cache to reserve. One region needs at most image tokens + ~500 prompt
   * + maxTokens output, so keep this near 2x that: every 4096 tokens of a 2B model's
   * cache costs ~350 MB, and Android kills the app outright when memory runs short.
   */
  contextSize: number;
  /** Upper bound on tokens per image. More reads finer handwriting, costs time and memory. */
  imageMaxTokens: number;
  /** Rough RAM needed while running, to warn on small devices. */
  approxRamBytes: number;
}

const HF = 'https://huggingface.co';

export const MODEL_CATALOG: ModelSpec[] = [
  {
    id: 'qwen3-vl-2b-q8',
    name: 'Qwen3-VL 2B',
    description: 'Default. Good handwriting and table reading for its size. ~2.3 GB download.',
    model: {
      url: `${HF}/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3-VL-2B-Instruct-Q8_0.gguf`,
      fileName: 'Qwen3-VL-2B-Instruct-Q8_0.gguf',
      sizeBytes: 1_834_427_296,
      sha256: 'b7802e29f71a9e5b5e3f83f613df898a2204342dcea71a231ea501d481813c39',
    },
    mmproj: {
      url: `${HF}/ggml-org/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf`,
      fileName: 'mmproj-Qwen3-VL-2B-Instruct-Q8_0.gguf',
      sizeBytes: 445_053_056,
      sha256: '69066c8f279ec85ff48ab4059f6ebba0d2932ca57667f2bbdac7d9805bca9e7b',
    },
    contextSize: 4096,
    imageMaxTokens: 1024,
    approxRamBytes: 2.9e9,
  },
  {
    id: 'qwen2.5-vl-3b-q4',
    name: 'Qwen2.5-VL 3B',
    description: 'Larger and slower; try it if the default misreads your pages. ~2.8 GB download.',
    model: {
      url: `${HF}/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf`,
      fileName: 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
      sizeBytes: 1_929_901_056,
      sha256: 'd02fe9b69ad8cadbbd228e387667af66612c44bed29ffc8eb1e7caf9ac486c12',
    },
    mmproj: {
      url: `${HF}/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf`,
      fileName: 'mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf',
      sizeBytes: 844_757_728,
      sha256: '980c9b2f78c04e6cff93d277ada09e768394f112d75db3b4e9dea8a69f9fb904',
    },
    contextSize: 4096,
    imageMaxTokens: 1024,
    approxRamBytes: 3.6e9,
  },
];

export const DEFAULT_MODEL_ID = MODEL_CATALOG[0].id;

export function getModel(id: string): ModelSpec {
  const spec = MODEL_CATALOG.find((m) => m.id === id);
  if (!spec) throw new Error(`Unknown model ${id}`);
  return spec;
}

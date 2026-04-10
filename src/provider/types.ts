export interface RuntimeMetadata {
  readonly specificationVersion?: string;
  readonly provider?: string;
  readonly modelId?: string;
  readonly [key: string]: unknown;
}

export interface ModelRuntimeGenerateResult {
  content?: unknown[];
  finishReason?: unknown;
  usage?: unknown;
}

export interface ModelRuntimeStreamResult {
  stream: ReadableStream<unknown>;
}

export interface ModelRuntime extends RuntimeMetadata {
  readonly _isVfLocalModel?: boolean;
  doGenerate(options: unknown): PromiseLike<ModelRuntimeGenerateResult>;
  doStream(options: unknown): PromiseLike<ModelRuntimeStreamResult>;
}

export interface EmbeddingRuntime extends RuntimeMetadata {
  readonly maxEmbeddingsPerCall?: number | PromiseLike<number | undefined>;
  readonly supportsParallelCalls?: boolean | PromiseLike<boolean | undefined>;
  doEmbed(options: {
    values: string[];
    abortSignal?: AbortSignal;
  }): PromiseLike<{
    embeddings: number[][];
    usage?: {
      tokens?: number;
    };
    rawResponse?: unknown;
    warnings?: unknown[];
  }>;
}

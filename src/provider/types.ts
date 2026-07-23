/** Metadata exposed by a model or embedding runtime. */
export interface RuntimeMetadata {
  /** Runtime contract version implemented by the provider. */
  readonly specificationVersion?: string;
  /** Stable provider identifier. */
  readonly provider?: string;
  /** Stable model identifier within the provider. */
  readonly modelId?: string;
  /** Provider-specific metadata. */
  readonly [key: string]: unknown;
}

/** Result returned by non-streaming model generation. */
export interface ModelRuntimeGenerateResult {
  /** Generated content parts. */
  content?: unknown[];
  /** Provider finish reason. */
  finishReason?: unknown;
  /** Provider usage metadata. */
  usage?: unknown;
  /** Warnings produced while translating the request. */
  warnings?: unknown[];
}

/** Result returned when model streaming starts. */
export interface ModelRuntimeStreamResult {
  /** Stream of normalized provider parts. */
  stream: ReadableStream<unknown>;
  /** Warnings produced before the stream starts. */
  warnings?: unknown[];
}

/** Public API contract for model runtime. */
export interface ModelRuntime extends RuntimeMetadata {
  /** Internal marker for the built-in local inference runtime. */
  readonly _isVfLocalModel?: boolean;
  /** Requests that non-streaming generation use the streaming transport. */
  readonly _generateViaStream?: boolean;
  /** Generate one complete model response. */
  doGenerate(options: unknown): PromiseLike<ModelRuntimeGenerateResult>;
  /** Start a streaming model response. */
  doStream(options: unknown): PromiseLike<ModelRuntimeStreamResult>;
}

/** Public API contract for an embedding runtime. */
export interface EmbeddingRuntime extends RuntimeMetadata {
  /** Maximum number of input values accepted by one call. */
  readonly maxEmbeddingsPerCall?: number | PromiseLike<number | undefined>;
  /** Whether independent calls can execute in parallel. */
  readonly supportsParallelCalls?: boolean | PromiseLike<boolean | undefined>;
  /** Embed a collection of text values. */
  doEmbed(options: {
    /** Text values to embed. */
    values: string[];
    /** Signal used to cancel the request. */
    abortSignal?: AbortSignal;
  }): PromiseLike<{
    /** One embedding vector for each input value. */
    embeddings: number[][];
    /** Provider token usage, when available. */
    usage?: {
      /** Total tokens consumed by the embedding request. */
      tokens?: number;
    };
    /** Raw provider response for diagnostics and advanced integrations. */
    rawResponse?: unknown;
    /** Warnings produced while translating the request. */
    warnings?: unknown[];
  }>;
}

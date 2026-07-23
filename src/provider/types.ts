export interface RuntimeMetadata {
  readonly specificationVersion?: string;
  readonly provider?: string;
  readonly modelId?: string;
  readonly [key: string]: unknown;
}

/** Canonical provider-facing prompt message contract. */
export type RuntimePromptMessage =
  | { role: "system"; content: string }
  | {
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image" | "file"; mediaType: string; url: string; filename?: string }
    >;
  }
  | {
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
        providerExecuted?: boolean;
      }
      | {
        type: "reasoning";
        text?: string;
        signature?: string;
        redactedData?: string;
      }
    >;
    providerToolCalls?: Array<{
      toolCallId: string;
      toolName: string;
      input: unknown;
      supportsDeferredResults?: boolean;
    }>;
    providerMetadata?: Record<string, unknown>;
  }
  | {
    role: "tool";
    content: Array<{
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: { type: "json"; value: unknown };
    }>;
  };

export interface ModelRuntimeGenerateResult {
  content?: unknown[];
  finishReason?: unknown;
  usage?: unknown;
  warnings?: unknown[];
  providerMetadata?: Record<string, unknown>;
}

export interface ModelRuntimeStreamResult {
  stream: ReadableStream<unknown>;
  warnings?: unknown[];
}

/** Public API contract for model runtime. */
export interface ModelRuntime extends RuntimeMetadata {
  readonly _isVfLocalModel?: boolean;
  readonly _generateViaStream?: boolean;
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

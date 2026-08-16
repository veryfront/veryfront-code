export interface RuntimeMetadata {
  readonly specificationVersion?: string;
  readonly provider?: string;
  readonly modelId?: string;
  /** Canonical underlying model provider when a gateway runtime masks it. */
  readonly modelProvider?: string;
  readonly [key: string]: unknown;
}

type RuntimePromptAssistantContentPart =
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
  };

/**
 * Canonical assistant content accepted when invoking a model runtime.
 *
 * `RuntimePromptMessage` retains its historical assistant union for source
 * compatibility. Model-runtime inputs additionally represent tool results
 * when the provider executed the tool itself. Provider request builders must
 * replay those parts from validated provider metadata because hosted-tool wire
 * formats are not interchangeable with ordinary client-side function calls.
 */
export type RuntimeAssistantContentPart =
  | Exclude<RuntimePromptAssistantContentPart, { type: "tool-call" }>
  | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: unknown;
    providerExecuted?: boolean;
    dynamic?: boolean;
    supportsDeferredResults?: boolean;
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    result: unknown;
    providerExecuted: true;
    isError?: boolean;
    dynamic?: boolean;
    supportsDeferredResults?: boolean;
  };

/**
 * Historical mutable provider-facing prompt contract retained for source
 * compatibility.
 *
 * Model-runtime hooks receive the immutable {@link ModelRuntimePromptMessage}
 * view, which also includes provider-executed assistant tool results.
 */
export type RuntimePromptMessage =
  | {
    role: "system";
    content: string;
    providerOptions?: Record<string, unknown>;
  }
  | {
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image" | "file"; mediaType: string; url: string; filename?: string }
    >;
  }
  | {
    role: "assistant";
    content: Array<RuntimePromptAssistantContentPart>;
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

type DeepReadonly<T> = T extends (...args: never[]) => unknown ? T
  : T extends Array<infer Item> ? ReadonlyArray<DeepReadonly<Item>>
  : T extends object ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

type ModelRuntimeAssistantPromptMessage =
  & Omit<
    DeepReadonly<Extract<RuntimePromptMessage, { role: "assistant" }>>,
    "content"
  >
  & {
    readonly content: ReadonlyArray<DeepReadonly<RuntimeAssistantContentPart>>;
  };

/**
 * Immutable prompt view accepted by model-runtime calls.
 *
 * {@link RuntimePromptMessage} retains its historical mutable collection
 * contract, while this input view also accepts deeply readonly `as const`
 * prompts and provider-executed assistant tool results.
 */
export type ModelRuntimePromptMessage =
  | DeepReadonly<Exclude<RuntimePromptMessage, { role: "assistant" }>>
  | ModelRuntimeAssistantPromptMessage;

export interface ModelRuntimeGenerateResult<ContentPart = unknown> {
  content?: ContentPart[];
  finishReason?: unknown;
  usage?: unknown;
  warnings?: unknown[];
  providerMetadata?: Record<string, unknown>;
}

export interface ModelRuntimeStreamResult {
  stream: ReadableStream<unknown>;
  warnings?: unknown[];
}

/** Provider-neutral reasoning controls accepted by model runtimes. */
export interface RuntimeReasoningOption {
  enabled?: boolean;
  effort?: "low" | "medium" | "high" | "max";
  budgetTokens?: number;
}

/** Canonical tool definition sent to a model runtime. */
export type ModelRuntimeToolDefinition =
  | {
    type: "function";
    name: string;
    description?: string;
    inputSchema: unknown;
  }
  | {
    type: "provider";
    name: string;
    id: `${string}.${string}`;
    args: Record<string, unknown>;
  };

/** Provider-neutral structured-output request. */
export type RuntimeResponseFormat =
  | { type: "text" }
  | { type: "json" }
  | {
    type: "json_schema";
    name: string;
    schema: unknown;
    description?: string;
    strict?: boolean;
  };

/**
 * Canonical request contract passed to `ModelRuntime` generation hooks.
 *
 * Provider implementations may refine provider-specific option values, but
 * should not redefine or silently omit these framework-owned fields.
 */
export interface ModelRuntimeCallOptions {
  prompt: readonly ModelRuntimePromptMessage[];
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: readonly string[];
  tools?: readonly ModelRuntimeToolDefinition[];
  toolChoice?: unknown;
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
  /**
   * Request provider-native stream chunks. Raw values are exposed only through
   * the full stream as deeply owned, bounded JSON events.
   */
  includeRawChunks?: boolean;
  abortSignal?: AbortSignal;
  userId?: string;
  responseFormat?: RuntimeResponseFormat;
}

/** Explicit behavioral support advertised by a model runtime. */
export interface ModelRuntimeCapabilities {
  /**
   * Whether the runtime accepts and can emit tool calls. Omission preserves
   * legacy behavior: false for legacy local runtimes and true otherwise.
   */
  readonly toolCalling?: boolean;
  /** Whether the runtime accepts JSON or JSON-schema response formats. */
  readonly structuredOutput?: boolean;
}

/** Public API contract for model runtime. */
export interface ModelRuntime<
  CallOptions = unknown,
  ContentPart = unknown,
> extends RuntimeMetadata {
  /**
   * Where inference executes. When omitted, legacy `provider: "local"`,
   * `local/*` model IDs, and `_isVfLocalModel` markers remain server-local.
   */
  readonly executionMode?: "remote" | "server-local";
  /** Provider behavior, kept separate from execution placement. */
  readonly runtimeCapabilities?: ModelRuntimeCapabilities;
  readonly _generateViaStream?: boolean;
  /**
   * Complete any provider-specific readiness work before response headers are
   * committed. Implementations must be idempotent and may cache successful
   * preparation.
   */
  prepare?(abortSignal?: AbortSignal): PromiseLike<void>;
  doGenerate(options: CallOptions): PromiseLike<ModelRuntimeGenerateResult<ContentPart>>;
  doStream(options: CallOptions): PromiseLike<ModelRuntimeStreamResult>;
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

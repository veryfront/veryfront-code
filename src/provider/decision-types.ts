/** Typed decision calls are separate from text generation and agent tool calls. */
export type DecisionJSON =
  | null
  | boolean
  | number
  | string
  | readonly DecisionJSON[]
  | { readonly [key: string]: DecisionJSON };

/** Shared evidence, or evidence specific to one question. */
export type DecisionContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly url: string }
  | {
    readonly type: "json";
    readonly data:
      | { readonly [key: string]: DecisionJSON }
      | readonly {
        readonly [key: string]: DecisionJSON;
      }[];
  };

/** Text or structured evidence evaluated together in a decision call. */
export type DecisionContent = string | readonly DecisionContentPart[];

/** A named predicate, choice, or ordered scoring question. */
export type DecisionQuestion =
  & {
    /** Unique within a call; echoed in the answer. */
    readonly name: string;
    readonly instructions: DecisionContent;
  }
  & (
    | { readonly type: "predicate" }
    | {
      readonly type: "choice";
      readonly choices: readonly {
        readonly value: string | boolean;
        readonly description?: string;
      }[];
    }
    | {
      readonly type: "score";
      /** Ordered levels: their zero-based indices define the numeric scale. */
      readonly levels: readonly { readonly label: string; readonly description?: string }[];
    }
  );

/** A typed answer or explicit refusal, correlated by question name. */
export type DecisionAnswer =
  & { readonly name: string }
  & (
    | { readonly type: "refusal" }
    | { readonly type: "predicate"; readonly probability: number }
    | {
      readonly type: "choice";
      readonly choice: string | boolean;
      readonly confidence: number;
      readonly probabilities: readonly {
        readonly value: string | boolean;
        readonly probability: number;
      }[];
    }
    | {
      readonly type: "score";
      readonly score: number;
      readonly confidence: number;
      readonly probabilities: readonly {
        readonly value: number;
        readonly label: string;
        readonly probability: number;
      }[];
    }
  );

/** Evidence, questions, and execution controls for a decision call. */
export interface DecisionCallOptions {
  readonly input: DecisionContent;
  readonly questions: readonly DecisionQuestion[];
  readonly abortSignal?: AbortSignal;
  /** Deadline including response body consumption. */
  readonly timeoutMs?: number;
  /** Partitions automatic shared-input prompt caching, when supported. */
  readonly promptCacheKey?: string;
}

/** Ordered decision answers and actual provider token usage. */
export interface DecisionResult {
  readonly model: string;
  /** In request order; a refusal is never converted into a negative answer. */
  readonly answers: readonly DecisionAnswer[];
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly cachedInputTokens?: number;
    readonly cacheCreationInputTokens?: number;
  };
}

/** Provider capability for typed decisions without text or tool generation. */
export interface DecisionRuntime {
  readonly provider: string;
  readonly modelId: string;
  decide(options: DecisionCallOptions): Promise<DecisionResult>;
}

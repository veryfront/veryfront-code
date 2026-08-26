/**
 * Shared scripted {@link ModelRuntime} fake for agent runtime tests.
 *
 * Tests script the model as a list of turns instead of hand-writing
 * `doGenerate`/`doStream` literals. Both hooks
 * derive from the same script: `doGenerate` returns content parts and
 * `doStream` emits {@link RuntimeStreamPart}s ending in a well-formed
 * `finish` part. Typing the stream parts makes the historical
 * `{ type: "text-delta", delta: ... }` mistake — silently dropped by the
 * stream decoder — impossible to compile.
 */
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import type { RuntimeStreamPart } from "#veryfront/agent/runtime/runtime-tool-types.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

export type ScriptedUsage = NonNullable<
  Extract<RuntimeStreamPart, { type: "finish" }>["totalUsage"]
>;

export interface ScriptedToolCall {
  id: string;
  name: string;
  /** Objects are JSON-stringified for `doGenerate` and passed raw to `doStream`. */
  input: Record<string, unknown> | string;
}

export type ScriptedTurn =
  | { text: string; finishReason?: string; providerMetadata?: Record<string, unknown> }
  | {
    toolCalls: readonly ScriptedToolCall[];
    finishReason?: string;
    providerMetadata?: Record<string, unknown>;
  }
  /** Stream-only escape hatch: the parts are emitted verbatim, nothing is appended. */
  | { parts: readonly RuntimeStreamPart[] }
  /** Generate-only escape hatch: the content parts are returned verbatim. */
  | {
    content: readonly unknown[];
    finishReason?: string;
    providerMetadata?: Record<string, unknown>;
  }
  /** Emit `parts` (if any), then stay open until the call's abort signal fires. */
  | { hangUntilAbort: true; parts?: readonly RuntimeStreamPart[] };

/** A turn, or a function deriving one from the captured call options. */
export type ScriptedTurnScript =
  | ScriptedTurn
  | ((options: ModelRuntimeCallOptions, call: number) => ScriptedTurn);

export type ScriptedProviderMetadataReconciler = (input: {
  providerMetadata: Record<string, unknown>;
  suppressedToolCalls: readonly { id: string; name: string }[];
}) => Record<string, unknown> | undefined;

export interface ScriptedModelOptions {
  provider?: string;
  modelId?: string;
  specificationVersion?: string;
  /** Usage reported on every finish part and generate result. */
  usage?: ScriptedUsage;
  /** Restrict which hook the run may use; the other rejects loudly. */
  only?: "generate" | "stream";
  /** Explicitly repeat the final scripted turn after the script is exhausted. */
  repeatLastTurn?: boolean;
  /** Reconcile provider metadata after the runtime suppresses tool calls. */
  reconcileProviderMetadata?: ScriptedProviderMetadataReconciler;
}

export interface ScriptedModel extends ModelRuntime<ModelRuntimeCallOptions> {
  /** Options of every model call, generate and stream alike, in call order. */
  readonly calls: readonly ModelRuntimeCallOptions[];
  readonly callCount: number;
  /** The concatenated system-message text seen by each call. */
  systemPrompts(): string[];
  /** Sorted runtime tool names exposed to one call (default: the first). */
  toolNames(call?: number): string[];
}

/** Close over `parts` in a stream, mirroring the copied `createRuntimeStream` family. */
export function runtimeStream(parts: readonly RuntimeStreamPart[]): ReadableStream<unknown> {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/** The concatenated system-message text in a model call's options. */
export function systemPromptOf(options: unknown): string {
  const prompt = (options as { prompt?: Array<{ role?: string; content?: unknown }> }).prompt;
  if (!Array.isArray(prompt)) return "";
  return prompt
    .filter((entry) => entry?.role === "system" && typeof entry.content === "string")
    .map((entry) => entry.content as string)
    .join("\n\n");
}

/** Sorted runtime tool names in a model call's options. */
export function toolNamesOf(options: unknown): string[] {
  const tools = (options as { tools?: unknown }).tools;
  if (Array.isArray(tools)) {
    return tools.map((entry) => {
      const toolEntry = entry as { name?: unknown; id?: unknown };
      return typeof toolEntry.name === "string"
        ? toolEntry.name
        : typeof toolEntry.id === "string"
        ? toolEntry.id
        : "";
    }).toSorted(compareStrings);
  }
  return Object.keys((tools as Record<string, unknown> | undefined) ?? {}).toSorted(compareStrings);
}

const DEFAULT_USAGE: ScriptedUsage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function pendingStream(
  abortSignal: AbortSignal | undefined,
  parts: readonly RuntimeStreamPart[],
): ReadableStream<unknown> {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      if (!abortSignal) return;
      if (abortSignal.aborted) {
        controller.error(abortSignal.reason);
        return;
      }
      abortSignal.addEventListener("abort", () => {
        controller.error(abortSignal.reason);
      }, { once: true });
    },
  });
}

export function scriptedModel(
  turns: readonly ScriptedTurnScript[],
  options: ScriptedModelOptions = {},
): ScriptedModel {
  if (turns.length === 0) {
    throw new Error("scriptedModel needs at least one turn");
  }
  const usage = options.usage ?? DEFAULT_USAGE;
  const calls: ModelRuntimeCallOptions[] = [];

  const nextTurn = (callOptions: ModelRuntimeCallOptions): ScriptedTurn => {
    const call = calls.length;
    calls.push(callOptions);
    const scripted = turns[call] ?? (options.repeatLastTurn ? turns.at(-1) : undefined);
    if (scripted === undefined) {
      throw new Error(
        `scripted model: exhausted ${turns.length} turn(s); unexpected call ${call + 1}`,
      );
    }
    return typeof scripted === "function" ? scripted(callOptions, call) : scripted;
  };

  return {
    ...(options.reconcileProviderMetadata === undefined
      ? {}
      : { _reconcileProviderMetadata: options.reconcileProviderMetadata }),
    provider: options.provider ?? "hosted",
    modelId: options.modelId ?? "hosted/scripted-model",
    ...(options.specificationVersion === undefined
      ? {}
      : { specificationVersion: options.specificationVersion }),
    get calls(): readonly ModelRuntimeCallOptions[] {
      return calls;
    },
    get callCount(): number {
      return calls.length;
    },
    systemPrompts(): string[] {
      return calls.map(systemPromptOf);
    },
    toolNames(call = 0): string[] {
      return toolNamesOf(calls[call] ?? {});
    },
    doGenerate(callOptions: ModelRuntimeCallOptions) {
      if (options.only === "stream") {
        return Promise.reject(new Error("scripted model: doGenerate must not be called"));
      }
      let turn: ScriptedTurn;
      try {
        turn = nextTurn(callOptions);
      } catch (error) {
        return Promise.reject(error);
      }
      if ("hangUntilAbort" in turn) {
        return new Promise<never>((_, reject) => {
          const signal = callOptions.abortSignal;
          if (!signal) return;
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      if ("parts" in turn) {
        return Promise.reject(
          new Error("scripted model: a parts turn is stream-only; script text or toolCalls"),
        );
      }
      const metadata = turn.providerMetadata === undefined
        ? {}
        : { providerMetadata: turn.providerMetadata };
      if ("content" in turn) {
        return Promise.resolve({
          content: [...turn.content],
          finishReason: turn.finishReason ?? "stop",
          usage,
          ...metadata,
        });
      }
      if ("text" in turn) {
        return Promise.resolve({
          content: [{ type: "text", text: turn.text }],
          finishReason: turn.finishReason ?? "stop",
          usage,
          ...metadata,
        });
      }
      return Promise.resolve({
        content: turn.toolCalls.map((call) => ({
          type: "tool-call",
          toolCallId: call.id,
          toolName: call.name,
          input: typeof call.input === "string" ? call.input : JSON.stringify(call.input),
        })),
        finishReason: turn.finishReason ?? "tool-calls",
        usage,
        ...metadata,
      });
    },
    doStream(callOptions: ModelRuntimeCallOptions) {
      if (options.only === "generate") {
        return Promise.reject(new Error("scripted model: doStream must not be called"));
      }
      let turn: ScriptedTurn;
      try {
        turn = nextTurn(callOptions);
      } catch (error) {
        return Promise.reject(error);
      }
      if ("hangUntilAbort" in turn) {
        return Promise.resolve({
          stream: pendingStream(callOptions.abortSignal, turn.parts ?? []),
        });
      }
      if ("parts" in turn) {
        return Promise.resolve({ stream: runtimeStream(turn.parts) });
      }
      if ("content" in turn) {
        return Promise.reject(
          new Error(
            "scripted model: a content turn is generate-only; script text, toolCalls, or parts",
          ),
        );
      }
      const parts: RuntimeStreamPart[] = [];
      let finishReason: string;
      if ("text" in turn) {
        parts.push({ type: "text-delta", text: turn.text });
        finishReason = turn.finishReason ?? "stop";
      } else {
        for (const call of turn.toolCalls) {
          parts.push({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: call.input,
          });
        }
        finishReason = turn.finishReason ?? "tool-calls";
      }
      parts.push({
        type: "finish",
        finishReason,
        totalUsage: usage,
        ...(turn.providerMetadata === undefined ? {} : { providerMetadata: turn.providerMetadata }),
      });
      return Promise.resolve({ stream: runtimeStream(parts) });
    },
  };
}

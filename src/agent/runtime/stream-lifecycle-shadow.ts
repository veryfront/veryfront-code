import { stripLeadingEmptyObjectPlaceholder } from "#veryfront/agent/streaming/data-stream.ts";
import {
  createInitialReducerState,
  decodeRuntimeStreamPart,
  reduceStreamSignal,
  type StreamToolSnapshot,
  type StreamUsage,
} from "#veryfront/agent/streaming/lifecycle/index.ts";
import { recordStreamLifecycleShadowReport } from "#veryfront/agent/streaming/lifecycle/observability.ts";
import type {
  ChatStreamState,
  StreamingReasoningPart,
  StreamingToolCall,
  StreamingToolResult,
} from "./chat-stream-handler.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

export type StreamLifecycleShadowDivergence =
  | "text"
  | "reasoning"
  | "tool_input"
  | "tool_result"
  | "finish_reason"
  | "usage"
  | "outcome"
  | "shadow_error";

export interface StreamLifecycleShadowReport {
  count: number;
  categories: readonly StreamLifecycleShadowDivergence[];
}

export interface StreamLifecycleShadow {
  observePart(part: unknown): void;
  compareLegacySnapshot(state: ChatStreamState): StreamLifecycleShadowReport;
}

export function createStreamLifecycleShadow(options: {
  availableToolNames: readonly string[] | null;
  providerExecutedToolNames: readonly string[];
}): StreamLifecycleShadow {
  let reducer = createInitialReducerState();
  let failed = false;
  const decodeOptions = {
    availableToolNames: options.availableToolNames === null
      ? null
      : new Set(options.availableToolNames),
    providerExecutedToolNames: new Set(options.providerExecutedToolNames),
  };
  return {
    observePart(part: unknown) {
      if (failed) return;
      try {
        for (
          const signal of decodeRuntimeStreamPart(
            part,
            reducer.snapshot,
            decodeOptions,
          )
        ) {
          reducer = reduceStreamSignal(reducer, signal, 0).state;
        }
      } catch {
        failed = true;
      }
    },
    compareLegacySnapshot(state: ChatStreamState): StreamLifecycleShadowReport {
      const categories = new Set<StreamLifecycleShadowDivergence>();
      if (failed) categories.add("shadow_error");
      if (state.accumulatedText !== reducer.snapshot.accumulatedText) {
        categories.add("text");
      }
      if (!equalReasoning(state.reasoningParts, reducer.snapshot.reasoning)) {
        categories.add("reasoning");
      }
      if (!equalToolInputs(state.toolCalls, reducer.snapshot.tools)) {
        categories.add("tool_input");
      }
      if (!equalToolResults(state.toolResults, reducer.snapshot.tools)) {
        categories.add("tool_result");
      }
      if ((state.finishReason ?? null) !== reducer.snapshot.finishReason) {
        categories.add("finish_reason");
      }
      if (!equalUsage(state.usage, reducer.snapshot.usage)) {
        categories.add("usage");
      }
      const report: StreamLifecycleShadowReport = {
        count: categories.size,
        categories: [...categories].sort(compareStrings),
      };
      try {
        recordStreamLifecycleShadowReport({ report, mode: "shadow" });
      } catch {
        // Observability is fail-open.
      }
      return report;
    },
  };
}

function equalReasoning(
  legacy: readonly StreamingReasoningPart[],
  lifecycle: readonly { id: string; text: string }[],
): boolean {
  return legacy.map((part) => part.text).join("\0") ===
    lifecycle.map((part) => part.text).join("\0");
}

function normalizeArgumentText(raw: string): string {
  const stripped = stripLeadingEmptyObjectPlaceholder(raw);
  if (stripped.length === 0) return "";
  try {
    return JSON.stringify(JSON.parse(stripped));
  } catch {
    return stripped;
  }
}

function equalToolInputs(
  legacy: ReadonlyMap<string, StreamingToolCall>,
  tools: readonly StreamToolSnapshot[],
): boolean {
  const lifecycleTools = tools.filter((tool) => tool.rejectionReason !== "unavailable");
  if (legacy.size !== lifecycleTools.length) return false;
  for (const tool of lifecycleTools) {
    const match = legacy.get(tool.id);
    if (!match || match.name !== tool.name) return false;
    if (
      normalizeArgumentText(match.arguments ?? "") !==
        normalizeArgumentText(tool.inputText)
    ) {
      return false;
    }
  }
  return true;
}

const PROVIDER_TERMINAL_TOOL_PHASES = new Set([
  "succeeded",
  "failed",
  "denied",
  "cancelled",
]);

function equalToolResults(
  legacy: readonly StreamingToolResult[],
  tools: readonly StreamToolSnapshot[],
): boolean {
  const terminal = tools.filter((tool) =>
    tool.providerExecuted === true &&
    PROVIDER_TERMINAL_TOOL_PHASES.has(tool.phase)
  );
  if (legacy.length !== terminal.length) return false;
  const legacyById = new Map(legacy.map((result) => [result.toolCallId, result]));
  return terminal.every((tool) => {
    const result = legacyById.get(tool.id);
    return result !== undefined && equalToolResult(result, tool);
  });
}

function equalToolResult(
  legacy: StreamingToolResult,
  tool: StreamToolSnapshot,
): boolean {
  if (legacy.toolName !== tool.name) return false;
  if (legacy.providerExecuted !== true) return false;
  if (legacy.dynamic !== tool.dynamic) return false;
  if (legacy.preliminary !== tool.preliminary) return false;
  if (tool.phase === "failed") {
    return legacy.output === undefined &&
      deepEqualUnknown(legacy.error, tool.error);
  }
  if (tool.phase === "succeeded") {
    return legacy.error === undefined &&
      deepEqualUnknown(legacy.output, tool.output);
  }
  return legacy.output === undefined && legacy.error === undefined &&
    tool.output === undefined && tool.error === undefined;
}

function deepEqualUnknown(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => deepEqualUnknown(value, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).sort(compareStrings);
  const bKeys = Object.keys(bRecord).sort(compareStrings);
  if (!deepEqualUnknown(aKeys, bKeys)) return false;
  return aKeys.every((key) => deepEqualUnknown(aRecord[key], bRecord[key]));
}

function equalUsage(
  legacy: ChatStreamState["usage"],
  usage: StreamUsage,
): boolean {
  return legacy.promptTokens === usage.inputTokens &&
    legacy.completionTokens === usage.outputTokens &&
    legacy.totalTokens === usage.totalTokens &&
    legacy.cachedInputTokens === usage.cachedInputTokens &&
    legacy.cacheCreationInputTokens === usage.cacheCreationInputTokens &&
    legacy.cacheReadInputTokens === usage.cacheReadInputTokens &&
    legacy.reasoningTokens === usage.reasoningTokens &&
    legacy.billableInputTokens === usage.billableInputTokens &&
    legacy.billableOutputTokens === usage.billableOutputTokens &&
    legacy.costUsd === usage.costUsd &&
    legacy.providerInputCostUsd === usage.providerInputCostUsd &&
    legacy.providerOutputCostUsd === usage.providerOutputCostUsd &&
    legacy.providerCostUsd === usage.providerCostUsd &&
    legacy.veryfrontInputChargeUsd === usage.veryfrontInputChargeUsd &&
    legacy.veryfrontOutputChargeUsd === usage.veryfrontOutputChargeUsd &&
    legacy.veryfrontChargeUsd === usage.veryfrontChargeUsd &&
    legacy.veryfrontBilledUsd === usage.veryfrontBilledUsd &&
    legacy.costCredits === usage.costCredits &&
    legacy.costSource === usage.costSource &&
    legacy.billingMode === usage.billingMode &&
    legacy.usageCaptureStatus === usage.usageCaptureStatus;
}

import {
  everyPrivateArray,
  filterPrivateArray,
  joinPrivateArray,
  mapPrivateArray,
} from "#veryfront/security/private-array.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
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

const hasOwn = Object.hasOwn;
const mapGet = Map.prototype.get;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const isArray = Array.isArray;
const objectIs = Object.is;
const objectKeys = Object.keys;
const arraySort = Array.prototype.sort;
const apply = Reflect.apply;
const sortStrings = (values: string[]): string[] => apply(arraySort, values, [compareStrings]);

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
      : createPrivateSet(options.availableToolNames),
    providerExecutedToolNames: createPrivateSet(options.providerExecutedToolNames),
  };
  return {
    observePart(part: unknown) {
      if (failed) return;
      try {
        const signals = decodeRuntimeStreamPart(part, reducer.snapshot, decodeOptions);
        for (let index = 0; index < signals.length; index++) {
          if (hasOwn(signals, index)) {
            reducer = reduceStreamSignal(reducer, signals[index]!, 0).state;
          }
        }
      } catch {
        failed = true;
      }
    },
    compareLegacySnapshot(state: ChatStreamState): StreamLifecycleShadowReport {
      const categories = createPrivateSet<StreamLifecycleShadowDivergence>();
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
        categories: apply(arraySort, [...categories], [compareStrings]),
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
  return joinPrivateArray(mapPrivateArray(legacy, (part) => part.text), "\0") ===
    joinPrivateArray(mapPrivateArray(lifecycle, (part) => part.text), "\0");
}

function normalizeArgumentText(raw: string): string {
  const stripped = stripLeadingEmptyObjectPlaceholder(raw);
  if (stripped.length === 0) return "";
  try {
    return privateJsonStringify(privateJsonParse(stripped));
  } catch {
    return stripped;
  }
}

function equalToolInputs(
  legacy: ReadonlyMap<string, StreamingToolCall>,
  tools: readonly StreamToolSnapshot[],
): boolean {
  const lifecycleTools = filterPrivateArray(
    tools,
    (tool) => tool.rejectionReason !== "unavailable",
  );
  if (apply(mapSize, legacy, []) !== lifecycleTools.length) return false;
  for (let index = 0; index < lifecycleTools.length; index++) {
    const tool = lifecycleTools[index]!;
    const match = apply(mapGet, legacy, [tool.id]) as StreamingToolCall | undefined;
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

const PROVIDER_TERMINAL_TOOL_PHASES = createPrivateSet([
  "succeeded",
  "failed",
  "denied",
  "cancelled",
]);

function equalToolResults(
  legacy: readonly StreamingToolResult[],
  tools: readonly StreamToolSnapshot[],
): boolean {
  const terminal = filterPrivateArray(tools, (tool) =>
    tool.providerExecuted === true &&
    PROVIDER_TERMINAL_TOOL_PHASES.has(tool.phase));
  if (legacy.length !== terminal.length) return false;
  const legacyById = createPrivateMap<string, StreamingToolResult>();
  for (let index = 0; index < legacy.length; index++) {
    if (hasOwn(legacy, index)) legacyById.set(legacy[index]!.toolCallId, legacy[index]!);
  }
  return everyPrivateArray(terminal, (tool) => {
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
  if (objectIs(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (isArray(a) || isArray(b)) {
    if (!isArray(a) || !isArray(b) || a.length !== b.length) {
      return false;
    }
    return everyPrivateArray(a, (value, index) => deepEqualUnknown(value, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = sortStrings(objectKeys(aRecord));
  const bKeys = sortStrings(objectKeys(bRecord));
  if (!deepEqualUnknown(aKeys, bKeys)) return false;
  return everyPrivateArray(aKeys, (key) => deepEqualUnknown(aRecord[key], bRecord[key]));
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

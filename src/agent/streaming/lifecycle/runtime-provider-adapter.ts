import { isDynamicTool } from "#veryfront/agent/runtime/tool-helpers.ts";
import type { RuntimeStreamPart } from "#veryfront/agent/runtime/runtime-tool-types.ts";
import { getStreamErrorMessage, resolveKnownProviderTerminalError } from "../stream-outcome.ts";
import { mergeToolCallInput } from "../tool-input.ts";
import { parseCanonicalToolInput } from "./tool-input.ts";
import type {
  StreamProviderAdapter,
  StreamProviderError,
  StreamSignal,
  StreamSnapshot,
  StreamToolSnapshot,
  StreamUsage,
} from "./types.ts";

export interface RuntimeStreamProviderOptions {
  availableToolNames: ReadonlySet<string> | null;
  providerExecutedToolNames: ReadonlySet<string>;
}

export function decodeRuntimeStreamPart(
  part: unknown,
  snapshot: Readonly<StreamSnapshot>,
  options: RuntimeStreamProviderOptions,
): readonly StreamSignal[] {
  if (
    !part || typeof part !== "object" ||
    typeof (part as { type?: unknown }).type !== "string"
  ) {
    return [{
      kind: "diagnostic_candidate",
      candidate: { kind: "unknown_runtime_part", value: { partType: typeof part } },
    }];
  }
  const rawType = (part as { type: string }).type;
  const typed = part as RuntimeStreamPart;
  if (typed.type.startsWith("data-")) {
    if (typed.type === "data-tool-call-status") return [];
    const data = "data" in typed ? typed.data : undefined;
    return [{
      kind: "protocol",
      event: { type: "custom", name: typed.type.slice(5), data },
    }];
  }

  switch (typed.type) {
    case "text-delta":
      return [{
        kind: "protocol",
        event: { type: "text_content", delta: typed.text },
      }];
    case "reasoning-start":
      return [{
        kind: "protocol",
        event: { type: "reasoning_start", id: typed.id || "reasoning" },
      }];
    case "reasoning-delta":
      return [{
        kind: "protocol",
        event: {
          type: "reasoning_content",
          id: typed.id || "reasoning",
          delta: typed.delta,
        },
      }];
    case "reasoning-end":
      return [{
        kind: "protocol",
        event: {
          type: "reasoning_end",
          id: typed.id || "reasoning",
          ...(typed.signature ? { signature: typed.signature } : {}),
          ...(typed.redactedData ? { redactedData: typed.redactedData } : {}),
        },
      }];
    case "tool-input-start":
      return [toolStartSignal(typed, options)];
    case "tool-input-delta": {
      const tool = findTool(snapshot, typed.id);
      if (tool?.phase === "input_rejected") return [];
      return [{
        kind: "protocol",
        event: {
          type: "tool_input_content",
          toolCallId: typed.id,
          delta: typed.delta,
        },
      }];
    }
    case "tool-input-end":
      return toolEndSignals(typed.id, snapshot);
    case "tool-input-available":
      return toolReadySignals(
        typed.toolCallId ?? typed.id ?? "",
        typed,
        snapshot,
        options,
      );
    case "tool-call":
      return toolReadySignals(typed.toolCallId, typed, snapshot, options);
    case "tool-result":
      return providerToolTerminalSignals(typed, snapshot, options);
    case "tool-error":
      return providerToolTerminalSignals(typed, snapshot, options);
    case "finish":
      return [
        ...(typed.totalUsage
          ? [{
            kind: "usage" as const,
            usage: normalizeRuntimeUsage(typed.totalUsage),
          }]
          : []),
        {
          kind: "protocol" as const,
          event: {
            type: "step_finish" as const,
            finishReason: normalizeFinishReason(typed.finishReason),
          },
        },
      ];
    case "error":
      return [{
        kind: "provider_error",
        error: classifyRuntimeProviderError(typed.error),
      }];
    default:
      return [{
        kind: "diagnostic_candidate",
        candidate: { kind: "unknown_runtime_part", value: { partType: rawType } },
      }];
  }
}

export function createRuntimeStreamProviderAdapter(input: {
  open(signal: AbortSignal): AsyncIterable<unknown>;
  options: RuntimeStreamProviderOptions;
}): StreamProviderAdapter<unknown> {
  return {
    open: input.open,
    decode: (part, snapshot) => decodeRuntimeStreamPart(part, snapshot, input.options),
    classifyError: (error) => classifyRuntimeProviderError(error),
  };
}

export function classifyRuntimeProviderError(
  error: unknown,
): StreamProviderError {
  const known = resolveKnownProviderTerminalError(error);
  if (known) {
    return {
      code: known.code,
      publicMessage: known.message,
      retryable: false,
      terminal: true,
    };
  }
  return {
    code: "PROVIDER_STREAM_ERROR",
    publicMessage: getStreamErrorMessage(error),
    retryable: true,
    terminal: false,
  };
}

function findTool(
  snapshot: Readonly<StreamSnapshot>,
  toolCallId: string,
): StreamToolSnapshot | undefined {
  return snapshot.tools.find((tool) => tool.id === toolCallId);
}

function isToolAvailable(
  toolName: string,
  options: RuntimeStreamProviderOptions,
): boolean {
  return options.availableToolNames === null ||
    options.availableToolNames.has(toolName);
}

function resolveProviderExecuted(
  explicit: boolean | undefined,
  toolName: string,
  options: RuntimeStreamProviderOptions,
): boolean | undefined {
  if (explicit !== undefined) return explicit;
  return options.providerExecutedToolNames.has(toolName) ? true : undefined;
}

function resolveDynamic(
  explicit: boolean | undefined,
  toolName: string,
): boolean | undefined {
  if (explicit !== undefined) return explicit;
  return isDynamicTool(toolName) ? true : undefined;
}

function toolStartSignal(
  typed: Extract<RuntimeStreamPart, { type: "tool-input-start" }>,
  options: RuntimeStreamProviderOptions,
): StreamSignal {
  if (!isToolAvailable(typed.toolName, options)) {
    return {
      kind: "protocol",
      event: {
        type: "tool_input_rejected",
        toolCallId: typed.id,
        toolName: typed.toolName,
        reason: "unavailable",
      },
    };
  }
  const providerExecuted = resolveProviderExecuted(
    typed.providerExecuted,
    typed.toolName,
    options,
  );
  const dynamic = resolveDynamic(typed.dynamic, typed.toolName);
  return {
    kind: "protocol",
    event: {
      type: "tool_input_start",
      toolCallId: typed.id,
      toolName: typed.toolName,
      ...(providerExecuted !== undefined ? { providerExecuted } : {}),
      ...(dynamic ? { dynamic: true } : {}),
    },
  };
}

function toolEndSignals(
  toolCallId: string,
  snapshot: Readonly<StreamSnapshot>,
): readonly StreamSignal[] {
  const tool = findTool(snapshot, toolCallId);
  if (!tool) {
    return [{
      kind: "diagnostic_candidate",
      candidate: {
        kind: "unknown_runtime_part",
        value: { partType: "tool-input-end" },
      },
    }];
  }
  if (tool.phase !== "input_open" && tool.phase !== "input_streaming") {
    return [];
  }
  const parsed = parseCanonicalToolInput(tool.inputText);
  if (parsed.ok) {
    return [{
      kind: "protocol",
      event: {
        type: "tool_input_ready",
        toolCallId,
        toolName: tool.name,
        input: parsed.value,
        ...(tool.providerExecuted !== undefined ? { providerExecuted: tool.providerExecuted } : {}),
        ...(tool.dynamic ? { dynamic: true } : {}),
      },
    }];
  }
  return [{
    kind: "protocol",
    event: {
      type: "tool_input_rejected",
      toolCallId,
      toolName: tool.name,
      reason: parsed.reason,
    },
  }];
}

function toolReadySignals(
  toolCallId: string,
  typed: Extract<
    RuntimeStreamPart,
    { type: "tool-input-available" } | { type: "tool-call" }
  >,
  snapshot: Readonly<StreamSnapshot>,
  options: RuntimeStreamProviderOptions,
): readonly StreamSignal[] {
  if (toolCallId.length === 0) {
    return [{
      kind: "diagnostic_candidate",
      candidate: {
        kind: "unknown_runtime_part",
        value: { partType: typed.type },
      },
    }];
  }
  if (!isToolAvailable(typed.toolName, options)) {
    const prior = findTool(snapshot, toolCallId);
    if (prior?.phase === "input_rejected") return [];
    return [{
      kind: "protocol",
      event: {
        type: "tool_input_rejected",
        toolCallId,
        toolName: typed.toolName,
        reason: "unavailable",
      },
    }];
  }
  const prior = findTool(snapshot, toolCallId);
  if (prior?.phase === "input_rejected") return [];
  const streamed = prior?.inputText ?? "";
  const finalText = typeof typed.input === "string"
    ? typed.input
    : JSON.stringify(typed.input ?? {});
  const merged = mergeToolCallInput(streamed, finalText);
  const parsed = parseCanonicalToolInput(
    typeof typed.input === "object" && typed.input !== null &&
      !Array.isArray(typed.input)
      ? typed.input
      : merged,
  );
  const providerExecuted = resolveProviderExecuted(
    typed.providerExecuted,
    typed.toolName,
    options,
  );
  const dynamic = resolveDynamic(typed.dynamic, typed.toolName);
  if (!parsed.ok) {
    return [{
      kind: "protocol",
      event: {
        type: "tool_input_rejected",
        toolCallId,
        toolName: typed.toolName,
        reason: parsed.reason,
      },
    }];
  }
  return [{
    kind: "protocol",
    event: {
      type: "tool_input_ready",
      toolCallId,
      toolName: typed.toolName,
      input: parsed.value,
      ...(providerExecuted !== undefined ? { providerExecuted } : {}),
      ...(dynamic ? { dynamic: true } : {}),
    },
  }];
}

function providerToolTerminalSignals(
  typed: Extract<
    RuntimeStreamPart,
    { type: "tool-result" } | { type: "tool-error" }
  >,
  snapshot: Readonly<StreamSnapshot>,
  options: RuntimeStreamProviderOptions,
): readonly StreamSignal[] {
  const tool = findTool(snapshot, typed.toolCallId);
  if (tool?.phase === "input_rejected") return [];
  const dynamic = resolveDynamic(typed.dynamic, typed.toolName);
  const isError = typed.type === "tool-error" ||
    (typed.isError ?? typed.error !== undefined);
  const output = typed.type === "tool-error"
    ? typed.error
    : isError
    ? typed.error ?? ("output" in typed && typed.output !== undefined ? typed.output : typed.result)
    : "output" in typed && typed.output !== undefined
    ? typed.output
    : typed.result;
  const terminal: StreamSignal = {
    kind: "protocol",
    event: {
      type: "provider_tool_result",
      toolCallId: typed.toolCallId,
      toolName: typed.toolName,
      output,
      isError,
      providerExecuted: true,
      ...(dynamic ? { dynamic: true } : {}),
      ...(typed.preliminary !== undefined ? { preliminary: typed.preliminary } : {}),
    },
  };
  const start: StreamSignal = {
    kind: "protocol",
    event: {
      type: "provider_tool_start",
      toolCallId: typed.toolCallId,
      toolName: typed.toolName,
      providerExecuted: true,
    },
  };
  if (tool && tool.phase === "running") return [terminal];
  if (tool && tool.phase === "input_ready") return [start, terminal];
  const providerExecuted = resolveProviderExecuted(
    typed.providerExecuted,
    typed.toolName,
    options,
  );
  return [
    {
      kind: "protocol",
      event: {
        type: "tool_input_start",
        toolCallId: typed.toolCallId,
        toolName: typed.toolName,
        providerExecuted: true,
        ...(dynamic ? { dynamic: true } : {}),
      },
    },
    {
      kind: "protocol",
      event: {
        type: "tool_input_ready",
        toolCallId: typed.toolCallId,
        toolName: typed.toolName,
        input: "input" in typed && typed.input !== undefined ? typed.input : {},
        providerExecuted: true,
        ...(dynamic ? { dynamic: true } : {}),
      },
    },
    start,
    {
      kind: "diagnostic_candidate",
      candidate: {
        kind: "provider_tool_input_synthesized",
        value: {
          partType: typed.type,
          explicitProviderExecuted: providerExecuted === true,
        },
      },
    },
    terminal,
  ];
}

function normalizeFinishReason(
  finishReason: string | null | undefined,
):
  | "stop"
  | "length"
  | "tool-calls"
  | "content-filter"
  | "other"
  | null {
  switch (finishReason) {
    case "stop":
    case "length":
    case "tool-calls":
    case "content-filter":
    case "other":
      return finishReason;
    case null:
    case undefined:
    case "error":
    case "unknown":
      return null;
    default:
      return "other";
  }
}

function normalizeRuntimeUsage(
  usage: NonNullable<
    Extract<RuntimeStreamPart, { type: "finish" }>["totalUsage"]
  >,
): StreamUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
    ...(usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: usage.cachedInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
    ...(usage.billableInputTokens !== undefined
      ? { billableInputTokens: usage.billableInputTokens }
      : {}),
    ...(usage.billableOutputTokens !== undefined
      ? { billableOutputTokens: usage.billableOutputTokens }
      : {}),
    ...(usage.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    ...(usage.providerInputCostUsd !== undefined
      ? { providerInputCostUsd: usage.providerInputCostUsd }
      : {}),
    ...(usage.providerOutputCostUsd !== undefined
      ? { providerOutputCostUsd: usage.providerOutputCostUsd }
      : {}),
    ...(usage.providerCostUsd !== undefined ? { providerCostUsd: usage.providerCostUsd } : {}),
    ...(usage.veryfrontInputChargeUsd !== undefined
      ? { veryfrontInputChargeUsd: usage.veryfrontInputChargeUsd }
      : {}),
    ...(usage.veryfrontOutputChargeUsd !== undefined
      ? { veryfrontOutputChargeUsd: usage.veryfrontOutputChargeUsd }
      : {}),
    ...(usage.veryfrontChargeUsd !== undefined
      ? { veryfrontChargeUsd: usage.veryfrontChargeUsd }
      : {}),
    ...(usage.veryfrontBilledUsd !== undefined
      ? { veryfrontBilledUsd: usage.veryfrontBilledUsd }
      : {}),
    ...(usage.costCredits !== undefined ? { costCredits: usage.costCredits } : {}),
    ...(usage.costSource !== undefined ? { costSource: usage.costSource } : {}),
    ...(usage.billingMode !== undefined ? { billingMode: usage.billingMode } : {}),
    ...(usage.usageCaptureStatus !== undefined
      ? { usageCaptureStatus: usage.usageCaptureStatus }
      : {}),
  };
}

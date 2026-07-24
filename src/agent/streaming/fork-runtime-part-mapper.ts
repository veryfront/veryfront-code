import { isRecord } from "#veryfront/chat/conversation.ts";
import { safeJsonParse } from "#veryfront/chat/provider-errors.ts";
import type { AgUiRuntimeStreamEvent } from "../ag-ui/browser-encoder.ts";
import {
  mergeToolInputDelta,
  parseToolInputObject,
  stripLeadingEmptyObjectPlaceholder,
} from "./data-stream.ts";
import type { ForkPart, ForkRuntimeStep, ForkRuntimeStreamLogger } from "./fork-runtime-types.ts";

type ForkToolCallPart = Extract<ForkPart, { type: "tool-call" }>;
type ForkToolResultPart = Extract<ForkPart, { type: "tool-result" }>;
type ForkToolErrorPart = Extract<ForkPart, { type: "tool-error" }>;

export interface RecoveredToolObservation {
  sawInputStart: boolean;
  sawInputDelta: boolean;
  sawInputAvailable: boolean;
  sawOutputAvailable: boolean;
  sawOutputError: boolean;
}

/** State for fork recovered parts. */
export interface ForkRecoveredPartsState {
  toolCalls: Map<string, RecoveredToolObservation>;
  emittedToolCallIds: Set<string>;
  emittedToolResultIds: Set<string>;
  logger?: ForkRuntimeStreamLogger;
}

type ForkRuntimeToolCallState = RecoveredToolObservation & {
  toolName: string;
  inputText: string;
  input: Record<string, unknown>;
};

/** State for fork runtime stream mapping. */
export type ForkRuntimeStreamMappingState = {
  toolCalls: Map<string, ForkRuntimeToolCallState>;
  emittedToolCallIds: Set<string>;
  emittedToolResultIds: Set<string>;
  logger?: ForkRuntimeStreamLogger;
};

/** State for framework stream.
 * @deprecated Use ForkRuntimeStreamMappingState.
 */
export type FrameworkStreamState = ForkRuntimeStreamMappingState;

function warnForkRuntimeStream(
  logger: ForkRuntimeStreamLogger | undefined,
  message: string,
  metadata: Record<string, unknown>,
): void {
  logger?.warn(message, metadata);
}

/** Builds recovered step parts. */
export function buildRecoveredStepParts(
  step: ForkRuntimeStep,
  state: ForkRecoveredPartsState,
): Array<ForkToolCallPart | ForkToolResultPart> {
  const recoveredParts: Array<ForkToolCallPart | ForkToolResultPart> = [];

  for (const toolCall of step.toolCalls) {
    if (state.emittedToolCallIds.has(toolCall.toolCallId)) {
      continue;
    }

    const streamedCall = state.toolCalls.get(toolCall.toolCallId);
    warnForkRuntimeStream(state.logger, "Child fork recovered missing tool-call from final step", {
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      sawInputStart: streamedCall?.sawInputStart ?? false,
      sawInputDelta: streamedCall?.sawInputDelta ?? false,
      sawInputAvailable: streamedCall?.sawInputAvailable ?? false,
      sawOutputAvailable: streamedCall?.sawOutputAvailable ?? false,
      sawOutputError: streamedCall?.sawOutputError ?? false,
    });
    state.emittedToolCallIds.add(toolCall.toolCallId);
    recoveredParts.push({
      type: "tool-call",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input,
    });
  }

  for (const toolResult of step.toolResults) {
    if (state.emittedToolResultIds.has(toolResult.toolCallId)) {
      continue;
    }

    const streamedCall = state.toolCalls.get(toolResult.toolCallId);
    warnForkRuntimeStream(
      state.logger,
      "Child fork recovered missing tool-result from final step",
      {
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        sawInputStart: streamedCall?.sawInputStart ?? false,
        sawInputDelta: streamedCall?.sawInputDelta ?? false,
        sawInputAvailable: streamedCall?.sawInputAvailable ?? false,
        sawOutputAvailable: streamedCall?.sawOutputAvailable ?? false,
        sawOutputError: streamedCall?.sawOutputError ?? false,
      },
    );
    state.emittedToolResultIds.add(toolResult.toolCallId);
    recoveredParts.push({
      type: "tool-result",
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      input: toolResult.input,
      output: toolResult.output,
    });
  }

  return recoveredParts;
}

function isEmptyRecord(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

export function getParsedStreamedToolInput(inputText: string): Record<string, unknown> | null {
  const strippedInputText = stripLeadingEmptyObjectPlaceholder(inputText).trim();
  const normalizedInputText = strippedInputText.startsWith('"')
    ? `{${strippedInputText}`
    : strippedInputText;
  if (normalizedInputText.length === 0) {
    return {};
  }

  const parsed = safeJsonParse(normalizedInputText);
  if (!parsed.ok) {
    return null;
  }

  return isRecord(parsed.value) ? Object.fromEntries(Object.entries(parsed.value)) : {};
}

function buildToolCallPartIfNeeded(
  toolCallId: string,
  state: ForkRuntimeStreamMappingState,
): ForkToolCallPart[] {
  const toolCall = state.toolCalls.get(toolCallId);
  if (!toolCall || state.emittedToolCallIds.has(toolCallId)) {
    return [];
  }

  state.emittedToolCallIds.add(toolCallId);
  return [
    {
      type: "tool-call",
      toolCallId,
      toolName: toolCall.toolName,
      input: toolCall.input,
    },
  ];
}

/** State for create fork runtime stream mapping. */
export function createForkRuntimeStreamMappingState(
  input: { logger?: ForkRuntimeStreamLogger } = {},
): ForkRuntimeStreamMappingState {
  return {
    toolCalls: new Map(),
    emittedToolCallIds: new Set(),
    emittedToolResultIds: new Set(),
    ...(input.logger ? { logger: input.logger } : {}),
  };
}

/** Map AG-UI runtime event to fork parts. */
export function mapAgUiRuntimeEventToForkParts(
  event: AgUiRuntimeStreamEvent,
  state: ForkRuntimeStreamMappingState,
): ForkPart[] {
  switch (event.type) {
    case "reasoning-delta":
      return typeof event.delta === "string"
        ? [{ type: "reasoning-delta", text: event.delta }]
        : [];

    case "text-delta":
      return typeof event.delta === "string" ? [{ type: "text-delta", text: event.delta }] : [];

    case "tool-input-start": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      const toolName = typeof event.toolName === "string" ? event.toolName : null;
      if (!toolCallId || !toolName) {
        return [];
      }

      const existing = state.toolCalls.get(toolCallId);
      state.toolCalls.set(toolCallId, {
        toolName,
        inputText: existing?.inputText ?? "",
        input: existing?.input ?? {},
        sawInputStart: true,
        sawInputDelta: existing?.sawInputDelta ?? false,
        sawInputAvailable: existing?.sawInputAvailable ?? false,
        sawOutputAvailable: existing?.sawOutputAvailable ?? false,
        sawOutputError: existing?.sawOutputError ?? false,
      });
      return [{ type: "tool-input-start", toolCallId, toolName }];
    }

    case "tool-input-delta": {
      const inputToolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      const inputDelta = typeof event.inputTextDelta === "string" ? event.inputTextDelta : null;
      if (!inputToolCallId || !inputDelta) {
        return [];
      }

      const existing = state.toolCalls.get(inputToolCallId);
      if (existing) {
        existing.inputText = mergeToolInputDelta(existing.inputText, inputDelta);
        existing.sawInputDelta = true;
        const parsedInput = getParsedStreamedToolInput(existing.inputText);
        if (parsedInput) {
          existing.input = parsedInput;
        }
      } else {
        warnForkRuntimeStream(
          state.logger,
          "Child fork received tool-input-delta before tool-input-start",
          {
            toolCallId: inputToolCallId,
            deltaLength: inputDelta.length,
          },
        );
      }

      return [{ type: "tool-input-delta", toolCallId: inputToolCallId, delta: inputDelta }];
    }

    case "tool-input-available": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      const toolName = typeof event.toolName === "string" ? event.toolName : null;
      if (!toolCallId || !toolName) {
        return [];
      }
      const input = parseToolInputObject(event.input);
      const existing = state.toolCalls.get(toolCallId);
      const resolvedInput = existing && isEmptyRecord(input) && !isEmptyRecord(existing.input)
        ? existing.input
        : input;
      state.toolCalls.set(toolCallId, {
        toolName,
        inputText: "",
        input: resolvedInput,
        sawInputStart: existing?.sawInputStart ?? false,
        sawInputDelta: existing?.sawInputDelta ?? false,
        sawInputAvailable: true,
        sawOutputAvailable: existing?.sawOutputAvailable ?? false,
        sawOutputError: existing?.sawOutputError ?? false,
      });
      return buildToolCallPartIfNeeded(toolCallId, state);
    }

    case "tool-output-available": {
      if (event.preliminary === true) {
        return [];
      }
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      if (!toolCallId) {
        return [];
      }
      const call = state.toolCalls.get(toolCallId);
      if (!call) {
        return [];
      }
      call.sawOutputAvailable = true;
      const parts: Array<ForkToolCallPart | ForkToolResultPart> = [
        ...buildToolCallPartIfNeeded(toolCallId, state),
      ];
      state.emittedToolResultIds.add(toolCallId);
      parts.push({
        type: "tool-result",
        toolCallId,
        toolName: call.toolName,
        input: call.input,
        output: Object.hasOwn(event, "output") ? event.output : null,
      });
      return parts;
    }

    case "tool-output-error":
    case "tool-input-error": {
      const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : null;
      if (!toolCallId) {
        return [];
      }
      const call = state.toolCalls.get(toolCallId);
      const errorText = typeof event.errorText === "string"
        ? event.errorText
        : typeof event.error === "string"
        ? event.error
        : "Tool execution failed";
      if (call) {
        call.sawOutputError = true;
      }
      const parts: Array<ForkToolCallPart | ForkToolErrorPart> = [
        ...buildToolCallPartIfNeeded(toolCallId, state),
      ];
      parts.push({
        type: "tool-error",
        toolCallId,
        toolName: call?.toolName ?? "unknown",
        input: call?.input ?? {},
        error: new Error(errorText),
      });
      return parts;
    }

    case "error": {
      const errorText = typeof event.errorText === "string"
        ? event.errorText
        : "Framework stream failed";
      return [{ type: "error", error: new Error(errorText) }];
    }

    default:
      return [];
  }
}

/** State for create framework stream.
 * @deprecated Use createForkRuntimeStreamMappingState.
 */
export function createFrameworkStreamState(
  input: { logger?: ForkRuntimeStreamLogger } = {},
): ForkRuntimeStreamMappingState {
  return createForkRuntimeStreamMappingState(input);
}

/** Handles map framework event to fork parts.
 * @deprecated Use mapAgUiRuntimeEventToForkParts.
 */
export function mapFrameworkEventToForkParts(
  event: AgUiRuntimeStreamEvent,
  state: ForkRuntimeStreamMappingState,
): ForkPart[] {
  return mapAgUiRuntimeEventToForkParts(event, state);
}

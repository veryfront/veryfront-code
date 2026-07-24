import {
  createInitialReducerState,
  finalizeStreamProjection,
  parseCanonicalToolInput,
  reduceStreamSignal,
  type StreamLifecycleFrame,
  type StreamProtocolEvent,
  type StreamReducerState,
} from "#veryfront/agent/streaming/lifecycle/index.ts";
import type { StreamProtocolVersion } from "./durable-contracts.ts";

/** Result of projecting stored conversation run events into lifecycle frames. */
export type ConversationRunLifecycleReadResult =
  | {
    status: "ok";
    frames: readonly StreamLifecycleFrame[];
    repairs: readonly "legacy_text_content_after_end"[];
  }
  | {
    status: "invalid";
    frames: readonly StreamLifecycleFrame[];
    code: "VERSION_2_LIFECYCLE_VIOLATION" | "UNSUPPORTED_DURABLE_EVENT";
  };

/**
 * Read stored conversation run events as validated lifecycle frames.
 *
 * Version 1 reads pass known durable events through the repair-tolerant
 * lifecycle reducer. Version 2 reads are strict: any lifecycle violation is an
 * error, never a repair candidate. Source events are never mutated, sorted, or
 * decorated.
 */
export function readConversationRunLifecycleFrames(input: {
  streamProtocolVersion: StreamProtocolVersion;
  events: readonly Readonly<Record<string, unknown>>[];
}): ConversationRunLifecycleReadResult {
  if (input.streamProtocolVersion === 2) {
    return readVersion2(input.events);
  }
  return readVersion1(input.events);
}

function readVersion1(
  events: readonly Readonly<Record<string, unknown>>[],
): ConversationRunLifecycleReadResult {
  let reducer = createInitialReducerState();
  const frames: StreamLifecycleFrame[] = [];
  const repairs = new Set<"legacy_text_content_after_end">();
  const closedTextIds = new Set<string>();

  const reduce = (event: StreamProtocolEvent): void => {
    const reduced = reduceStreamSignal(
      reducer,
      { kind: "protocol", event },
      0,
    );
    reducer = reduced.state;
    frames.push(...reduced.frames);
  };

  const rejectUnknown = (): void => {
    reducer = { ...reducer, sequence: reducer.sequence + 1 };
    frames.push({
      class: "diagnostic",
      event: { type: "provider_part_rejected" },
      sequence: reducer.sequence,
      elapsedMs: 0,
    });
  };

  for (const event of events) {
    const type = typeof event.type === "string" ? event.type : null;
    const contentId = typeof event.contentId === "string" ? event.contentId : undefined;
    const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
    const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
    switch (type) {
      case "TEXT_MESSAGE_START":
        reduce({ type: "text_start", ...(contentId ? { id: contentId } : {}) });
        break;
      case "TEXT_MESSAGE_CONTENT": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (contentId && closedTextIds.has(contentId)) {
          // Content after a closed identifier: feed content without reopening
          // the external identifier so the reducer creates a fresh internal
          // content identity, and record the repair once.
          repairs.add("legacy_text_content_after_end");
          reduce({ type: "text_content", delta });
          closedTextIds.delete(contentId);
          break;
        }
        reduce({
          type: "text_content",
          ...(contentId ? { id: contentId } : {}),
          delta,
        });
        break;
      }
      case "TEXT_MESSAGE_END":
        reduce({ type: "text_end", ...(contentId ? { id: contentId } : {}) });
        if (contentId) closedTextIds.add(contentId);
        break;
      case "REASONING_MESSAGE_START":
        reduce({ type: "reasoning_start", id: contentId ?? "reasoning" });
        break;
      case "REASONING_MESSAGE_CONTENT":
        reduce({
          type: "reasoning_content",
          id: contentId ?? "reasoning",
          delta: typeof event.delta === "string" ? event.delta : "",
        });
        break;
      case "REASONING_MESSAGE_END":
        reduce({ type: "reasoning_end", id: contentId ?? "reasoning" });
        break;
      case "TOOL_CALL_START":
        reduce({ type: "tool_input_start", toolCallId, toolName });
        break;
      case "TOOL_CALL_ARGS":
        reduce({
          type: "tool_input_content",
          toolCallId,
          delta: typeof event.delta === "string" ? event.delta : "",
        });
        break;
      case "TOOL_CALL_END": {
        const stored = toolInputTextFor(reducer, toolCallId);
        const parsed = parseCanonicalToolInput(stored);
        if (parsed.ok) {
          reduce({
            type: "tool_input_ready",
            toolCallId,
            toolName: toolNameFor(reducer, toolCallId) ?? toolName,
            input: parsed.value,
          });
        } else {
          reduce({
            type: "tool_input_rejected",
            toolCallId,
            toolName: toolNameFor(reducer, toolCallId) ?? toolName,
            reason: parsed.reason,
          });
        }
        break;
      }
      case "TOOL_CALL_RESULT": {
        const tool = reducer.tools.get(toolCallId);
        if (tool?.providerExecuted === true) {
          reduce({
            type: "provider_tool_result",
            toolCallId,
            toolName,
            output: event.content,
            isError: event.isError === true,
            providerExecuted: true,
          });
          break;
        }
        // Version 1 events never mark provider execution, so the result is
        // retained as a semantic custom compatibility event.
        reduce({
          type: "custom",
          name: "legacy-tool-result",
          data: {
            toolCallId,
            toolName,
            content: event.content,
            isError: event.isError === true,
          },
        });
        break;
      }
      case "CUSTOM":
        reduce({
          type: "custom",
          name: typeof event.name === "string" ? event.name : "custom",
          data: event.value,
        });
        break;
      default:
        rejectUnknown();
        break;
    }
  }

  const finalized = finalizeStreamProjection(reducer, 0);
  reducer = finalized.state;
  frames.push(...finalized.frames);

  return { status: "ok", frames, repairs: [...repairs] };
}

type Version2Validator = {
  lastSequence: number;
  keys: Set<string>;
  openText: Set<string>;
  openReasoning: Set<string>;
  openTools: Set<string>;
  toolNames: Map<string, string>;
  toolInputText: Map<string, string>;
};

function readVersion2(
  events: readonly Readonly<Record<string, unknown>>[],
): ConversationRunLifecycleReadResult {
  const frames: StreamLifecycleFrame[] = [];
  const validator: Version2Validator = {
    lastSequence: 0,
    keys: new Set(),
    openText: new Set(),
    openReasoning: new Set(),
    openTools: new Set(),
    toolNames: new Map(),
    toolInputText: new Map(),
  };
  let sequence = 0;

  const invalid = (
    code: "VERSION_2_LIFECYCLE_VIOLATION" | "UNSUPPORTED_DURABLE_EVENT",
  ): ConversationRunLifecycleReadResult => ({ status: "invalid", frames, code });

  const push = (event: StreamProtocolEvent): void => {
    frames.push({
      class: "semantic",
      event,
      sequence: ++sequence,
      elapsedMs: 0,
    });
  };

  const readRequiredString = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;

  for (const event of events) {
    if (event.stream_protocol_version !== 2) {
      return invalid("VERSION_2_LIFECYCLE_VIOLATION");
    }
    const logicalSequence = event.logical_sequence;
    if (
      typeof logicalSequence !== "number" ||
      !Number.isInteger(logicalSequence) ||
      logicalSequence <= validator.lastSequence
    ) {
      return invalid("VERSION_2_LIFECYCLE_VIOLATION");
    }
    validator.lastSequence = logicalSequence;
    const idempotencyKey = event.idempotency_key;
    if (
      typeof idempotencyKey !== "string" || idempotencyKey.length === 0 ||
      validator.keys.has(idempotencyKey)
    ) {
      return invalid("VERSION_2_LIFECYCLE_VIOLATION");
    }
    validator.keys.add(idempotencyKey);

    const type = typeof event.type === "string" ? event.type : null;
    switch (type) {
      case "TEXT_MESSAGE_START": {
        const contentId = readRequiredString(event.contentId);
        if (contentId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (validator.openText.has(contentId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        validator.openText.add(contentId);
        push({ type: "text_start", id: contentId });
        break;
      }
      case "TEXT_MESSAGE_CONTENT": {
        const contentId = readRequiredString(event.contentId);
        if (contentId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (!validator.openText.has(contentId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        push({
          type: "text_content",
          id: contentId,
          delta: typeof event.delta === "string" ? event.delta : "",
        });
        break;
      }
      case "TEXT_MESSAGE_END": {
        const contentId = readRequiredString(event.contentId);
        if (contentId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (!validator.openText.has(contentId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        validator.openText.delete(contentId);
        push({ type: "text_end", id: contentId });
        break;
      }
      case "REASONING_MESSAGE_START": {
        const contentId = readRequiredString(event.contentId);
        if (contentId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (validator.openReasoning.has(contentId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        validator.openReasoning.add(contentId);
        push({ type: "reasoning_start", id: contentId });
        break;
      }
      case "REASONING_MESSAGE_CONTENT": {
        const contentId = readRequiredString(event.contentId);
        if (contentId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (!validator.openReasoning.has(contentId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        push({
          type: "reasoning_content",
          id: contentId,
          delta: typeof event.delta === "string" ? event.delta : "",
        });
        break;
      }
      case "REASONING_MESSAGE_END": {
        const contentId = readRequiredString(event.contentId);
        if (contentId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (!validator.openReasoning.has(contentId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        validator.openReasoning.delete(contentId);
        push({ type: "reasoning_end", id: contentId });
        break;
      }
      case "TOOL_CALL_START": {
        const toolCallId = readRequiredString(event.toolCallId);
        const toolName = readRequiredString(event.toolName);
        if (toolCallId === null || toolName === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (validator.openTools.has(toolCallId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        validator.openTools.add(toolCallId);
        validator.toolNames.set(toolCallId, toolName);
        validator.toolInputText.set(toolCallId, "");
        push({ type: "tool_input_start", toolCallId, toolName });
        break;
      }
      case "TOOL_CALL_ARGS": {
        const toolCallId = readRequiredString(event.toolCallId);
        if (toolCallId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (!validator.openTools.has(toolCallId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        validator.toolInputText.set(
          toolCallId,
          `${validator.toolInputText.get(toolCallId) ?? ""}${
            typeof event.delta === "string" ? event.delta : ""
          }`,
        );
        push({
          type: "tool_input_content",
          toolCallId,
          delta: typeof event.delta === "string" ? event.delta : "",
        });
        break;
      }
      case "TOOL_CALL_END": {
        const toolCallId = readRequiredString(event.toolCallId);
        if (toolCallId === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        if (!validator.openTools.has(toolCallId)) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        const toolName = validator.toolNames.get(toolCallId);
        if (toolName === undefined) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        validator.openTools.delete(toolCallId);
        const parsed = parseCanonicalToolInput(validator.toolInputText.get(toolCallId) ?? "");
        validator.toolNames.delete(toolCallId);
        validator.toolInputText.delete(toolCallId);
        if (parsed.ok) {
          push({
            type: "tool_input_ready",
            toolCallId,
            toolName,
            input: parsed.value,
          });
        } else {
          push({
            type: "tool_input_rejected",
            toolCallId,
            toolName,
            reason: parsed.reason,
          });
        }
        break;
      }
      case "TOOL_CALL_RESULT": {
        const toolCallId = readRequiredString(event.toolCallId);
        const toolName = readRequiredString(event.toolName);
        if (toolCallId === null || toolName === null) {
          return invalid("VERSION_2_LIFECYCLE_VIOLATION");
        }
        push({
          type: "custom",
          name: "tool-call-result",
          data: {
            toolCallId,
            toolName,
            content: event.content,
            isError: event.isError === true,
          },
        });
        break;
      }
      case "CUSTOM":
        push({
          type: "custom",
          name: typeof event.name === "string" ? event.name : "custom",
          data: event.value,
        });
        break;
      default:
        return invalid("UNSUPPORTED_DURABLE_EVENT");
    }
  }

  if (
    validator.openText.size > 0 || validator.openReasoning.size > 0 ||
    validator.openTools.size > 0
  ) {
    return invalid("VERSION_2_LIFECYCLE_VIOLATION");
  }

  return { status: "ok", frames, repairs: [] };
}

function toolInputTextFor(
  reducer: StreamReducerState,
  toolCallId: string,
): string {
  return reducer.tools.get(toolCallId)?.inputText ?? "";
}

function toolNameFor(
  reducer: StreamReducerState,
  toolCallId: string,
): string | undefined {
  return reducer.tools.get(toolCallId)?.name;
}

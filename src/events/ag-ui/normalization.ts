import { parseEvent } from "#veryfront/events/parser.ts";
import type { EventRecord } from "#veryfront/events/types.ts";
import { projectAgUiNativeProfileEvent } from "#veryfront/events/ag-ui/native-profile.ts";
import type { AgUiNativeProfileContext } from "#veryfront/events/ag-ui/native-profile.ts";
import { parseAgUiEvent } from "#veryfront/events/ag-ui/parser.ts";
import { AG_UI_PROTOCOL_VERSION } from "#veryfront/events/ag-ui/schema.ts";
import type {
  AcceptAgUiEventInput,
  AcceptAgUiEventResult,
  AcceptNativeEventInput,
  AgUiEvent,
  AgUiEventOf,
  AgUiExpandedEventCommand,
  AgUiMissingFactRequirementCommand,
  AgUiNativeMessageProjection,
  AgUiNativeProfileEventCommand,
  AgUiNativeProjectionContext,
  AgUiNativeToolCallProjection,
  AgUiNormalizationCommand,
  AgUiNormalizationState,
  AgUiPendingStream,
  AgUiProducerOccurrence,
  ProjectAgUiEventInput,
  ProjectNativeEventInput,
} from "#veryfront/events/ag-ui/types.ts";

function validateProducerOccurrence(occurrence: AgUiProducerOccurrence): void {
  if (typeof occurrence.source !== "string" || occurrence.source.length === 0) {
    throw new TypeError("AG-UI producer occurrence source must be a non-empty URI reference.");
  }
  if (typeof occurrence.id !== "string" || occurrence.id.length === 0) {
    throw new TypeError("AG-UI producer occurrence id must be non-empty.");
  }
}

function occurrenceKey(occurrence: AgUiProducerOccurrence): string {
  validateProducerOccurrence(occurrence);
  return JSON.stringify([occurrence.source, occurrence.id]);
}

function nativeProfileContextOccurrence(
  context: AgUiNativeProfileContext,
): AgUiProducerOccurrence {
  switch (context.family) {
    case "run":
      return {
        source: context.run.occurrence.source,
        id: context.run.occurrence.id,
      };
    case "synchronization":
      return {
        source: context.synchronization.occurrence.source,
        id: context.synchronization.occurrence.id,
      };
    case "content":
      return {
        source: context.content.occurrence.source,
        id: context.content.occurrence.id,
      };
    case "tool":
      return {
        source: context.tool.occurrence.source,
        id: context.tool.occurrence.id,
      };
    case "reasoning":
      return {
        source: context.reasoning.occurrence.source,
        id: context.reasoning.occurrence.id,
      };
    case "invocation":
      return {
        source: context.invocation.occurrence.source,
        id: context.invocation.occurrence.id,
      };
    case "signal":
      return {
        source: context.signal.occurrence.source,
        id: context.signal.occurrence.id,
      };
  }
  const exhaustive: never = context;
  return exhaustive;
}

function validateNativeProfileContextOccurrence(
  context: AgUiNativeProfileContext,
  producerOccurrence: AgUiProducerOccurrence,
): void {
  const contextOccurrence = nativeProfileContextOccurrence(context);
  validateProducerOccurrence(contextOccurrence);
  if (
    contextOccurrence.source !== producerOccurrence.source ||
    contextOccurrence.id !== producerOccurrence.id
  ) {
    throw new TypeError(
      "native profile context occurrence must match accepted producer occurrence",
    );
  }
}

function withNativeProfileContextOccurrence(
  context: AgUiNativeProfileContext,
  occurrence: AgUiProducerOccurrence,
): AgUiNativeProfileContext {
  switch (context.family) {
    case "run":
      return {
        ...context,
        run: {
          ...context.run,
          occurrence: { ...context.run.occurrence, ...occurrence },
        },
      };
    case "synchronization":
      return {
        ...context,
        synchronization: {
          occurrence: { ...context.synchronization.occurrence, ...occurrence },
        },
      };
    case "content":
      return {
        ...context,
        content: {
          ...context.content,
          occurrence: { ...context.content.occurrence, ...occurrence },
        },
      };
    case "tool":
      return {
        ...context,
        tool: {
          ...context.tool,
          occurrence: { ...context.tool.occurrence, ...occurrence },
        },
      };
    case "reasoning":
      return {
        ...context,
        reasoning: {
          ...context.reasoning,
          occurrence: { ...context.reasoning.occurrence, ...occurrence },
        },
      };
    case "invocation":
      return {
        ...context,
        invocation: {
          ...context.invocation,
          occurrence: { ...context.invocation.occurrence, ...occurrence },
        },
      };
    case "signal":
      return {
        ...context,
        signal: {
          ...context.signal,
          occurrence: { ...context.signal.occurrence, ...occurrence },
        },
      };
  }
  const exhaustive: never = context;
  return exhaustive;
}

const TEXT_MESSAGE_CHUNK_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "role",
  "name",
  "delta",
]);
const TOOL_CALL_CHUNK_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "toolCallId",
  "toolCallName",
  "parentMessageId",
  "delta",
]);
const REASONING_MESSAGE_CHUNK_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "delta",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extensionFields(
  source: AgUiEvent,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const sourceValue: unknown = source;
  if (!isRecord(sourceValue)) return undefined;
  const entries = Object.entries(sourceValue).filter(([key]) => !knownFields.has(key));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function hasChunkPayloadFields(source: AgUiEvent, knownFields: ReadonlySet<string>): boolean {
  return source.metadata !== undefined || source.rawEvent !== undefined ||
    extensionFields(source, knownFields) !== undefined;
}

function withChunkStartFields<TEvent extends AgUiEvent>(
  source: AgUiEvent,
  event: TEvent,
): TEvent & Pick<AgUiEvent, "metadata"> {
  return {
    ...event,
    ...(source.timestamp === undefined ? {} : { timestamp: source.timestamp }),
    ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
  };
}

function withChunkPayloadFields<TEvent extends AgUiEvent>(
  source: AgUiEvent,
  event: TEvent,
  knownFields: ReadonlySet<string>,
):
  & TEvent
  & Pick<AgUiEvent, "metadata">
  & { readonly rawEvent?: unknown }
  & Record<string, unknown> {
  return {
    ...(extensionFields(source, knownFields) ?? {}),
    ...event,
    ...(source.timestamp === undefined ? {} : { timestamp: source.timestamp }),
    ...(source.metadata === undefined ? {} : { metadata: source.metadata }),
    ...(source.rawEvent === undefined ? {} : { rawEvent: source.rawEvent }),
  };
}

function mergeExtensionFieldsIntoLastExpandedCommand(
  commands: AgUiNormalizationCommand[],
  source: AgUiEvent,
  knownFields: ReadonlySet<string>,
): void {
  const fields = extensionFields(source, knownFields);
  if (fields === undefined) return;
  const last = commands.at(-1);
  if (last?.kind !== "expanded-ag-ui-event") return;
  commands[commands.length - 1] = {
    ...last,
    event: { ...fields, ...last.event },
  };
}

function emptyState(): AgUiNormalizationState {
  return { pendingStreams: [] };
}

function pendingEntityId(pending: AgUiPendingStream): string {
  return pending.kind === "tool" ? pending.toolCallId : pending.messageId;
}

function sameLane(left: string | undefined, right: string | undefined): boolean {
  return left === right;
}

function laneTag(event: AgUiEvent): string | undefined {
  return event.subagentRunId;
}

function removeLane(
  state: AgUiNormalizationState,
  lane: string | undefined,
): AgUiNormalizationState {
  return {
    pendingStreams: state.pendingStreams.filter((pending) => !sameLane(pending.lane, lane)),
  };
}

function setPendingStream(
  state: AgUiNormalizationState,
  pending: AgUiPendingStream,
): AgUiNormalizationState {
  return {
    pendingStreams: [
      ...state.pendingStreams.filter((candidate) => !sameLane(candidate.lane, pending.lane)),
      pending,
    ],
  };
}

function findLaneHolding(
  state: AgUiNormalizationState,
  kind: AgUiPendingStream["kind"],
  entityId: string,
): AgUiPendingStream | undefined {
  return state.pendingStreams.find((pending) =>
    pending.kind === kind && pendingEntityId(pending) === entityId
  );
}

function findPendingByLane(
  state: AgUiNormalizationState,
  lane: string | undefined,
): AgUiPendingStream | undefined {
  return state.pendingStreams.find((pending) => sameLane(pending.lane, lane));
}

function matchingPendingStreams(
  state: AgUiNormalizationState,
  kind: AgUiPendingStream["kind"],
  lane: string | undefined,
): readonly AgUiPendingStream[] {
  return state.pendingStreams.filter((pending) =>
    pending.kind === kind && sameLane(pending.lane, lane)
  );
}

function resolveLane(
  state: AgUiNormalizationState,
  kind: AgUiPendingStream["kind"],
  entityId: string | undefined,
  lane: string | undefined,
  producerOccurrence: AgUiProducerOccurrence,
  chunkType: string,
): { readonly success: true; readonly lane: string | undefined } | {
  readonly success: false;
  readonly command: AgUiMissingFactRequirementCommand;
} {
  if (entityId !== undefined) {
    const holding = findLaneHolding(state, kind, entityId);
    if (holding) {
      if (lane !== undefined && lane !== holding.lane) {
        return {
          success: false,
          command: missingRequirement(
            producerOccurrence,
            "conflicting-shorthand-context",
            `${chunkType} names ${entityId} in lane ${lane}, but that entity is already open in lane ${
              holding.lane ?? "parent"
            }.`,
          ),
        };
      }
      return { success: true, lane: holding.lane };
    }
    return { success: true, lane };
  }

  const inLane = matchingPendingStreams(state, kind, lane);
  const candidates = lane === undefined && inLane.length === 0
    ? state.pendingStreams.filter((pending) => pending.kind === kind)
    : inLane;
  const onlyCandidate = candidates[0];
  if (candidates.length === 1 && onlyCandidate) {
    return { success: true, lane: onlyCandidate.lane };
  }
  return {
    success: false,
    command: missingRequirement(
      producerOccurrence,
      "unambiguous-shorthand-context",
      `${chunkType} without an entity id needs one open ${kind} stream in its lane, or one unambiguous stream when attribution is absent.`,
    ),
  };
}

function closePendingStream(
  pending: AgUiPendingStream,
  producerOccurrence: AgUiProducerOccurrence,
  ordinal: number,
): AgUiExpandedEventCommand {
  switch (pending.kind) {
    case "text": {
      const event: AgUiEventOf<"TEXT_MESSAGE_END"> = {
        type: "TEXT_MESSAGE_END",
        messageId: pending.messageId,
        ...(pending.subagentRunId === undefined ? {} : { subagentRunId: pending.subagentRunId }),
      };
      return expandedCommand(producerOccurrence, ordinal, event);
    }
    case "tool": {
      const event: AgUiEventOf<"TOOL_CALL_END"> = {
        type: "TOOL_CALL_END",
        toolCallId: pending.toolCallId,
        ...(pending.subagentRunId === undefined ? {} : { subagentRunId: pending.subagentRunId }),
      };
      return expandedCommand(producerOccurrence, ordinal, event);
    }
    case "reasoning": {
      const event: AgUiEventOf<"REASONING_MESSAGE_END"> = {
        type: "REASONING_MESSAGE_END",
        messageId: pending.messageId,
        ...(pending.subagentRunId === undefined ? {} : { subagentRunId: pending.subagentRunId }),
      };
      return expandedCommand(producerOccurrence, ordinal, event);
    }
  }
}

function expandedCommand(
  producerOccurrence: AgUiProducerOccurrence,
  ordinal: number,
  event: AgUiEvent,
): AgUiExpandedEventCommand {
  return {
    kind: "expanded-ag-ui-event",
    producerOccurrence,
    expansionId: `${occurrenceKey(producerOccurrence)}:${ordinal}`,
    ordinal,
    event,
  };
}

function missingRequirement(
  producerOccurrence: AgUiProducerOccurrence,
  requirement: AgUiMissingFactRequirementCommand["requirement"],
  reason: string,
): AgUiMissingFactRequirementCommand {
  return {
    kind: "missing-fact-requirement",
    producerOccurrence,
    requirement,
    reason,
  };
}

interface ExpansionResult {
  readonly commands: readonly AgUiNormalizationCommand[];
  readonly state: AgUiNormalizationState;
}

function expandTextChunk(
  event: AgUiEventOf<"TEXT_MESSAGE_CHUNK">,
  producerOccurrence: AgUiProducerOccurrence,
  state: AgUiNormalizationState,
): ExpansionResult {
  const messageId = event.messageId;
  const lane = laneTag(event);
  const resolved = resolveLane(state, "text", messageId, lane, producerOccurrence, event.type);
  if (!resolved.success) return { commands: [resolved.command], state };

  const open = findPendingByLane(state, resolved.lane);
  const commands: AgUiNormalizationCommand[] = [];
  let nextState = state;
  let pending: Extract<AgUiPendingStream, { readonly kind: "text" }>;

  if (open?.kind === "text" && (messageId === undefined || messageId === open.messageId)) {
    const incomingRole = event.role;
    if (incomingRole !== undefined && incomingRole !== open.role) {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "conflicting-shorthand-context",
            `TEXT_MESSAGE_CHUNK role ${incomingRole} conflicts with open stream role ${open.role}.`,
          ),
        ],
        state,
      };
    }
    const incomingName = event.name;
    if (incomingName !== undefined && incomingName !== open.name) {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "conflicting-shorthand-context",
            `TEXT_MESSAGE_CHUNK name ${incomingName} conflicts with the open stream name.`,
          ),
        ],
        state,
      };
    }
    pending = open;
  } else {
    if (open) {
      commands.push(closePendingStream(open, producerOccurrence, commands.length));
      nextState = removeLane(nextState, resolved.lane);
    }
    if (messageId === undefined) {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "unambiguous-shorthand-context",
            "First TEXT_MESSAGE_CHUNK in an invocation lane must carry messageId.",
          ),
        ],
        state: nextState,
      };
    }
    const role = event.role ?? "assistant";
    if (role !== "developer" && role !== "system" && role !== "assistant" && role !== "user") {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "conflicting-shorthand-context",
            `TEXT_MESSAGE_CHUNK role ${role} is not a text message role.`,
          ),
        ],
        state: nextState,
      };
    }
    pending = {
      kind: "text",
      lane: resolved.lane,
      messageId,
      role,
      name: event.name,
      subagentRunId: lane,
    };
    nextState = setPendingStream(nextState, pending);
    const start: AgUiEventOf<"TEXT_MESSAGE_START"> = {
      type: "TEXT_MESSAGE_START",
      messageId,
      role,
      ...(pending.name === undefined ? {} : { name: pending.name }),
      ...(pending.subagentRunId === undefined ? {} : { subagentRunId: pending.subagentRunId }),
    };
    commands.push(
      expandedCommand(
        producerOccurrence,
        commands.length,
        withChunkStartFields(event, start),
      ),
    );
  }

  let emittedPayload = false;
  if (
    event.delta !== undefined || event.rawEvent !== undefined ||
    (commands.length === 0 && hasChunkPayloadFields(event, TEXT_MESSAGE_CHUNK_FIELDS))
  ) {
    const content: AgUiEventOf<"TEXT_MESSAGE_CONTENT"> = {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: pending.messageId,
      delta: event.delta === undefined ? "" : event.delta,
      ...((lane ?? pending.subagentRunId) === undefined
        ? {}
        : { subagentRunId: lane ?? pending.subagentRunId }),
    };
    commands.push(
      expandedCommand(
        producerOccurrence,
        commands.length,
        withChunkPayloadFields(event, content, TEXT_MESSAGE_CHUNK_FIELDS),
      ),
    );
    emittedPayload = true;
  }
  if (!emittedPayload) {
    mergeExtensionFieldsIntoLastExpandedCommand(commands, event, TEXT_MESSAGE_CHUNK_FIELDS);
  }

  return { commands, state: nextState };
}

function expandToolChunk(
  event: AgUiEventOf<"TOOL_CALL_CHUNK">,
  producerOccurrence: AgUiProducerOccurrence,
  state: AgUiNormalizationState,
): ExpansionResult {
  const toolCallId = event.toolCallId;
  const toolCallName = event.toolCallName;
  const lane = laneTag(event);
  const resolved = resolveLane(state, "tool", toolCallId, lane, producerOccurrence, event.type);
  if (!resolved.success) return { commands: [resolved.command], state };

  const open = findPendingByLane(state, resolved.lane);
  const commands: AgUiNormalizationCommand[] = [];
  let nextState = state;
  let pending: Extract<AgUiPendingStream, { readonly kind: "tool" }>;
  if (open?.kind === "tool" && (toolCallId === undefined || toolCallId === open.toolCallId)) {
    if (toolCallName !== undefined && toolCallName !== open.toolCallName) {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "conflicting-shorthand-context",
            `TOOL_CALL_CHUNK toolCallName ${toolCallName} conflicts with open tool call ${open.toolCallName}.`,
          ),
        ],
        state,
      };
    }
    const parentMessageId = event.parentMessageId;
    if (parentMessageId !== undefined && parentMessageId !== open.parentMessageId) {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "conflicting-shorthand-context",
            "TOOL_CALL_CHUNK parentMessageId conflicts with the open tool call.",
          ),
        ],
        state,
      };
    }
    pending = open;
  } else {
    if (toolCallId === undefined || toolCallName === undefined) {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "unambiguous-shorthand-context",
            "First TOOL_CALL_CHUNK in an invocation lane must carry toolCallId and toolCallName.",
          ),
        ],
        state,
      };
    }
    if (open) {
      commands.push(closePendingStream(open, producerOccurrence, commands.length));
      nextState = removeLane(nextState, resolved.lane);
    }
    pending = {
      kind: "tool",
      lane: resolved.lane,
      toolCallId,
      toolCallName,
      parentMessageId: event.parentMessageId,
      subagentRunId: lane,
    };
    nextState = setPendingStream(nextState, pending);
    const start: AgUiEventOf<"TOOL_CALL_START"> = {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName,
      ...(pending.parentMessageId === undefined
        ? {}
        : { parentMessageId: pending.parentMessageId }),
      ...(pending.subagentRunId === undefined ? {} : { subagentRunId: pending.subagentRunId }),
    };
    commands.push(
      expandedCommand(
        producerOccurrence,
        commands.length,
        withChunkStartFields(event, start),
      ),
    );
  }

  let emittedPayload = false;
  if (
    event.delta !== undefined || event.rawEvent !== undefined ||
    (commands.length === 0 && hasChunkPayloadFields(event, TOOL_CALL_CHUNK_FIELDS))
  ) {
    const args: AgUiEventOf<"TOOL_CALL_ARGS"> = {
      type: "TOOL_CALL_ARGS",
      toolCallId: pending.toolCallId,
      delta: event.delta === undefined ? "" : event.delta,
      ...((lane ?? pending.subagentRunId) === undefined
        ? {}
        : { subagentRunId: lane ?? pending.subagentRunId }),
    };
    commands.push(
      expandedCommand(
        producerOccurrence,
        commands.length,
        withChunkPayloadFields(event, args, TOOL_CALL_CHUNK_FIELDS),
      ),
    );
    emittedPayload = true;
  }
  if (!emittedPayload) {
    mergeExtensionFieldsIntoLastExpandedCommand(commands, event, TOOL_CALL_CHUNK_FIELDS);
  }

  return { commands, state: nextState };
}

function expandReasoningChunk(
  event: AgUiEventOf<"REASONING_MESSAGE_CHUNK">,
  producerOccurrence: AgUiProducerOccurrence,
  state: AgUiNormalizationState,
): ExpansionResult {
  const messageId = event.messageId;
  const lane = laneTag(event);
  const resolved = resolveLane(state, "reasoning", messageId, lane, producerOccurrence, event.type);
  if (!resolved.success) return { commands: [resolved.command], state };

  const open = findPendingByLane(state, resolved.lane);
  const commands: AgUiNormalizationCommand[] = [];
  let nextState = state;
  let pending: Extract<AgUiPendingStream, { readonly kind: "reasoning" }>;
  if (open?.kind === "reasoning" && (messageId === undefined || messageId === open.messageId)) {
    pending = open;
  } else {
    if (open) {
      commands.push(closePendingStream(open, producerOccurrence, commands.length));
      nextState = removeLane(nextState, resolved.lane);
    }
    if (messageId === undefined) {
      return {
        commands: [
          missingRequirement(
            producerOccurrence,
            "unambiguous-shorthand-context",
            "First REASONING_MESSAGE_CHUNK in an invocation lane must carry messageId.",
          ),
        ],
        state: nextState,
      };
    }
    pending = {
      kind: "reasoning",
      lane: resolved.lane,
      messageId,
      subagentRunId: lane,
    };
    nextState = setPendingStream(nextState, pending);
    const start: AgUiEventOf<"REASONING_MESSAGE_START"> = {
      type: "REASONING_MESSAGE_START",
      messageId,
      role: "reasoning",
      ...(pending.subagentRunId === undefined ? {} : { subagentRunId: pending.subagentRunId }),
    };
    commands.push(
      expandedCommand(
        producerOccurrence,
        commands.length,
        withChunkStartFields(event, start),
      ),
    );
  }

  let emittedPayload = false;
  if (
    event.delta !== undefined || event.rawEvent !== undefined ||
    (commands.length === 0 && hasChunkPayloadFields(event, REASONING_MESSAGE_CHUNK_FIELDS))
  ) {
    const content: AgUiEventOf<"REASONING_MESSAGE_CONTENT"> = {
      type: "REASONING_MESSAGE_CONTENT",
      messageId: pending.messageId,
      delta: event.delta === undefined ? "" : event.delta,
      ...((lane ?? pending.subagentRunId) === undefined
        ? {}
        : { subagentRunId: lane ?? pending.subagentRunId }),
    };
    commands.push(
      expandedCommand(
        producerOccurrence,
        commands.length,
        withChunkPayloadFields(event, content, REASONING_MESSAGE_CHUNK_FIELDS),
      ),
    );
    emittedPayload = true;
  }
  if (!emittedPayload) {
    mergeExtensionFieldsIntoLastExpandedCommand(commands, event, REASONING_MESSAGE_CHUNK_FIELDS);
  }

  return { commands, state: nextState };
}

function closeAllStreams(
  state: AgUiNormalizationState,
  producerOccurrence: AgUiProducerOccurrence,
): ExpansionResult {
  return {
    commands: state.pendingStreams.map((pending, ordinal) =>
      closePendingStream(pending, producerOccurrence, ordinal)
    ),
    state: emptyState(),
  };
}

function closeLaneStreams(
  state: AgUiNormalizationState,
  lane: string | undefined,
  producerOccurrence: AgUiProducerOccurrence,
): ExpansionResult {
  const closing = state.pendingStreams.filter((pending) => sameLane(pending.lane, lane));
  return {
    commands: closing.map((pending, ordinal) =>
      closePendingStream(pending, producerOccurrence, ordinal)
    ),
    state: {
      pendingStreams: state.pendingStreams.filter((pending) => !sameLane(pending.lane, lane)),
    },
  };
}

function expansionCommands(
  event: AgUiEvent,
  producerOccurrence: AgUiProducerOccurrence,
  state: AgUiNormalizationState,
): ExpansionResult {
  switch (event.type) {
    case "TEXT_MESSAGE_CHUNK":
      return expandTextChunk(event, producerOccurrence, state);
    case "TOOL_CALL_CHUNK":
      return expandToolChunk(event, producerOccurrence, state);
    case "REASONING_MESSAGE_CHUNK":
      return expandReasoningChunk(event, producerOccurrence, state);
    case "RUN_STARTED":
    case "RUN_FINISHED":
    case "RUN_ERROR":
    case "MESSAGES_SNAPSHOT":
      return event.subagentRunId === undefined
        ? closeAllStreams(state, producerOccurrence)
        : closeLaneStreams(state, event.subagentRunId, producerOccurrence);
    case "RAW":
    case "ACTIVITY_SNAPSHOT":
    case "ACTIVITY_DELTA":
    case "REASONING_ENCRYPTED_VALUE":
    case "SUBAGENT_STARTED":
      return { commands: [], state };
    case "SUBAGENT_FINISHED":
    case "SUBAGENT_ERROR":
      return closeLaneStreams(state, event.subagentRunId, producerOccurrence);
    case "TEXT_MESSAGE_START":
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_END":
    case "TOOL_CALL_START":
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_END":
    case "TOOL_CALL_RESULT":
    case "STATE_SNAPSHOT":
    case "STATE_DELTA":
    case "CUSTOM":
    case "STEP_STARTED":
    case "STEP_FINISHED":
    case "REASONING_START":
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_END":
    case "REASONING_END":
      return closeLaneStreams(state, laneTag(event), producerOccurrence);
  }
}

function missingFactCommands(
  event: AgUiEvent,
  producerOccurrence: AgUiProducerOccurrence,
): readonly AgUiMissingFactRequirementCommand[] {
  switch (event.type) {
    case "RUN_FINISHED": {
      const outcome = event.outcome;
      if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return [];
      const type = "type" in outcome ? outcome.type : undefined;
      if (type === "interrupt") {
        return [
          missingRequirement(
            producerOccurrence,
            "native-run-suspension-outcome",
            "RUN_FINISHED interrupt needs a native suspension fact with typed interrupt linkage before target projection.",
          ),
        ];
      }
      if (type === "cancelled") {
        return [
          missingRequirement(
            producerOccurrence,
            "native-run-cancellation-outcome",
            "RUN_FINISHED cancelled is distinct from success and needs an explicit native cancellation outcome.",
          ),
        ];
      }
      return [];
    }
    case "STATE_SNAPSHOT":
    case "STATE_DELTA":
      return [
        missingRequirement(
          producerOccurrence,
          "native-state-synchronization",
          `${event.type} needs first-class native state synchronization storage and replay semantics.`,
        ),
      ];
    case "MESSAGES_SNAPSHOT":
      return [
        missingRequirement(
          producerOccurrence,
          "native-message-snapshot-synchronization",
          "MESSAGES_SNAPSHOT needs transcript snapshot synchronization before target projection.",
        ),
      ];
    case "ACTIVITY_SNAPSHOT":
    case "ACTIVITY_DELTA":
      return [
        missingRequirement(
          producerOccurrence,
          "native-activity-synchronization",
          `${event.type} needs structured activity storage and ordered patch application.`,
        ),
      ];
    case "RAW":
      return [
        missingRequirement(
          producerOccurrence,
          "native-raw-protocol-signal",
          "RAW preserves a provider-native protocol signal and must not be reinterpreted as an execution fact.",
        ),
      ];
    case "CUSTOM":
      return [
        missingRequirement(
          producerOccurrence,
          "native-custom-protocol-signal",
          "CUSTOM preserves an application extension signal and must not create platform authority.",
        ),
      ];
    case "REASONING_START":
    case "REASONING_END":
      return [
        missingRequirement(
          producerOccurrence,
          "native-reasoning-context-boundary",
          `${event.type} is a reasoning context boundary, not a visible reasoning segment boundary.`,
        ),
      ];
    case "REASONING_ENCRYPTED_VALUE":
      return [
        missingRequirement(
          producerOccurrence,
          "native-opaque-reasoning-continuation",
          "REASONING_ENCRYPTED_VALUE must be retained as opaque continuation, never as visible reasoning text.",
        ),
      ];
    case "SUBAGENT_STARTED":
    case "SUBAGENT_FINISHED":
    case "SUBAGENT_ERROR":
      return [
        missingRequirement(
          producerOccurrence,
          "native-subagent-invocation-boundary",
          `${event.type} needs native invocation provenance distinct from durable child-run ownership.`,
        ),
      ];
    default:
      return [];
  }
}

function expandedFrameBelongsToShorthandEvent(
  expandedEvent: AgUiEvent,
  shorthandEvent:
    | AgUiEventOf<"TEXT_MESSAGE_CHUNK">
    | AgUiEventOf<"TOOL_CALL_CHUNK">
    | AgUiEventOf<"REASONING_MESSAGE_CHUNK">,
): boolean {
  switch (shorthandEvent.type) {
    case "TEXT_MESSAGE_CHUNK":
      return shorthandEvent.messageId === undefined ||
        (
          (expandedEvent.type === "TEXT_MESSAGE_START" ||
            expandedEvent.type === "TEXT_MESSAGE_CONTENT" ||
            expandedEvent.type === "TEXT_MESSAGE_END") &&
          expandedEvent.messageId === shorthandEvent.messageId
        );
    case "TOOL_CALL_CHUNK":
      return shorthandEvent.toolCallId === undefined ||
        (
          (expandedEvent.type === "TOOL_CALL_START" || expandedEvent.type === "TOOL_CALL_ARGS" ||
            expandedEvent.type === "TOOL_CALL_END") &&
          expandedEvent.toolCallId === shorthandEvent.toolCallId
        );
    case "REASONING_MESSAGE_CHUNK":
      return shorthandEvent.messageId === undefined ||
        (
          (expandedEvent.type === "REASONING_MESSAGE_START" ||
            expandedEvent.type === "REASONING_MESSAGE_CONTENT" ||
            expandedEvent.type === "REASONING_MESSAGE_END") &&
          expandedEvent.messageId === shorthandEvent.messageId
        );
  }
}

function nativeProfileCommandForEvent(
  event: AgUiEvent,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProfileContext,
): AgUiNativeProfileEventCommand | AgUiMissingFactRequirementCommand {
  const command = projectAgUiNativeProfileEvent({ event, context });
  if (command.kind === "canonical-event") {
    return {
      kind: "canonical-native-event",
      producerOccurrence,
      family: command.family,
      event: command.event,
    };
  }

  return missingRequirement(
    producerOccurrence,
    "native-ag-ui-projection-context",
    command.message,
  );
}

function nativeProfileCommands(
  event: AgUiEvent,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProfileContext | undefined,
  expansionCommands: readonly AgUiNormalizationCommand[],
): readonly (AgUiNativeProfileEventCommand | AgUiMissingFactRequirementCommand)[] {
  if (!context) {
    return missingFactCommands(event, producerOccurrence);
  }

  validateNativeProfileContextOccurrence(context, producerOccurrence);
  if (
    event.type === "TEXT_MESSAGE_CHUNK" || event.type === "TOOL_CALL_CHUNK" ||
    event.type === "REASONING_MESSAGE_CHUNK"
  ) {
    return expansionCommands.flatMap((command) => {
      if (command.kind !== "expanded-ag-ui-event") return [];
      const expandedOccurrence = {
        source: command.producerOccurrence.source,
        id: command.expansionId,
      };
      if (!expandedFrameBelongsToShorthandEvent(command.event, event)) {
        return [
          missingRequirement(
            expandedOccurrence,
            "native-ag-ui-projection-context",
            "Expanded shorthand closure requires exact native profile context for its own persisted identity.",
          ),
        ];
      }
      return [
        nativeProfileCommandForEvent(
          command.event,
          expandedOccurrence,
          withNativeProfileContextOccurrence(context, expandedOccurrence),
        ),
      ];
    });
  }

  const closureRequirements = expansionCommands.flatMap((command) => {
    if (command.kind !== "expanded-ag-ui-event") return [];
    return [
      missingRequirement(
        { source: command.producerOccurrence.source, id: command.expansionId },
        "native-ag-ui-projection-context",
        "Expanded boundary closure requires exact native profile context for its own persisted identity.",
      ),
    ];
  });
  return [
    ...closureRequirements,
    nativeProfileCommandForEvent(event, producerOccurrence, context),
  ];
}

/** Validate an occurrence, normalize its frames and return the next stream state. */
export function acceptAgUiEvent(input: AcceptAgUiEventInput): AcceptAgUiEventResult {
  validateProducerOccurrence(input.producerOccurrence);
  const event = parseAgUiEvent(input.event);
  const expansion = expansionCommands(
    event,
    input.producerOccurrence,
    input.normalizationState ?? emptyState(),
  );
  const accepted = {
    protocol: "ag-ui",
    protocolVersion: AG_UI_PROTOCOL_VERSION,
    producerOccurrence: input.producerOccurrence,
    event,
  } satisfies AcceptAgUiEventResult["accepted"];
  return {
    accepted,
    commands: [
      {
        kind: "accepted-ag-ui-event",
        producerOccurrence: input.producerOccurrence,
        event,
      },
      ...expansion.commands,
      ...nativeProfileCommands(
        event,
        input.producerOccurrence,
        input.nativeProfileContext,
        expansion.commands,
      ),
    ],
    normalizationState: expansion.state,
  };
}

function nativeProducerOccurrence(event: EventRecord): AgUiProducerOccurrence {
  const occurrence = { source: event.source, id: event.id };
  validateProducerOccurrence(occurrence);
  return occurrence;
}

function expandedNativeEvent(
  producerOccurrence: AgUiProducerOccurrence,
  event: AgUiEvent,
): AgUiExpandedEventCommand {
  return expandedCommand(producerOccurrence, 0, event);
}

function missingNativeProjectionContext(
  producerOccurrence: AgUiProducerOccurrence,
  reason: string,
): readonly AgUiMissingFactRequirementCommand[] {
  return [missingRequirement(producerOccurrence, "native-ag-ui-projection-context", reason)];
}

function missingUnsupportedNativeEvent(
  producerOccurrence: AgUiProducerOccurrence,
  event: EventRecord,
  reason: string,
): readonly AgUiMissingFactRequirementCommand[] {
  return [
    missingRequirement(
      producerOccurrence,
      "native-unsupported-target-event",
      `${event.type} cannot be projected to AG-UI 1.0: ${reason}`,
    ),
  ];
}

function missingLossyNativeEvent(
  producerOccurrence: AgUiProducerOccurrence,
  event: EventRecord,
  reason: string,
): readonly AgUiMissingFactRequirementCommand[] {
  return [
    missingRequirement(
      producerOccurrence,
      "native-lossy-target-event",
      `${event.type} cannot be projected to AG-UI without losing native semantics: ${reason}`,
    ),
  ];
}

function runThreadId(
  event: EventRecord,
  context: AgUiNativeProjectionContext | undefined,
  producerOccurrence: AgUiProducerOccurrence,
): { readonly success: true; readonly threadId: string } | {
  readonly success: false;
  readonly commands: readonly AgUiMissingFactRequirementCommand[];
} {
  const threadId = context?.run?.threadId;
  if (threadId !== undefined) return { success: true, threadId };
  return {
    success: false,
    commands: missingNativeProjectionContext(
      producerOccurrence,
      `${event.type} needs persisted AG-UI threadId context for native run ${
        event.runid ?? "<missing>"
      }.`,
    ),
  };
}

function findMessageProjection(
  context: AgUiNativeProjectionContext | undefined,
  kind: AgUiNativeMessageProjection["kind"],
  nativeMessageId: string,
  nativeContentId: string,
): AgUiNativeMessageProjection | undefined {
  return context?.messages?.find((message) =>
    message.kind === kind && message.nativeMessageId === nativeMessageId &&
    message.nativeContentId === nativeContentId
  );
}

function findMessageProjectionByMessageId(
  context: AgUiNativeProjectionContext | undefined,
  nativeMessageId: string,
): AgUiNativeMessageProjection | undefined {
  return context?.messages?.find((message) => message.nativeMessageId === nativeMessageId);
}

function findToolProjection(
  context: AgUiNativeProjectionContext | undefined,
  nativeToolCallId: string,
): AgUiNativeToolCallProjection | undefined {
  return context?.toolCalls?.find((toolCall) => toolCall.nativeToolCallId === nativeToolCallId);
}

function textRole(
  event: EventRecord,
  producerOccurrence: AgUiProducerOccurrence,
): { readonly success: true; readonly role?: AgUiEventOf<"TEXT_MESSAGE_START">["role"] } | {
  readonly success: false;
  readonly commands: readonly AgUiMissingFactRequirementCommand[];
} {
  if (event.type !== "com.veryfront.message.text.started") return { success: true };
  const role = event.data.role;
  if (role === undefined) return { success: true };
  if (role === "developer" || role === "system" || role === "assistant" || role === "user") {
    return { success: true, role };
  }
  return {
    success: false,
    commands: missingLossyNativeEvent(
      producerOccurrence,
      event,
      `text role ${role} is not an AG-UI text role`,
    ),
  };
}

function projectTextNativeEvent(
  event: Extract<EventRecord, {
    readonly type:
      | "com.veryfront.message.text.started"
      | "com.veryfront.message.text.delta.emitted"
      | "com.veryfront.message.text.ended";
  }>,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProjectionContext | undefined,
): readonly AgUiNormalizationCommand[] {
  const mapping = findMessageProjection(
    context,
    "text",
    event.data.messageId,
    event.data.contentId,
  );
  if (!mapping) {
    return missingNativeProjectionContext(
      producerOccurrence,
      `${event.type} needs a persisted text message/content AG-UI identity mapping for ${event.data.messageId}/${event.data.contentId}.`,
    );
  }
  switch (event.type) {
    case "com.veryfront.message.text.started": {
      const role = textRole(event, producerOccurrence);
      if (!role.success) return role.commands;
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "TEXT_MESSAGE_START",
          messageId: mapping.agUiMessageId,
          ...(role.role === undefined ? {} : { role: role.role }),
        }),
      ];
    }
    case "com.veryfront.message.text.delta.emitted": {
      if ("contentRedacted" in event.data) {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "redacted text deltas have no AG-UI text equivalent",
        );
      }
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: mapping.agUiMessageId,
          delta: event.data.delta,
        }),
      ];
    }
    case "com.veryfront.message.text.ended":
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "TEXT_MESSAGE_END",
          messageId: mapping.agUiMessageId,
        }),
      ];
  }
}

function projectReasoningNativeEvent(
  event: Extract<EventRecord, {
    readonly type:
      | "com.veryfront.message.reasoning.started"
      | "com.veryfront.message.reasoning.delta.emitted"
      | "com.veryfront.message.reasoning.ended";
  }>,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProjectionContext | undefined,
): readonly AgUiNormalizationCommand[] {
  const mapping = findMessageProjection(
    context,
    "reasoning",
    event.data.messageId,
    event.data.contentId,
  );
  if (!mapping) {
    return missingNativeProjectionContext(
      producerOccurrence,
      `${event.type} needs a persisted reasoning message/content AG-UI identity mapping for ${event.data.messageId}/${event.data.contentId}.`,
    );
  }
  switch (event.type) {
    case "com.veryfront.message.reasoning.started":
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "REASONING_MESSAGE_START",
          messageId: mapping.agUiMessageId,
          role: "reasoning",
        }),
      ];
    case "com.veryfront.message.reasoning.delta.emitted": {
      if ("contentRedacted" in event.data) {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "redacted reasoning deltas have no AG-UI reasoning equivalent",
        );
      }
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "REASONING_MESSAGE_CONTENT",
          messageId: mapping.agUiMessageId,
          delta: event.data.delta,
        }),
      ];
    }
    case "com.veryfront.message.reasoning.ended":
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "REASONING_MESSAGE_END",
          messageId: mapping.agUiMessageId,
        }),
      ];
  }
}

function projectToolNativeEvent(
  event: Extract<EventRecord, {
    readonly type:
      | "com.veryfront.tool-call.started"
      | "com.veryfront.tool-call.arguments.delta.emitted"
      | "com.veryfront.tool-call.arguments.ended"
      | "com.veryfront.tool-call.result.recorded"
      | "com.veryfront.tool-call.result.submitted";
  }>,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProjectionContext | undefined,
): readonly AgUiNormalizationCommand[] {
  const mapping = findToolProjection(context, event.data.toolCallId);
  if (!mapping) {
    return missingNativeProjectionContext(
      producerOccurrence,
      `${event.type} needs a persisted tool-call AG-UI identity mapping for ${event.data.toolCallId}.`,
    );
  }
  switch (event.type) {
    case "com.veryfront.tool-call.started": {
      let parentMessageId: string | undefined;
      if (event.data.messageId !== undefined) {
        const parent = findMessageProjectionByMessageId(context, event.data.messageId);
        if (!parent) {
          return missingNativeProjectionContext(
            producerOccurrence,
            `${event.type} needs persisted AG-UI parent message mapping for ${event.data.messageId}.`,
          );
        }
        parentMessageId = parent.agUiMessageId;
      }
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "TOOL_CALL_START",
          toolCallId: mapping.agUiToolCallId,
          toolCallName: event.data.toolName,
          ...(parentMessageId === undefined ? {} : { parentMessageId }),
        }),
      ];
    }
    case "com.veryfront.tool-call.arguments.delta.emitted":
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "TOOL_CALL_ARGS",
          toolCallId: mapping.agUiToolCallId,
          delta: event.data.delta,
        }),
      ];
    case "com.veryfront.tool-call.arguments.ended":
      if (event.data.input !== undefined) {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "final structured tool input is not represented by TOOL_CALL_END",
        );
      }
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "TOOL_CALL_END",
          toolCallId: mapping.agUiToolCallId,
        }),
      ];
    case "com.veryfront.tool-call.result.recorded":
    case "com.veryfront.tool-call.result.submitted": {
      if (event.data.isError === true) {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "tool result error status has no TOOL_CALL_RESULT field",
        );
      }
      if ("outputRedacted" in event.data) {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "redacted tool output has no AG-UI tool result equivalent",
        );
      }
      if (typeof event.data.output !== "string") {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "only string tool output maps to AG-UI TOOL_CALL_RESULT content",
        );
      }
      if (mapping.resultMessageId === undefined) {
        return missingNativeProjectionContext(
          producerOccurrence,
          `${event.type} needs persisted AG-UI tool result messageId context for ${event.data.toolCallId}.`,
        );
      }
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "TOOL_CALL_RESULT",
          toolCallId: mapping.agUiToolCallId,
          messageId: mapping.resultMessageId,
          content: event.data.output,
          role: "tool",
        }),
      ];
    }
  }
}

function projectRunNativeEvent(
  event: Extract<EventRecord, {
    readonly type:
      | "com.veryfront.run.started"
      | "com.veryfront.run.succeeded"
      | "com.veryfront.run.failed"
      | "com.veryfront.run.cancelled";
  }>,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProjectionContext | undefined,
): readonly AgUiNormalizationCommand[] {
  const runId = event.runid;
  if (runId === undefined) {
    return missingNativeProjectionContext(producerOccurrence, `${event.type} needs native runid.`);
  }
  const run = runThreadId(event, context, producerOccurrence);
  if (!run.success) return run.commands;
  switch (event.type) {
    case "com.veryfront.run.started":
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "RUN_STARTED",
          threadId: run.threadId,
          runId,
        }),
      ];
    case "com.veryfront.run.succeeded":
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "RUN_FINISHED",
          threadId: run.threadId,
          runId,
          outcome: { type: "success" },
        }),
      ];
    case "com.veryfront.run.failed": {
      const message = event.data.error?.message;
      if (message === undefined) {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "run failure without an error message cannot produce RUN_ERROR.message",
        );
      }
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "RUN_ERROR",
          message,
          ...(event.data.error?.code === undefined ? {} : { code: event.data.error.code }),
        }),
      ];
    }
    case "com.veryfront.run.cancelled":
      if (event.data.reason !== undefined) {
        return missingLossyNativeEvent(
          producerOccurrence,
          event,
          "native cancellation reason has no AG-UI cancelled outcome field",
        );
      }
      return [
        expandedNativeEvent(producerOccurrence, {
          type: "RUN_FINISHED",
          threadId: run.threadId,
          runId,
          outcome: { type: "cancelled" },
        }),
      ];
  }
}

function projectStepNativeEvent(
  event: Extract<EventRecord, {
    readonly type: "com.veryfront.step.started" | "com.veryfront.step.ended";
  }>,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProjectionContext | undefined,
): readonly AgUiNormalizationCommand[] {
  const stepName = event.data.name ??
    context?.steps?.find((step) => step.nativeStepId === event.data.stepId)?.agUiStepName;
  if (stepName === undefined) {
    return missingNativeProjectionContext(
      producerOccurrence,
      `${event.type} needs persisted AG-UI stepName context for native step ${event.data.stepId}.`,
    );
  }
  return [
    expandedNativeEvent(producerOccurrence, {
      type: event.type === "com.veryfront.step.started" ? "STEP_STARTED" : "STEP_FINISHED",
      stepName,
    }),
  ];
}

function projectNativeRecord(
  event: EventRecord,
  producerOccurrence: AgUiProducerOccurrence,
  context: AgUiNativeProjectionContext | undefined,
): readonly AgUiNormalizationCommand[] {
  switch (event.type) {
    case "com.veryfront.message.text.started":
    case "com.veryfront.message.text.delta.emitted":
    case "com.veryfront.message.text.ended":
      return projectTextNativeEvent(event, producerOccurrence, context);
    case "com.veryfront.message.reasoning.started":
    case "com.veryfront.message.reasoning.delta.emitted":
    case "com.veryfront.message.reasoning.ended":
      return projectReasoningNativeEvent(event, producerOccurrence, context);
    case "com.veryfront.tool-call.started":
    case "com.veryfront.tool-call.arguments.delta.emitted":
    case "com.veryfront.tool-call.arguments.ended":
    case "com.veryfront.tool-call.result.recorded":
    case "com.veryfront.tool-call.result.submitted":
      return projectToolNativeEvent(event, producerOccurrence, context);
    case "com.veryfront.run.started":
    case "com.veryfront.run.succeeded":
    case "com.veryfront.run.failed":
    case "com.veryfront.run.cancelled":
      return projectRunNativeEvent(event, producerOccurrence, context);
    case "com.veryfront.step.started":
    case "com.veryfront.step.ended":
      return projectStepNativeEvent(event, producerOccurrence, context);
    case "com.veryfront.step.succeeded":
    case "com.veryfront.step.failed":
    case "com.veryfront.step.cancelled":
    case "com.veryfront.tool-call.status.reported":
    case "com.veryfront.tool-call.refused":
    case "com.veryfront.tool-call.result.delivery.failed":
      return missingLossyNativeEvent(
        producerOccurrence,
        event,
        "native status/result semantics are richer than the supported AG-UI subset",
      );
    default:
      return missingUnsupportedNativeEvent(
        producerOccurrence,
        event,
        "no verified AG-UI equivalent is implemented for this native event type",
      );
  }
}

export function acceptNativeEvent(
  input: AcceptNativeEventInput,
): readonly AgUiNormalizationCommand[] {
  const event = parseEvent(input.event);
  return projectNativeRecord(
    event,
    nativeProducerOccurrence(event),
    input.projectionContext,
  );
}

/** Project an accepted occurrence using explicit native identity mappings. */
export function projectAgUiEvent(
  input: ProjectAgUiEventInput,
): readonly AgUiNormalizationCommand[] {
  validateProducerOccurrence(input.accepted.producerOccurrence);
  const expansion = expansionCommands(
    input.accepted.event,
    input.accepted.producerOccurrence,
    input.normalizationState ?? emptyState(),
  );
  return [
    ...expansion.commands,
    ...missingFactCommands(input.accepted.event, input.accepted.producerOccurrence),
  ];
}

export function projectNativeEvent(
  input: ProjectNativeEventInput,
): readonly AgUiNormalizationCommand[] {
  return projectNativeRecord(
    input.event,
    nativeProducerOccurrence(input.event),
    input.projectionContext,
  );
}

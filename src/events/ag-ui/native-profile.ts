import type { JsonObject } from "#veryfront/events/types.ts";
import type {
  AgUiContentNativeRecord,
  AgUiContentProfileContext,
  AgUiContentProfileSupportedEvent,
  AgUiContentProjectionCommand,
} from "#veryfront/events/ag-ui/native-content-profile.ts";
import {
  parseNativeContentRecord,
  projectAgUiContentEvent,
  projectNativeContentEvent,
} from "#veryfront/events/ag-ui/native-content-profile.ts";
import type {
  AgUiInvocationProjectionCommand,
  AgUiInvocationProjectionContext,
  AgUiInvocationSupportedEvent,
} from "#veryfront/events/ag-ui/native-invocation.ts";
import {
  parseNativeInvocationEvent,
  projectAgUiInvocationEvent,
  projectNativeInvocationEvent,
} from "#veryfront/events/ag-ui/native-invocation.ts";
import type {
  AgUiReasoningProjectionCommand,
  AgUiReasoningProjectionContext,
  AgUiReasoningSupportedEvent,
} from "#veryfront/events/ag-ui/native-reasoning.ts";
import {
  parseNativeReasoningEvent,
  projectAgUiReasoningEvent,
  projectNativeReasoningEvent,
} from "#veryfront/events/ag-ui/native-reasoning.ts";
import type {
  AgUiRunCanonicalEvent,
  AgUiRunProfileProjectionCommand,
  AgUiRunProfileStoredRunContext,
  AgUiRunProfileSupportedEvent,
} from "#veryfront/events/ag-ui/native-run-profile.ts";
import {
  parseNativeRunProfileEvent,
  projectAgUiRunProfileEvent,
  projectNativeRunProfileEvent,
} from "#veryfront/events/ag-ui/native-run-profile.ts";
import type {
  AgUiSignalProjectionCommand,
  AgUiSignalProjectionContext,
  AgUiSignalSupportedEvent,
} from "#veryfront/events/ag-ui/native-signal.ts";
import {
  parseNativeSignalEvent,
  projectAgUiSignalEvent,
  projectNativeSignalEvent,
} from "#veryfront/events/ag-ui/native-signal.ts";
import type {
  AgUiNativeSynchronizationEvent,
  AgUiSynchronizationOccurrence,
  AgUiSynchronizationSupportedEvent,
} from "#veryfront/events/ag-ui/native-synchronization.ts";
import type {
  AgUiToolNativeRecord,
  AgUiToolProfileContext,
  AgUiToolProfileSupportedEvent,
  AgUiToolProjectionCommand,
} from "#veryfront/events/ag-ui/native-tool-profile.ts";
import {
  parseNativeToolRecord,
  projectAgUiToolEvent,
  projectNativeToolEvent,
} from "#veryfront/events/ag-ui/native-tool-profile.ts";
import {
  parseNativeSynchronizationEvent,
  projectAgUiSynchronizationEvent,
  projectNativeSynchronizationEvent,
} from "#veryfront/events/ag-ui/native-synchronization.ts";
import { parseAgUiEvent } from "#veryfront/events/ag-ui/parser.ts";
import type { AgUiEvent } from "#veryfront/events/ag-ui/types.ts";

export type AgUiNativeProfileFamily =
  | "run"
  | "synchronization"
  | "content"
  | "tool"
  | "reasoning"
  | "invocation"
  | "signal";

export type AgUiNativeProfileRecord =
  | AgUiRunCanonicalEvent
  | AgUiNativeSynchronizationEvent
  | AgUiContentNativeRecord
  | AgUiToolNativeRecord
  | ReturnType<typeof parseNativeReasoningEvent>
  | ReturnType<typeof parseNativeInvocationEvent>
  | ReturnType<typeof parseNativeSignalEvent>;

export type AgUiNativeProfileSupportedEvent =
  | AgUiRunProfileSupportedEvent
  | AgUiSynchronizationSupportedEvent
  | AgUiContentProfileSupportedEvent
  | AgUiToolProfileSupportedEvent
  | AgUiReasoningSupportedEvent
  | AgUiInvocationSupportedEvent
  | AgUiSignalSupportedEvent;

export type AgUiNativeProfileContext =
  | { readonly family: "run"; readonly run: AgUiRunProfileStoredRunContext }
  | {
    readonly family: "synchronization";
    readonly synchronization: { readonly occurrence: AgUiSynchronizationOccurrence };
  }
  | { readonly family: "content"; readonly content: AgUiContentProfileContext }
  | { readonly family: "tool"; readonly tool: AgUiToolProfileContext }
  | { readonly family: "reasoning"; readonly reasoning: AgUiReasoningProjectionContext }
  | { readonly family: "invocation"; readonly invocation: AgUiInvocationProjectionContext }
  | { readonly family: "signal"; readonly signal: AgUiSignalProjectionContext };

export interface ProjectAgUiNativeProfileInput {
  readonly event: unknown;
  readonly context: AgUiNativeProfileContext;
}

export interface ProjectNativeProfileInput {
  readonly event: unknown;
  readonly contentContext?: AgUiContentProfileContext;
  readonly toolContext?: AgUiToolProfileContext;
}

export type AgUiNativeProfileProjectionCommand =
  | {
    readonly kind: "canonical-event";
    readonly family: AgUiNativeProfileFamily;
    readonly event: AgUiNativeProfileRecord;
    readonly protocol?: { readonly agui: JsonObject };
  }
  | {
    readonly kind: "missing-fact-requirement";
    readonly family: AgUiNativeProfileFamily;
    readonly reason: string;
    readonly message: string;
    readonly protocol?: { readonly agui: JsonObject };
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function eventType(input: unknown): string {
  if (!isRecord(input) || typeof input.type !== "string") {
    throw new TypeError("native profile event must be an object with a string type");
  }
  return input.type;
}

function agUiFamily(event: AgUiEvent): AgUiNativeProfileFamily {
  switch (event.type) {
    case "RUN_STARTED":
    case "RUN_FINISHED":
    case "RUN_ERROR":
      return "run";
    case "STATE_SNAPSHOT":
    case "STATE_DELTA":
    case "MESSAGES_SNAPSHOT":
    case "ACTIVITY_SNAPSHOT":
    case "ACTIVITY_DELTA":
      return "synchronization";
    case "TEXT_MESSAGE_START":
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_END":
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_END":
    case "STEP_STARTED":
    case "STEP_FINISHED":
      return "content";
    case "TOOL_CALL_START":
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_END":
    case "TOOL_CALL_RESULT":
      return "tool";
    case "REASONING_START":
    case "REASONING_END":
    case "REASONING_ENCRYPTED_VALUE":
      return "reasoning";
    case "SUBAGENT_STARTED":
    case "SUBAGENT_FINISHED":
    case "SUBAGENT_ERROR":
      return "invocation";
    case "RAW":
    case "CUSTOM":
      return "signal";
    default:
      throw new TypeError(`${event.type} is not a completed AG-UI native profile event family`);
  }
}

function assertContextFamily(
  actual: AgUiNativeProfileFamily,
  expected: AgUiNativeProfileFamily,
): void {
  if (actual !== expected) {
    throw new TypeError(`AG-UI ${actual} event cannot be projected with ${expected} context`);
  }
}

function fromFamilyCommand(
  family: Exclude<AgUiNativeProfileFamily, "synchronization">,
  command:
    | AgUiRunProfileProjectionCommand
    | AgUiContentProjectionCommand
    | AgUiToolProjectionCommand
    | AgUiReasoningProjectionCommand
    | AgUiInvocationProjectionCommand
    | AgUiSignalProjectionCommand,
): AgUiNativeProfileProjectionCommand {
  if (command.kind === "canonical-event") {
    return {
      kind: "canonical-event",
      family,
      event: command.event,
      protocol: command.protocol,
    };
  }
  if (command.kind === "missing-fact-requirement") {
    return {
      kind: "missing-fact-requirement",
      family,
      reason: command.reason,
      message: command.message,
      protocol: command.protocol,
    };
  }
  throw new TypeError("AG-UI profile ingress cannot return a reverse-projection event command");
}

/** Validate a native interoperability record against its family schema. */
export function parseNativeProfileRecord(input: unknown): AgUiNativeProfileRecord {
  const type = eventType(input);
  switch (type) {
    case "com.veryfront.run.started":
    case "com.veryfront.run.succeeded":
    case "com.veryfront.run.cancelled":
    case "com.veryfront.run.failed":
    case "com.veryfront.run.paused":
      return parseNativeRunProfileEvent(input);
    case "com.veryfront.synchronization.state.snapshot.recorded":
    case "com.veryfront.synchronization.state.delta.recorded":
    case "com.veryfront.synchronization.transcript.snapshot.recorded":
    case "com.veryfront.synchronization.activity.snapshot.recorded":
    case "com.veryfront.synchronization.activity.delta.recorded":
      return parseNativeSynchronizationEvent(input);
    case "com.veryfront.message.text.started":
    case "com.veryfront.message.text.delta.emitted":
    case "com.veryfront.message.text.ended":
    case "com.veryfront.message.reasoning.started":
    case "com.veryfront.message.reasoning.delta.emitted":
    case "com.veryfront.message.reasoning.ended":
    case "com.veryfront.step.started":
    case "com.veryfront.step.ended":
      return parseNativeContentRecord(input);
    case "com.veryfront.tool-call.started":
    case "com.veryfront.tool-call.arguments.delta.emitted":
    case "com.veryfront.tool-call.arguments.ended":
    case "com.veryfront.tool-call.result.recorded":
      return parseNativeToolRecord(input);
    case "com.veryfront.reasoning.context.started":
    case "com.veryfront.reasoning.context.ended":
    case "com.veryfront.reasoning.continuation.recorded":
      return parseNativeReasoningEvent(input);
    case "com.veryfront.invocation.started":
    case "com.veryfront.invocation.succeeded":
    case "com.veryfront.invocation.paused":
    case "com.veryfront.invocation.failed":
      return parseNativeInvocationEvent(input);
    case "com.veryfront.signal.raw.recorded":
    case "com.veryfront.signal.custom.recorded":
      return parseNativeSignalEvent(input);
    default:
      throw new TypeError(`${type} is not a completed AG-UI native profile record type`);
  }
}

/** Convert a native interoperability record into its AG-UI event. */
export function projectNativeProfileEvent(
  input: ProjectNativeProfileInput,
): AgUiNativeProfileSupportedEvent {
  const type = eventType(input.event);
  switch (type) {
    case "com.veryfront.run.started":
    case "com.veryfront.run.succeeded":
    case "com.veryfront.run.cancelled":
    case "com.veryfront.run.failed":
    case "com.veryfront.run.paused":
      return projectNativeRunProfileEvent({ event: input.event });
    case "com.veryfront.synchronization.state.snapshot.recorded":
    case "com.veryfront.synchronization.state.delta.recorded":
    case "com.veryfront.synchronization.transcript.snapshot.recorded":
    case "com.veryfront.synchronization.activity.snapshot.recorded":
    case "com.veryfront.synchronization.activity.delta.recorded":
      return projectNativeSynchronizationEvent({ event: input.event });
    case "com.veryfront.message.text.started":
    case "com.veryfront.message.text.delta.emitted":
    case "com.veryfront.message.text.ended":
    case "com.veryfront.message.reasoning.started":
    case "com.veryfront.message.reasoning.delta.emitted":
    case "com.veryfront.message.reasoning.ended":
    case "com.veryfront.step.started":
    case "com.veryfront.step.ended": {
      if (!input.contentContext) {
        throw new TypeError("native content profile projection requires explicit content context");
      }
      const command = projectNativeContentEvent({
        event: input.event,
        context: input.contentContext,
      });
      if (command.kind === "ag-ui-event") return command.event;
      if (command.kind === "missing-fact-requirement") {
        throw new TypeError(command.message);
      }
      throw new TypeError(
        "native content profile produced canonical record during reverse projection",
      );
    }
    case "com.veryfront.tool-call.started":
    case "com.veryfront.tool-call.arguments.delta.emitted":
    case "com.veryfront.tool-call.arguments.ended":
    case "com.veryfront.tool-call.result.recorded": {
      if (!input.toolContext) {
        throw new TypeError("native tool profile projection requires explicit tool context");
      }
      const command = projectNativeToolEvent({
        event: input.event,
        context: input.toolContext,
      });
      if (command.kind === "ag-ui-event") return command.event;
      if (command.kind === "missing-fact-requirement") {
        throw new TypeError(command.message);
      }
      throw new TypeError(
        "native tool profile produced canonical record during reverse projection",
      );
    }
    case "com.veryfront.reasoning.context.started":
    case "com.veryfront.reasoning.context.ended":
    case "com.veryfront.reasoning.continuation.recorded":
      return projectNativeReasoningEvent({ event: input.event });
    case "com.veryfront.invocation.started":
    case "com.veryfront.invocation.succeeded":
    case "com.veryfront.invocation.paused":
    case "com.veryfront.invocation.failed":
      return projectNativeInvocationEvent({ event: input.event });
    case "com.veryfront.signal.raw.recorded":
    case "com.veryfront.signal.custom.recorded":
      return projectNativeSignalEvent({ event: input.event });
    default:
      throw new TypeError(`${type} is not a completed AG-UI native profile record type`);
  }
}

/** Map an AG-UI event to a native record with explicit occurrence and ownership context. */
export function projectAgUiNativeProfileEvent(
  input: ProjectAgUiNativeProfileInput,
): AgUiNativeProfileProjectionCommand {
  const event = parseAgUiEvent(input.event);
  const family = agUiFamily(event);
  assertContextFamily(family, input.context.family);
  switch (input.context.family) {
    case "run":
      return fromFamilyCommand(
        "run",
        projectAgUiRunProfileEvent({ event, context: input.context.run }),
      );
    case "synchronization":
      return {
        kind: "canonical-event",
        family: "synchronization",
        event: projectAgUiSynchronizationEvent({
          event,
          occurrence: input.context.synchronization.occurrence,
        }),
      };
    case "content":
      return fromFamilyCommand(
        "content",
        projectAgUiContentEvent({ event, context: input.context.content }),
      );
    case "tool":
      return fromFamilyCommand(
        "tool",
        projectAgUiToolEvent({ event, context: input.context.tool }),
      );
    case "reasoning":
      return fromFamilyCommand(
        "reasoning",
        projectAgUiReasoningEvent({ event, context: input.context.reasoning }),
      );
    case "invocation":
      return fromFamilyCommand(
        "invocation",
        projectAgUiInvocationEvent({ event, context: input.context.invocation }),
      );
    case "signal":
      return fromFamilyCommand(
        "signal",
        projectAgUiSignalEvent({ event, context: input.context.signal }),
      );
  }
}

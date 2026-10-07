import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  aguiBase,
  baseProtocolMetadata,
  isRecord,
  nativeContextFields,
  nativeOccurrenceFields,
  optionalString,
  requireLiteral,
  requireRecord,
  requireString,
  requireStringValue,
  toJsonObject,
} from "#veryfront/events/ag-ui/native-profile-helpers.ts";
import { parseEvent } from "#veryfront/events/parser.ts";
import type { Extensions } from "#veryfront/events/payload-types.generated.ts";
import type { EventRecord, JsonObject } from "#veryfront/events/types.ts";
import { EVENT_SCHEMA_BY_TYPE } from "#veryfront/events/types.ts";
import {
  AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA,
  AG_UI_NATIVE_RUN_PAUSED_TYPE,
  AG_UI_PROTOCOL_EXTENSION_URI,
  parseNativeRunPausedRecord,
} from "#veryfront/events/ag-ui/native-run-paused.ts";
import type {
  AgUiNativeRunPausedRecord,
  AgUiNativeRunPausedType,
} from "#veryfront/events/ag-ui/native-run-paused.ts";
import { parseAgUiEvent, safeParseAgUiEvent } from "#veryfront/events/ag-ui/parser.ts";
import type { AgUiEventOf } from "#veryfront/events/ag-ui/types.ts";

const AG_UI_PROTOCOL_NAME = "ag-ui";
const AG_UI_PROTOCOL_VERSION = "1.0";

export type AgUiRunCoreCanonicalEventType =
  | "com.veryfront.run.started"
  | "com.veryfront.run.succeeded"
  | "com.veryfront.run.failed"
  | "com.veryfront.run.cancelled";

export type AgUiRunCanonicalEventType = AgUiRunCoreCanonicalEventType | AgUiNativeRunPausedType;

export type AgUiRunCanonicalEvent =
  | EventRecord<AgUiRunCoreCanonicalEventType>
  | AgUiNativeRunPausedRecord;

export type AgUiRunProfileSupportedEvent =
  | AgUiEventOf<"RUN_STARTED">
  | AgUiEventOf<"RUN_FINISHED">
  | AgUiEventOf<"RUN_ERROR">;

export interface AgUiRunProfileOccurrence {
  readonly source: string;
  readonly id: string;
  readonly time?: string;
  readonly recordedat?: string;
}

export interface AgUiRunProfileStoredRunContext {
  readonly occurrence: AgUiRunProfileOccurrence;
  readonly runid: string;
  readonly agui: {
    readonly threadId: string;
    readonly runId: string;
  };
  readonly runkind?: "agent" | "workflow" | "task";
  readonly conversationid?: string;
  readonly subject?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
  readonly cancellationReason?: string;
}

export interface AgUiGeneratedRunProfileFrame {
  readonly kind: "generated-read-frame";
  readonly event: AgUiRunProfileSupportedEvent;
  readonly protocol: {
    readonly agui: JsonObject;
  };
}

export interface ProjectAgUiRunProfileInput {
  readonly event: unknown;
  readonly context: AgUiRunProfileStoredRunContext;
}

export interface ProjectNativeRunProfileInput {
  readonly event: unknown;
}

export type AgUiRunProfileProjectionCommand =
  | {
    readonly kind: "canonical-event";
    readonly event: AgUiRunCanonicalEvent;
    readonly protocol: {
      readonly agui: JsonObject;
    };
  }
  | {
    readonly kind: "missing-fact-requirement";
    readonly reason: "context-conflict" | "non-json-protocol-metadata";
    readonly message: string;
    readonly protocol?: {
      readonly agui: JsonObject;
    };
  };

const RUN_STARTED_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "threadId",
  "runId",
  "protocolVersion",
  "parentRunId",
  "input",
]);
const RUN_FINISHED_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "threadId",
  "runId",
  "result",
  "outcome",
  "usage",
]);
const RUN_ERROR_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "message",
  "code",
  "usage",
]);

function supportedAgUiEvent(input: unknown): AgUiRunProfileSupportedEvent {
  const event = parseAgUiEvent(input);
  switch (event.type) {
    case "RUN_STARTED":
    case "RUN_FINISHED":
    case "RUN_ERROR":
      return event;
    default:
      throw new TypeError(`${event.type} is not an AG-UI run lifecycle event`);
  }
}

function protocolMetadata(event: AgUiRunProfileSupportedEvent): JsonObject | undefined {
  switch (event.type) {
    case "RUN_STARTED":
      return toJsonObject({
        ...baseProtocolMetadata(event, RUN_STARTED_FIELDS),
        run: {
          threadId: event.threadId,
          runId: event.runId,
          ...(event.protocolVersion === undefined
            ? {}
            : { protocolVersion: event.protocolVersion }),
          ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
          ...(event.input === undefined ? {} : { input: event.input }),
        },
      });
    case "RUN_FINISHED":
      return toJsonObject({
        ...baseProtocolMetadata(event, RUN_FINISHED_FIELDS),
        run: {
          threadId: event.threadId,
          runId: event.runId,
          ...(event.result === undefined ? {} : { result: event.result }),
        },
        ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
        ...(event.usage === undefined ? {} : { usage: event.usage }),
      });
    case "RUN_ERROR":
      return toJsonObject({
        ...baseProtocolMetadata(event, RUN_ERROR_FIELDS),
        error: {
          message: event.message,
          ...(event.code === undefined ? {} : { code: event.code }),
        },
        ...(event.usage === undefined ? {} : { usage: event.usage }),
      });
  }
}

function validateStoredRunContext(
  context: AgUiRunProfileStoredRunContext,
): AgUiRunProfileStoredRunContext {
  requireString(context.occurrence.source, "run profile occurrence source");
  requireString(context.occurrence.id, "run profile occurrence id");
  optionalString(context.occurrence.time, "run profile occurrence time");
  optionalString(context.occurrence.recordedat, "run profile occurrence recordedat");
  requireString(context.runid, "run profile runid");
  requireStringValue(context.agui.threadId, "run profile AG-UI threadId");
  requireStringValue(context.agui.runId, "run profile AG-UI runId");
  optionalString(context.conversationid, "run profile conversationid");
  optionalString(context.subject, "run profile subject");
  optionalString(context.traceparent, "run profile traceparent");
  optionalString(context.tracestate, "run profile tracestate");
  optionalString(context.cancellationReason, "run profile cancellationReason");
  return context;
}

function contextConflict(
  event: Extract<
    AgUiRunProfileSupportedEvent,
    { readonly threadId: string; readonly runId: string }
  >,
  context: AgUiRunProfileStoredRunContext,
): AgUiRunProfileProjectionCommand | undefined {
  if (event.threadId !== context.agui.threadId) {
    return {
      kind: "missing-fact-requirement",
      reason: "context-conflict",
      message:
        `AG-UI threadId ${event.threadId} does not match explicit context threadId ${context.agui.threadId}.`,
    };
  }
  if (event.runId !== context.agui.runId) {
    return {
      kind: "missing-fact-requirement",
      reason: "context-conflict",
      message:
        `AG-UI runId ${event.runId} does not match explicit context runId ${context.agui.runId}.`,
    };
  }
  return undefined;
}

function canonicalEnvelope<TType extends AgUiRunCoreCanonicalEventType>(
  context: AgUiRunProfileStoredRunContext,
  type: TType,
  data: EventRecord<TType>["data"],
): EventRecord<AgUiRunCoreCanonicalEventType> {
  const candidate = {
    specversion: "1.0",
    id: context.occurrence.id,
    source: context.occurrence.source,
    type,
    datacontenttype: "application/json",
    dataschema: EVENT_SCHEMA_BY_TYPE[type],
    data,
    runid: context.runid,
    ...(context.occurrence.time === undefined ? {} : { time: context.occurrence.time }),
    ...(context.occurrence.recordedat === undefined
      ? {}
      : { recordedat: context.occurrence.recordedat }),
    ...nativeContextFields(context),
  };
  const parsed = parseEvent(candidate);
  if (parsed.type !== type) {
    throw new TypeError(`validated event type ${parsed.type} did not match ${type}`);
  }
  return parsed;
}

function extensionPayload(protocol: JsonObject): { readonly extensions: Extensions } {
  return { extensions: { [AG_UI_PROTOCOL_EXTENSION_URI]: protocol } };
}

function pausedEnvelope(
  context: AgUiRunProfileStoredRunContext,
  event: Extract<AgUiRunProfileSupportedEvent, { readonly type: "RUN_FINISHED" }>,
  protocol: JsonObject,
): AgUiNativeRunPausedRecord {
  if (event.outcome?.type !== "interrupt") {
    throw new TypeError("run.paused requires AG-UI RUN_FINISHED interrupt outcome metadata");
  }
  return parseNativeRunPausedRecord({
    specversion: "1.0",
    id: context.occurrence.id,
    source: context.occurrence.source,
    type: AG_UI_NATIVE_RUN_PAUSED_TYPE,
    datacontenttype: "application/json",
    dataschema: AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA,
    data: {
      pause: { interrupts: event.outcome.interrupts },
      extensions: { [AG_UI_PROTOCOL_EXTENSION_URI]: protocol },
    },
    runid: context.runid,
    ...(context.occurrence.time === undefined ? {} : { time: context.occurrence.time }),
    ...(context.occurrence.recordedat === undefined
      ? {}
      : { recordedat: context.occurrence.recordedat }),
    ...nativeContextFields(context),
  });
}

function canonicalCommand<TType extends AgUiRunCoreCanonicalEventType>(
  context: AgUiRunProfileStoredRunContext,
  type: TType,
  data: EventRecord<TType>["data"],
  protocol: JsonObject,
): AgUiRunProfileProjectionCommand {
  return {
    kind: "canonical-event",
    event: canonicalEnvelope(context, type, data),
    protocol: { agui: protocol },
  };
}

function pausedCommand(
  context: AgUiRunProfileStoredRunContext,
  event: Extract<AgUiRunProfileSupportedEvent, { readonly type: "RUN_FINISHED" }>,
  protocol: JsonObject,
): AgUiRunProfileProjectionCommand {
  return {
    kind: "canonical-event",
    event: pausedEnvelope(context, event, protocol),
    protocol: { agui: protocol },
  };
}

function nonJsonRequirement(): AgUiRunProfileProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    reason: "non-json-protocol-metadata",
    message:
      "AG-UI run lifecycle metadata contains a value that cannot be preserved inside the JSON target payload extension.",
  };
}

function nonJsonRunProfileInputRequirement(
  input: unknown,
): AgUiRunProfileProjectionCommand | undefined {
  if (!isRecord(input)) return undefined;
  const typeDescriptor = Reflect.getOwnPropertyDescriptor(input, "type");
  if (!typeDescriptor || !("value" in typeDescriptor)) return undefined;
  if (
    typeDescriptor.value !== "RUN_STARTED" && typeDescriptor.value !== "RUN_FINISHED" &&
    typeDescriptor.value !== "RUN_ERROR"
  ) {
    return undefined;
  }
  const snapshot = snapshotBoundedJsonValue(input);
  return snapshot.success ? undefined : nonJsonRequirement();
}

export function projectAgUiRunProfileEvent(
  input: ProjectAgUiRunProfileInput,
): AgUiRunProfileProjectionCommand {
  let event: AgUiRunProfileSupportedEvent;
  try {
    event = supportedAgUiEvent(input.event);
  } catch (error) {
    const requirement = nonJsonRunProfileInputRequirement(input.event);
    if (requirement) return requirement;
    throw error;
  }
  const context = validateStoredRunContext(input.context);
  const protocol = protocolMetadata(event);
  if (protocol === undefined) return nonJsonRequirement();

  switch (event.type) {
    case "RUN_STARTED": {
      const conflict = contextConflict(event, context);
      if (conflict) return conflict;
      return canonicalCommand(
        context,
        "com.veryfront.run.started",
        extensionPayload(protocol),
        protocol,
      );
    }
    case "RUN_FINISHED": {
      const conflict = contextConflict(event, context);
      if (conflict) return conflict;
      if (event.outcome?.type === "interrupt") {
        return pausedCommand(context, event, protocol);
      }
      if (event.outcome?.type === "cancelled") {
        return canonicalCommand(
          context,
          "com.veryfront.run.cancelled",
          {
            ...(context.cancellationReason === undefined
              ? {}
              : { reason: context.cancellationReason }),
            ...extensionPayload(protocol),
          },
          protocol,
        );
      }
      return canonicalCommand(
        context,
        "com.veryfront.run.succeeded",
        extensionPayload(protocol),
        protocol,
      );
    }
    case "RUN_ERROR": {
      return canonicalCommand(
        context,
        "com.veryfront.run.failed",
        {
          error: {
            message: event.message,
            ...(event.code === undefined ? {} : { code: event.code }),
          },
          ...extensionPayload(protocol),
        },
        protocol,
      );
    }
  }
}

function protocolFromNative(event: AgUiRunCanonicalEvent): JsonObject {
  const extensions = event.data.extensions;
  if (extensions === undefined) {
    throw new TypeError("canonical run event is missing AG-UI protocol extension");
  }
  const protocol = extensions[AG_UI_PROTOCOL_EXTENSION_URI];
  if (protocol === undefined) {
    throw new TypeError("canonical run event is missing AG-UI run lifecycle protocol metadata");
  }
  const jsonProtocol = toJsonObject(protocol);
  if (jsonProtocol === undefined) {
    throw new TypeError("canonical run event has non-JSON AG-UI run lifecycle protocol metadata");
  }
  return jsonProtocol;
}

function protocolRecord(protocol: JsonObject): Record<string, unknown> {
  return protocol;
}

function requireProtocolHeader(
  protocol: JsonObject,
  eventType: AgUiRunProfileSupportedEvent["type"],
): Record<string, unknown> {
  const record = protocolRecord(protocol);
  requireLiteral(record.name, AG_UI_PROTOCOL_NAME, "protocol.agui.name");
  requireLiteral(record.version, AG_UI_PROTOCOL_VERSION, "protocol.agui.version");
  requireLiteral(record.eventType, eventType, "protocol.agui.eventType");
  return record;
}

function projectedStarted(protocol: JsonObject): AgUiRunProfileSupportedEvent {
  const record = requireProtocolHeader(protocol, "RUN_STARTED");
  const run = requireRecord(record.run, "protocol.agui.run");
  return validateProjectedAgUi({
    ...aguiBase(record, RUN_STARTED_FIELDS),
    type: "RUN_STARTED",
    threadId: run.threadId,
    runId: run.runId,
    ...(run.protocolVersion === undefined ? {} : { protocolVersion: run.protocolVersion }),
    ...(run.parentRunId === undefined ? {} : { parentRunId: run.parentRunId }),
    ...(run.input === undefined ? {} : { input: run.input }),
  });
}

function projectedFinished(
  protocol: JsonObject,
  nativeType:
    | "com.veryfront.run.succeeded"
    | "com.veryfront.run.cancelled"
    | AgUiNativeRunPausedType,
): AgUiRunProfileSupportedEvent {
  const record = requireProtocolHeader(protocol, "RUN_FINISHED");
  const run = requireRecord(record.run, "protocol.agui.run");
  const candidate = validateProjectedAgUi({
    ...aguiBase(record, RUN_FINISHED_FIELDS),
    type: "RUN_FINISHED",
    threadId: run.threadId,
    runId: run.runId,
    ...(run.result === undefined ? {} : { result: run.result }),
    ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
    ...(record.usage === undefined ? {} : { usage: record.usage }),
  });
  if (candidate.type !== "RUN_FINISHED") {
    throw new TypeError("protocol.agui.eventType did not produce RUN_FINISHED");
  }
  if (nativeType === "com.veryfront.run.cancelled") {
    if (candidate.outcome?.type !== "cancelled") {
      throw new TypeError("run.cancelled requires AG-UI RUN_FINISHED cancelled outcome metadata");
    }
    return candidate;
  }
  if (nativeType === AG_UI_NATIVE_RUN_PAUSED_TYPE) {
    if (candidate.outcome?.type !== "interrupt") {
      throw new TypeError("run.paused requires AG-UI RUN_FINISHED interrupt outcome metadata");
    }
    return candidate;
  }
  if (candidate.outcome?.type === "cancelled" || candidate.outcome?.type === "interrupt") {
    throw new TypeError("run.succeeded cannot carry cancelled or interrupt AG-UI outcome metadata");
  }
  return candidate;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

function jsonStable(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

function assertPausedPayloadMatchesProtocol(
  event: AgUiNativeRunPausedRecord,
  agui: AgUiRunProfileSupportedEvent,
): void {
  if (agui.type !== "RUN_FINISHED" || agui.outcome?.type !== "interrupt") {
    throw new TypeError("run.paused requires AG-UI RUN_FINISHED interrupt outcome metadata");
  }
  if (jsonStable(event.data.pause.interrupts) !== jsonStable(agui.outcome.interrupts)) {
    throw new TypeError("run.paused interrupt payload does not match AG-UI outcome metadata");
  }
}

function assertFailedPayloadMatchesProtocol(
  event: EventRecord<"com.veryfront.run.failed">,
  agui: AgUiRunProfileSupportedEvent,
): void {
  if (agui.type !== "RUN_ERROR") {
    throw new TypeError("run.failed requires AG-UI RUN_ERROR protocol metadata");
  }
  if (
    event.data.error?.message !== agui.message ||
    event.data.error.code !== agui.code
  ) {
    throw new TypeError(
      "run.failed error payload does not match AG-UI RUN_ERROR protocol metadata",
    );
  }
}

function projectedError(protocol: JsonObject): AgUiRunProfileSupportedEvent {
  const record = requireProtocolHeader(protocol, "RUN_ERROR");
  const error = requireRecord(record.error, "protocol.agui.error");
  return validateProjectedAgUi({
    ...aguiBase(record, RUN_ERROR_FIELDS),
    type: "RUN_ERROR",
    message: error.message,
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(record.usage === undefined ? {} : { usage: record.usage }),
  });
}

function validateProjectedAgUi(event: Record<string, unknown>): AgUiRunProfileSupportedEvent {
  const result = safeParseAgUiEvent(event);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid AG-UI run profile event");
  }
  return supportedAgUiEvent(result.data);
}

function canonicalRunEvent(input: unknown): AgUiRunCanonicalEvent {
  if (isRecord(input) && input.type === AG_UI_NATIVE_RUN_PAUSED_TYPE) {
    return parseNativeRunPausedRecord(input);
  }
  const parsed = parseEvent(input);
  switch (parsed.type) {
    case "com.veryfront.run.started":
    case "com.veryfront.run.succeeded":
    case "com.veryfront.run.failed":
    case "com.veryfront.run.cancelled":
      return parsed;
    default:
      throw new TypeError(`${parsed.type} is not a canonical run lifecycle event`);
  }
}

export function parseNativeRunProfileEvent(input: unknown): AgUiRunCanonicalEvent {
  const event = canonicalRunEvent(input);
  const protocol = protocolFromNative(event);
  const agui = projectNativeRunProfileEvent({ event });
  if (event.type === "com.veryfront.run.failed") return event;
  if (event.type === AG_UI_NATIVE_RUN_PAUSED_TYPE) {
    assertPausedPayloadMatchesProtocol(event, agui);
  }
  const projected = projectAgUiRunProfileEvent({
    event: agui,
    context: {
      occurrence: nativeOccurrenceFields(event),
      runid: event.runid,
      agui: protocolAgUiIdentity(protocol),
      ...nativeContextFields(event),
      ...(event.type === "com.veryfront.run.cancelled" && event.data.reason !== undefined
        ? { cancellationReason: event.data.reason }
        : {}),
    },
  });
  if (projected.kind !== "canonical-event") {
    throw new TypeError(projected.message);
  }
  if (projected.event.type !== event.type) {
    throw new TypeError(`${event.type} does not match AG-UI protocol metadata`);
  }
  return event;
}

function protocolAgUiIdentity(
  protocol: JsonObject,
): { readonly threadId: string; readonly runId: string } {
  const record = protocolRecord(protocol);
  const run = requireRecord(record.run, "protocol.agui.run");
  return {
    threadId: requireStringValue(run.threadId, "protocol.agui.run.threadId"),
    runId: requireStringValue(run.runId, "protocol.agui.run.runId"),
  };
}

export function projectNativeRunProfileEvent(
  input: ProjectNativeRunProfileInput,
): AgUiRunProfileSupportedEvent {
  const event = canonicalRunEvent(input.event);
  const protocol = protocolFromNative(event);
  switch (event.type) {
    case "com.veryfront.run.started":
      return projectedStarted(protocol);
    case "com.veryfront.run.succeeded":
      return projectedFinished(protocol, "com.veryfront.run.succeeded");
    case "com.veryfront.run.cancelled":
      return projectedFinished(protocol, "com.veryfront.run.cancelled");
    case AG_UI_NATIVE_RUN_PAUSED_TYPE: {
      const agui = projectedFinished(protocol, AG_UI_NATIVE_RUN_PAUSED_TYPE);
      assertPausedPayloadMatchesProtocol(event, agui);
      return agui;
    }
    case "com.veryfront.run.failed": {
      const agui = projectedError(protocol);
      assertFailedPayloadMatchesProtocol(event, agui);
      return agui;
    }
  }
}

export function createGeneratedRunProfileFrame(event: unknown): AgUiGeneratedRunProfileFrame {
  const agui = supportedAgUiEvent(event);
  const protocol = protocolMetadata(agui);
  if (protocol === undefined) {
    throw new TypeError(
      "AG-UI run lifecycle metadata contains a value that cannot be preserved inside JSON.",
    );
  }
  return {
    kind: "generated-read-frame",
    event: agui,
    protocol: { agui: protocol },
  };
}

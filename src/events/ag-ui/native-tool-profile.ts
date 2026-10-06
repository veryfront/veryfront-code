import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  aguiBase,
  optionalString,
  protocolMetadataFields,
  requireLiteral,
  requireRecord,
  requireString,
  requireStringValue,
  toJsonObject,
} from "#veryfront/events/ag-ui/native-profile-helpers.ts";
import { parseEvent } from "#veryfront/events/parser.ts";
import type { Extensions } from "#veryfront/events/payload-types.generated.ts";
import type { EventRecord, JsonObject, JsonValue } from "#veryfront/events/types.ts";
import { EVENT_SCHEMA_BY_TYPE } from "#veryfront/events/types.ts";
import { parseAgUiEvent, safeParseAgUiEvent } from "#veryfront/events/ag-ui/parser.ts";
import { AG_UI_PROTOCOL_VERSION } from "#veryfront/events/ag-ui/schema.ts";
import type { AgUiEventOf, AgUiProducerOccurrence } from "#veryfront/events/ag-ui/types.ts";

const AG_UI_PROTOCOL_NAME = "ag-ui";
export const AG_UI_TOOL_PROTOCOL_EXTENSION_URI = "urn:veryfront:ag-ui:protocol:tool:1";

export type AgUiToolProfileSupportedEvent =
  | AgUiEventOf<"TOOL_CALL_START">
  | AgUiEventOf<"TOOL_CALL_ARGS">
  | AgUiEventOf<"TOOL_CALL_END">
  | AgUiEventOf<"TOOL_CALL_RESULT">;

export type AgUiToolNativeType =
  | "com.veryfront.tool-call.started"
  | "com.veryfront.tool-call.arguments.delta.emitted"
  | "com.veryfront.tool-call.arguments.ended"
  | "com.veryfront.tool-call.result.recorded";

export type AgUiToolNativeRecord = EventRecord<AgUiToolNativeType>;

export interface AgUiToolOccurrence {
  readonly source: string;
  readonly id: string;
  readonly time?: string;
  readonly recordedat?: string;
}

export interface AgUiToolCallMapping {
  readonly nativeToolCallId: string;
  readonly nativeToolName: string;
  readonly agUiToolCallId: string;
  readonly agUiToolCallName: string;
}

export interface AgUiToolMessageMapping {
  readonly nativeMessageId: string;
  readonly agUiMessageId: string;
}

export type AgUiToolProfileContext =
  | {
    readonly kind: "call";
    readonly occurrence: AgUiToolOccurrence;
    readonly tool: AgUiToolCallMapping;
    readonly parent?: AgUiToolMessageMapping;
  }
  | {
    readonly kind: "result";
    readonly occurrence: AgUiToolOccurrence;
    readonly tool: AgUiToolCallMapping;
    readonly resultMessage: AgUiToolMessageMapping;
    readonly parent?: AgUiToolMessageMapping;
  };

export interface ProjectAgUiToolInput {
  readonly event: unknown;
  readonly context: AgUiToolProfileContext;
}

export interface ProjectNativeToolInput {
  readonly event: unknown;
  readonly context: AgUiToolProfileContext;
}

export type AgUiToolProjectionCommand =
  | {
    readonly kind: "canonical-event";
    readonly event: AgUiToolNativeRecord;
    readonly protocol?: { readonly agui: JsonObject };
  }
  | {
    readonly kind: "ag-ui-event";
    readonly producerOccurrence: AgUiProducerOccurrence;
    readonly event: AgUiToolProfileSupportedEvent;
  }
  | {
    readonly kind: "missing-fact-requirement";
    readonly reason:
      | "non-json-protocol-metadata"
      | "missing-protocol-identity"
      | "redacted-output"
      | "error-result";
    readonly message: string;
    readonly protocol?: { readonly agui: JsonObject };
  };

const START_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "toolCallId",
  "toolCallName",
  "parentMessageId",
]);
const ARGS_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "toolCallId",
  "delta",
]);
const END_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "toolCallId",
]);
const RESULT_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "toolCallId",
  "content",
  "role",
]);

function toJsonValue(value: unknown): JsonValue | undefined {
  const snapshot = snapshotBoundedJsonValue(value);
  return snapshot.success ? snapshot.value : undefined;
}

function validateContext(context: AgUiToolProfileContext): AgUiToolProfileContext {
  requireString(context.occurrence.source, "tool occurrence source");
  requireString(context.occurrence.id, "tool occurrence id");
  optionalString(context.occurrence.time, "tool occurrence time");
  optionalString(context.occurrence.recordedat, "tool occurrence recordedat");
  requireString(context.tool.nativeToolCallId, "nativeToolCallId");
  requireString(context.tool.nativeToolName, "nativeToolName");
  requireStringValue(context.tool.agUiToolCallId, "agUiToolCallId");
  requireStringValue(context.tool.agUiToolCallName, "agUiToolCallName");
  if (context.parent) {
    requireString(context.parent.nativeMessageId, "parent nativeMessageId");
    requireStringValue(context.parent.agUiMessageId, "parent agUiMessageId");
  }
  if (context.kind === "result") {
    requireString(context.resultMessage.nativeMessageId, "result nativeMessageId");
    requireStringValue(context.resultMessage.agUiMessageId, "result agUiMessageId");
  }
  return context;
}

function supportedAgUiEvent(input: unknown): AgUiToolProfileSupportedEvent {
  const event = parseAgUiEvent(input);
  switch (event.type) {
    case "TOOL_CALL_START":
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_END":
    case "TOOL_CALL_RESULT":
      return event;
    default:
      throw new TypeError(`${event.type} is not an AG-UI tool profile event`);
  }
}

function validateAgUiToolMapping(
  event: AgUiToolProfileSupportedEvent,
  context: AgUiToolProfileContext,
) {
  if (event.toolCallId !== context.tool.agUiToolCallId) {
    throw new TypeError("AG-UI toolCallId must match persisted mapping");
  }
  if (event.type === "TOOL_CALL_START") {
    if (event.toolCallName !== context.tool.agUiToolCallName) {
      throw new TypeError("AG-UI toolCallName must match persisted mapping");
    }
    if (
      event.parentMessageId !== undefined && event.parentMessageId !== context.parent?.agUiMessageId
    ) {
      throw new TypeError("AG-UI parentMessageId must match persisted mapping");
    }
  }
  if (event.type === "TOOL_CALL_RESULT") {
    if (context.kind !== "result") {
      throw new TypeError("TOOL_CALL_RESULT requires persisted result message context");
    }
    if (event.messageId !== context.resultMessage.agUiMessageId) {
      throw new TypeError("AG-UI result messageId must match persisted mapping");
    }
  }
}

function identityMetadata(event: AgUiToolProfileSupportedEvent): JsonObject {
  const identity: Record<string, string> = {
    toolCallId: event.toolCallId,
  };
  if (event.type === "TOOL_CALL_START") {
    identity.toolCallName = event.toolCallName;
    if (event.parentMessageId !== undefined) identity.parentMessageId = event.parentMessageId;
  }
  if (event.type === "TOOL_CALL_RESULT") {
    identity.messageId = event.messageId;
    if (event.role !== undefined) identity.role = event.role;
  }
  return identity;
}

function baseProtocolMetadata(
  event: AgUiToolProfileSupportedEvent,
  knownFields: ReadonlySet<string>,
): JsonObject | undefined {
  return toJsonObject({
    name: AG_UI_PROTOCOL_NAME,
    version: AG_UI_PROTOCOL_VERSION,
    eventType: event.type,
    identity: identityMetadata(event),
    ...protocolMetadataFields(event, knownFields),
  });
}

function protocolMetadata(event: AgUiToolProfileSupportedEvent): JsonObject | undefined {
  switch (event.type) {
    case "TOOL_CALL_START":
      return baseProtocolMetadata(event, START_FIELDS);
    case "TOOL_CALL_ARGS":
      return baseProtocolMetadata(event, ARGS_FIELDS);
    case "TOOL_CALL_END":
      return baseProtocolMetadata(event, END_FIELDS);
    case "TOOL_CALL_RESULT":
      return baseProtocolMetadata(event, RESULT_FIELDS);
  }
}

function protocolExtensions(protocol: JsonObject): { readonly extensions: Extensions } {
  return { extensions: { [AG_UI_TOOL_PROTOCOL_EXTENSION_URI]: protocol } };
}

const AG_UI_TOOL_TYPE_BY_NATIVE = {
  "com.veryfront.tool-call.started": "TOOL_CALL_START",
  "com.veryfront.tool-call.arguments.delta.emitted": "TOOL_CALL_ARGS",
  "com.veryfront.tool-call.arguments.ended": "TOOL_CALL_END",
  "com.veryfront.tool-call.result.recorded": "TOOL_CALL_RESULT",
} satisfies Record<AgUiToolNativeType, AgUiToolProfileSupportedEvent["type"]>;

export function parseNativeToolRecord(input: unknown): AgUiToolNativeRecord {
  const parsed = parseEvent(input);
  switch (parsed.type) {
    case "com.veryfront.tool-call.started":
    case "com.veryfront.tool-call.arguments.delta.emitted":
    case "com.veryfront.tool-call.arguments.ended":
    case "com.veryfront.tool-call.result.recorded":
      requireProtocolHeader(protocolFromNative(parsed), AG_UI_TOOL_TYPE_BY_NATIVE[parsed.type]);
      return parsed;
    default:
      throw new TypeError(`${parsed.type} is not an AG-UI native tool profile event`);
  }
}

function recordEnvelope(
  context: AgUiToolProfileContext,
  type: AgUiToolNativeType,
  data: unknown,
): AgUiToolNativeRecord {
  const candidate = {
    specversion: "1.0",
    id: context.occurrence.id,
    source: context.occurrence.source,
    type,
    datacontenttype: "application/json",
    dataschema: EVENT_SCHEMA_BY_TYPE[type],
    data,
    ...(context.occurrence.time === undefined ? {} : { time: context.occurrence.time }),
    ...(context.occurrence.recordedat === undefined
      ? {}
      : { recordedat: context.occurrence.recordedat }),
  };
  const parsed = parseNativeToolRecord(candidate);
  if (parsed.type !== type) {
    throw new TypeError(`validated tool type ${parsed.type} did not match ${type}`);
  }
  return parsed;
}

function nonJsonRequirement(): AgUiToolProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    reason: "non-json-protocol-metadata",
    message:
      "AG-UI tool metadata contains a value that cannot be preserved inside native tool protocol metadata.",
  };
}

function canonicalCommand(
  event: AgUiToolNativeRecord,
  protocol: JsonObject,
): AgUiToolProjectionCommand {
  return { kind: "canonical-event", event, protocol: { agui: protocol } };
}

export function projectAgUiToolEvent(input: ProjectAgUiToolInput): AgUiToolProjectionCommand {
  const event = supportedAgUiEvent(input.event);
  const context = validateContext(input.context);
  validateAgUiToolMapping(event, context);
  const protocol = protocolMetadata(event);
  if (protocol === undefined) return nonJsonRequirement();
  switch (event.type) {
    case "TOOL_CALL_START":
      return canonicalCommand(
        recordEnvelope(context, "com.veryfront.tool-call.started", {
          toolCallId: context.tool.nativeToolCallId,
          toolName: context.tool.nativeToolName,
          ...(event.parentMessageId === undefined
            ? {}
            : { messageId: context.parent?.nativeMessageId }),
          ...protocolExtensions(protocol),
        }),
        protocol,
      );
    case "TOOL_CALL_ARGS":
      return canonicalCommand(
        recordEnvelope(context, "com.veryfront.tool-call.arguments.delta.emitted", {
          toolCallId: context.tool.nativeToolCallId,
          delta: event.delta,
          ...protocolExtensions(protocol),
        }),
        protocol,
      );
    case "TOOL_CALL_END":
      return canonicalCommand(
        recordEnvelope(context, "com.veryfront.tool-call.arguments.ended", {
          toolCallId: context.tool.nativeToolCallId,
          ...protocolExtensions(protocol),
        }),
        protocol,
      );
    case "TOOL_CALL_RESULT": {
      const output = toJsonValue(event.content);
      if (output === undefined) return nonJsonRequirement();
      return canonicalCommand(
        recordEnvelope(context, "com.veryfront.tool-call.result.recorded", {
          toolCallId: context.tool.nativeToolCallId,
          output,
          ...protocolExtensions(protocol),
        }),
        protocol,
      );
    }
  }
}

function validateRecordOccurrence(
  context: AgUiToolProfileContext,
  event: AgUiToolNativeRecord,
): void {
  if (context.occurrence.source !== event.source || context.occurrence.id !== event.id) {
    throw new TypeError("native tool record source/id must match persisted mapping occurrence");
  }
}

function protocolFromNative(event: AgUiToolNativeRecord): JsonObject | undefined {
  const extensions = event.data.extensions;
  if (extensions === undefined) return undefined;
  const protocol = extensions[AG_UI_TOOL_PROTOCOL_EXTENSION_URI];
  if (protocol === undefined) return undefined;
  const jsonProtocol = toJsonObject(protocol);
  if (jsonProtocol === undefined) {
    throw new TypeError("native tool event has non-JSON AG-UI protocol metadata");
  }
  return jsonProtocol;
}

function requireProtocolHeader(
  protocol: JsonObject | undefined,
  eventType: AgUiToolProfileSupportedEvent["type"],
): Record<string, unknown> | undefined {
  if (protocol === undefined) return undefined;
  requireLiteral(protocol.name, AG_UI_PROTOCOL_NAME, "protocol.agui.name");
  requireLiteral(protocol.version, AG_UI_PROTOCOL_VERSION, "protocol.agui.version");
  requireLiteral(protocol.eventType, eventType, "protocol.agui.eventType");
  return protocol;
}

function protocolIdentity(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (record === undefined) return undefined;
  const identity = record.identity;
  if (identity === undefined) return undefined;
  return requireRecord(identity, "protocol.agui.identity");
}

function missingIdentity(
  message: string,
  protocol: JsonObject | undefined,
): AgUiToolProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    reason: "missing-protocol-identity",
    message,
    ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
  };
}

function validateCommonIdentity(
  record: Record<string, unknown> | undefined,
  context: AgUiToolProfileContext,
): boolean {
  const identity = protocolIdentity(record);
  if (identity === undefined) return false;
  const toolCallId = requireStringValue(identity.toolCallId, "protocol.agui.identity.toolCallId");
  if (toolCallId !== context.tool.agUiToolCallId) {
    throw new TypeError("tool context AG-UI toolCallId must match saved protocol identity");
  }
  return true;
}

function startIdentityParentMessageId(record: Record<string, unknown>): string | undefined {
  const identity = protocolIdentity(record)!;
  if (identity.parentMessageId === undefined) return undefined;
  return requireStringValue(
    identity.parentMessageId,
    "protocol.agui.identity.parentMessageId",
  );
}

function validateStartIdentity(
  record: Record<string, unknown> | undefined,
  context: AgUiToolProfileContext,
): boolean {
  if (!validateCommonIdentity(record, context)) return false;
  if (record === undefined) return false;
  const identity = protocolIdentity(record)!;
  const toolCallName = requireStringValue(
    identity.toolCallName,
    "protocol.agui.identity.toolCallName",
  );
  if (toolCallName !== context.tool.agUiToolCallName) {
    throw new TypeError("tool context AG-UI toolCallName must match saved protocol identity");
  }
  const parentMessageId = startIdentityParentMessageId(record);
  if (parentMessageId !== undefined && parentMessageId !== context.parent?.agUiMessageId) {
    throw new TypeError("tool context AG-UI parentMessageId must match saved protocol identity");
  }
  return true;
}

function validateResultIdentity(
  record: Record<string, unknown> | undefined,
  context: Extract<AgUiToolProfileContext, { readonly kind: "result" }>,
): boolean {
  if (!validateCommonIdentity(record, context)) return false;
  const identity = protocolIdentity(record)!;
  const messageId = requireStringValue(identity.messageId, "protocol.agui.identity.messageId");
  if (messageId !== context.resultMessage.agUiMessageId) {
    throw new TypeError("tool context AG-UI result messageId must match saved protocol identity");
  }
  if (identity.role !== undefined) {
    requireLiteral(identity.role, "tool", "protocol.agui.identity.role");
  }
  return true;
}

function validateProjectedAgUi(event: Record<string, unknown>): AgUiToolProfileSupportedEvent {
  const result = safeParseAgUiEvent(event);
  if (!result.success) throw new TypeError(result.issues[0]?.message ?? "Invalid AG-UI tool event");
  return supportedAgUiEvent(result.data);
}

function assertNativeTool(event: AgUiToolNativeRecord, context: AgUiToolProfileContext): void {
  if (event.data.toolCallId !== context.tool.nativeToolCallId) {
    throw new TypeError("native toolCallId must match persisted mapping");
  }
  if (
    event.type === "com.veryfront.tool-call.started" &&
    event.data.toolName !== context.tool.nativeToolName
  ) {
    throw new TypeError("native toolName must match persisted mapping");
  }
}

export function projectNativeToolEvent(input: ProjectNativeToolInput): AgUiToolProjectionCommand {
  const event = parseNativeToolRecord(input.event);
  const context = validateContext(input.context);
  validateRecordOccurrence(context, event);
  assertNativeTool(event, context);
  const protocol = protocolFromNative(event);
  switch (event.type) {
    case "com.veryfront.tool-call.started": {
      const protocolRecord = requireProtocolHeader(protocol, "TOOL_CALL_START");
      if (!validateStartIdentity(protocolRecord, context)) {
        return missingIdentity(
          "native tool start protocol metadata must include saved AG-UI tool identity",
          protocol,
        );
      }
      const protocolParentMessageId = protocolRecord === undefined
        ? undefined
        : startIdentityParentMessageId(protocolRecord);
      if (event.data.messageId === undefined && protocolParentMessageId !== undefined) {
        throw new TypeError("native parent messageId must match saved protocol identity presence");
      }
      if (event.data.messageId !== undefined && protocolParentMessageId === undefined) {
        throw new TypeError("native parent messageId requires saved protocol identity");
      }
      if (
        event.data.messageId !== undefined &&
        event.data.messageId !== context.parent?.nativeMessageId
      ) {
        throw new TypeError("native parent messageId must match persisted mapping");
      }
      return {
        kind: "ag-ui-event",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...aguiBase(protocolRecord, START_FIELDS),
          type: "TOOL_CALL_START",
          toolCallId: context.tool.agUiToolCallId,
          toolCallName: context.tool.agUiToolCallName,
          ...(event.data.messageId === undefined
            ? {}
            : { parentMessageId: context.parent?.agUiMessageId }),
        }),
      };
    }
    case "com.veryfront.tool-call.arguments.delta.emitted": {
      const protocolRecord = requireProtocolHeader(protocol, "TOOL_CALL_ARGS");
      if (!validateCommonIdentity(protocolRecord, context)) {
        return missingIdentity(
          "native tool args protocol metadata must include saved AG-UI toolCallId",
          protocol,
        );
      }
      return {
        kind: "ag-ui-event",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...aguiBase(protocolRecord, ARGS_FIELDS),
          type: "TOOL_CALL_ARGS",
          toolCallId: context.tool.agUiToolCallId,
          delta: event.data.delta,
        }),
      };
    }
    case "com.veryfront.tool-call.arguments.ended": {
      const protocolRecord = requireProtocolHeader(protocol, "TOOL_CALL_END");
      if (!validateCommonIdentity(protocolRecord, context)) {
        return missingIdentity(
          "native tool end protocol metadata must include saved AG-UI toolCallId",
          protocol,
        );
      }
      if (event.data.input !== undefined) {
        return {
          kind: "missing-fact-requirement",
          reason: "non-json-protocol-metadata",
          message: "native finalized tool input cannot be represented by AG-UI TOOL_CALL_END",
          ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
        };
      }
      return {
        kind: "ag-ui-event",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...aguiBase(protocolRecord, END_FIELDS),
          type: "TOOL_CALL_END",
          toolCallId: context.tool.agUiToolCallId,
        }),
      };
    }
    case "com.veryfront.tool-call.result.recorded": {
      if (context.kind !== "result") {
        throw new TypeError(
          "native tool result projection requires persisted result message context",
        );
      }
      const protocolRecord = requireProtocolHeader(protocol, "TOOL_CALL_RESULT");
      if ("outputRedacted" in event.data) {
        return {
          kind: "missing-fact-requirement",
          reason: "redacted-output",
          message: "redacted tool output cannot be projected to AG-UI TOOL_CALL_RESULT content",
          ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
        };
      }
      if (event.data.isError === true) {
        return {
          kind: "missing-fact-requirement",
          reason: "error-result",
          message: "tool result error status has no AG-UI TOOL_CALL_RESULT field",
          ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
        };
      }
      if (!validateResultIdentity(protocolRecord, context)) {
        return missingIdentity(
          "native tool result protocol metadata must include saved AG-UI result identity",
          protocol,
        );
      }
      return {
        kind: "ag-ui-event",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...aguiBase(protocolRecord, RESULT_FIELDS),
          type: "TOOL_CALL_RESULT",
          messageId: context.resultMessage.agUiMessageId,
          toolCallId: context.tool.agUiToolCallId,
          content: event.data.output,
          ...(protocolIdentity(protocolRecord)?.role === undefined ? {} : { role: "tool" }),
        }),
      };
    }
  }
}

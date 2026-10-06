import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { parseEvent } from "../parser.ts";
import type { Extensions } from "../payload-types.generated.ts";
import type { EventRecord, JsonObject } from "../types.ts";
import { EVENT_SCHEMA_BY_TYPE } from "../types.ts";
import { parseAgUiEvent, safeParseAgUiEvent } from "./parser.ts";
import { AG_UI_PROTOCOL_VERSION } from "./schema.ts";
import type { AgUiEventOf, AgUiProducerOccurrence } from "./types.ts";

const AG_UI_PROTOCOL_NAME = "ag-ui";
export const AG_UI_CONTENT_PROTOCOL_EXTENSION_URI = "urn:veryfront:ag-ui:protocol:content:1";

export type AgUiContentProfileFamily = "text" | "reasoning" | "step";

export type AgUiContentProfileSupportedEvent =
  | AgUiEventOf<"TEXT_MESSAGE_START">
  | AgUiEventOf<"TEXT_MESSAGE_CONTENT">
  | AgUiEventOf<"TEXT_MESSAGE_END">
  | AgUiEventOf<"REASONING_MESSAGE_START">
  | AgUiEventOf<"REASONING_MESSAGE_CONTENT">
  | AgUiEventOf<"REASONING_MESSAGE_END">
  | AgUiEventOf<"STEP_STARTED">
  | AgUiEventOf<"STEP_FINISHED">;

export type AgUiContentNativeType =
  | "com.veryfront.message.text.started"
  | "com.veryfront.message.text.delta.emitted"
  | "com.veryfront.message.text.ended"
  | "com.veryfront.message.reasoning.started"
  | "com.veryfront.message.reasoning.delta.emitted"
  | "com.veryfront.message.reasoning.ended"
  | "com.veryfront.step.started"
  | "com.veryfront.step.ended";

export type AgUiContentNativeRecord = EventRecord<AgUiContentNativeType>;

export interface AgUiContentOccurrence {
  readonly source: string;
  readonly id: string;
  readonly time?: string;
  readonly recordedat?: string;
}

export interface AgUiContentMessageMapping {
  readonly nativeMessageId: string;
  readonly nativeContentId: string;
  readonly agUiMessageId: string;
}

export interface AgUiContentStepMapping {
  readonly nativeStepId: string;
  readonly agUiStepName: string;
}

export type AgUiContentProfileContext =
  | {
    readonly family: "text";
    readonly occurrence: AgUiContentOccurrence;
    readonly message: AgUiContentMessageMapping;
  }
  | {
    readonly family: "reasoning";
    readonly occurrence: AgUiContentOccurrence;
    readonly message: AgUiContentMessageMapping;
  }
  | {
    readonly family: "step";
    readonly occurrence: AgUiContentOccurrence;
    readonly runid: string;
    readonly step: AgUiContentStepMapping;
  };

export interface ProjectAgUiContentInput {
  readonly event: unknown;
  readonly context: AgUiContentProfileContext;
}

export interface ProjectNativeContentInput {
  readonly event: unknown;
  readonly context: AgUiContentProfileContext;
}

export type AgUiContentProjectionCommand =
  | {
    readonly kind: "canonical-event";
    readonly family: AgUiContentProfileFamily;
    readonly event: AgUiContentNativeRecord;
    readonly protocol?: { readonly agui: JsonObject };
  }
  | {
    readonly kind: "ag-ui-event";
    readonly family: AgUiContentProfileFamily;
    readonly producerOccurrence: AgUiProducerOccurrence;
    readonly event: AgUiContentProfileSupportedEvent;
  }
  | {
    readonly kind: "missing-fact-requirement";
    readonly family: AgUiContentProfileFamily;
    readonly reason:
      | "non-json-protocol-metadata"
      | "redacted-content"
      | "unsupported-role"
      | "missing-protocol-identity";
    readonly message: string;
    readonly protocol?: { readonly agui: JsonObject };
  };

const TEXT_START_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "role",
  "name",
]);
const TEXT_CONTENT_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "delta",
]);
const TEXT_END_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
]);
const REASONING_START_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "role",
]);
const REASONING_CONTENT_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
  "delta",
]);
const REASONING_END_FIELDS = TEXT_END_FIELDS;
const STEP_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "stepName",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function optionalStringValue(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireStringValue(value, label);
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new TypeError(`${label} must be a number`);
  return value;
}

function requireLiteral<TLiteral extends string>(
  value: unknown,
  expected: TLiteral,
  label: string,
): TLiteral {
  if (value !== expected) throw new TypeError(`${label} must be ${expected}`);
  return expected;
}

function toJsonObject(value: unknown): JsonObject | undefined {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) return undefined;
  return isRecord(snapshot.value) ? snapshot.value : undefined;
}

function validateOccurrence(occurrence: AgUiContentOccurrence): AgUiContentOccurrence {
  requireString(occurrence.source, "content occurrence source");
  requireString(occurrence.id, "content occurrence id");
  optionalString(occurrence.time, "content occurrence time");
  optionalString(occurrence.recordedat, "content occurrence recordedat");
  return occurrence;
}

function validateMessageMapping(mapping: AgUiContentMessageMapping): AgUiContentMessageMapping {
  requireString(mapping.nativeMessageId, "content nativeMessageId");
  requireString(mapping.nativeContentId, "content nativeContentId");
  requireStringValue(mapping.agUiMessageId, "content agUiMessageId");
  return mapping;
}

function validateContext(context: AgUiContentProfileContext): AgUiContentProfileContext {
  validateOccurrence(context.occurrence);
  switch (context.family) {
    case "text":
    case "reasoning":
      validateMessageMapping(context.message);
      return context;
    case "step":
      requireString(context.runid, "content step runid");
      requireString(context.step.nativeStepId, "content nativeStepId");
      requireStringValue(context.step.agUiStepName, "content agUiStepName");
      return context;
  }
}

function validateContextOccurrenceMatchesRecord(
  context: AgUiContentProfileContext,
  event: AgUiContentNativeRecord,
): void {
  if (context.occurrence.source !== event.source || context.occurrence.id !== event.id) {
    throw new TypeError("native content record source/id must match persisted mapping occurrence");
  }
}

function extensionFields(
  event: AgUiContentProfileSupportedEvent,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(event).filter(([key]) => !knownFields.has(key));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function baseProtocolMetadata(
  event: AgUiContentProfileSupportedEvent,
  knownFields: ReadonlySet<string>,
): JsonObject | undefined {
  const extensionData = extensionFields(event, knownFields);
  return toJsonObject({
    name: AG_UI_PROTOCOL_NAME,
    version: AG_UI_PROTOCOL_VERSION,
    eventType: event.type,
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    ...(event.rawEvent === undefined ? {} : { rawEvent: event.rawEvent }),
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    ...(extensionData === undefined ? {} : { extensions: extensionData }),
    ...(event.subagentRunId === undefined
      ? {}
      : { attribution: { invocation: { subagentRunId: event.subagentRunId } } }),
  });
}

function agUiIdentityMetadata(event: AgUiContentProfileSupportedEvent): JsonObject {
  switch (event.type) {
    case "TEXT_MESSAGE_START":
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_END":
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_END":
      return { messageId: event.messageId };
    case "STEP_STARTED":
    case "STEP_FINISHED":
      return { stepName: event.stepName };
  }
}

function knownProtocolFields(event: AgUiContentProfileSupportedEvent): ReadonlySet<string> {
  switch (event.type) {
    case "TEXT_MESSAGE_START":
      return TEXT_START_FIELDS;
    case "TEXT_MESSAGE_CONTENT":
      return TEXT_CONTENT_FIELDS;
    case "TEXT_MESSAGE_END":
      return TEXT_END_FIELDS;
    case "REASONING_MESSAGE_START":
      return REASONING_START_FIELDS;
    case "REASONING_MESSAGE_CONTENT":
      return REASONING_CONTENT_FIELDS;
    case "REASONING_MESSAGE_END":
      return REASONING_END_FIELDS;
    case "STEP_STARTED":
    case "STEP_FINISHED":
      return STEP_FIELDS;
  }
}

function protocolMetadata(event: AgUiContentProfileSupportedEvent): JsonObject | undefined {
  const base = baseProtocolMetadata(event, knownProtocolFields(event));
  if (base === undefined) return undefined;
  return toJsonObject({
    ...base,
    identity: agUiIdentityMetadata(event),
    ...(event.type === "TEXT_MESSAGE_START" && event.name !== undefined
      ? { message: { name: event.name } }
      : {}),
  });
}

function protocolExtensions(protocol: JsonObject): { readonly extensions: Extensions } {
  return { extensions: { [AG_UI_CONTENT_PROTOCOL_EXTENSION_URI]: protocol } };
}

export function parseNativeContentRecord(input: unknown): AgUiContentNativeRecord {
  const parsed = parseEvent(input);
  switch (parsed.type) {
    case "com.veryfront.message.text.started":
    case "com.veryfront.message.text.delta.emitted":
    case "com.veryfront.message.text.ended":
    case "com.veryfront.message.reasoning.started":
    case "com.veryfront.message.reasoning.delta.emitted":
    case "com.veryfront.message.reasoning.ended":
    case "com.veryfront.step.started":
    case "com.veryfront.step.ended":
      return parsed;
    default:
      throw new TypeError(`${parsed.type} is not an AG-UI native content profile event`);
  }
}

function recordEnvelope(
  context: AgUiContentProfileContext,
  type: AgUiContentNativeType,
  data: unknown,
): AgUiContentNativeRecord {
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
    ...(context.family === "step" ? { runid: context.runid } : {}),
  };
  const parsed = parseNativeContentRecord(candidate);
  if (parsed.type !== type) {
    throw new TypeError(`validated content type ${parsed.type} did not match ${type}`);
  }
  return parsed;
}

function supportedAgUiEvent(input: unknown): AgUiContentProfileSupportedEvent {
  const event = parseAgUiEvent(input);
  switch (event.type) {
    case "TEXT_MESSAGE_START":
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_END":
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_END":
    case "STEP_STARTED":
    case "STEP_FINISHED":
      return event;
    default:
      throw new TypeError(`${event.type} is not an AG-UI content profile event`);
  }
}

function eventFamily(event: AgUiContentProfileSupportedEvent): AgUiContentProfileFamily {
  switch (event.type) {
    case "TEXT_MESSAGE_START":
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_END":
      return "text";
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_END":
      return "reasoning";
    case "STEP_STARTED":
    case "STEP_FINISHED":
      return "step";
  }
}

function nativeFamily(event: AgUiContentNativeRecord): AgUiContentProfileFamily {
  switch (event.type) {
    case "com.veryfront.message.text.started":
    case "com.veryfront.message.text.delta.emitted":
    case "com.veryfront.message.text.ended":
      return "text";
    case "com.veryfront.message.reasoning.started":
    case "com.veryfront.message.reasoning.delta.emitted":
    case "com.veryfront.message.reasoning.ended":
      return "reasoning";
    case "com.veryfront.step.started":
    case "com.veryfront.step.ended":
      return "step";
  }
}

function assertContextFamily(
  actual: AgUiContentProfileFamily,
  expected: AgUiContentProfileFamily,
): void {
  if (actual !== expected) {
    throw new TypeError(
      `AG-UI ${actual} content event cannot be projected with ${expected} context`,
    );
  }
}

function nonJsonRequirement(family: AgUiContentProfileFamily): AgUiContentProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    family,
    reason: "non-json-protocol-metadata",
    message:
      "AG-UI content metadata contains a value that cannot be preserved inside native content protocol metadata.",
  };
}

function assertAgUiMessageId(
  event: Extract<AgUiContentProfileSupportedEvent, { readonly messageId: string }>,
  context: Extract<AgUiContentProfileContext, { readonly family: "text" | "reasoning" }>,
): void {
  if (event.messageId !== context.message.agUiMessageId) {
    throw new TypeError(`AG-UI ${context.family} messageId must match persisted mapping`);
  }
}

function textData(
  event:
    | AgUiEventOf<"TEXT_MESSAGE_START">
    | AgUiEventOf<"TEXT_MESSAGE_CONTENT">
    | AgUiEventOf<"TEXT_MESSAGE_END">,
  context: Extract<AgUiContentProfileContext, { readonly family: "text" }>,
  protocol: JsonObject,
) {
  switch (event.type) {
    case "TEXT_MESSAGE_START":
      return {
        messageId: context.message.nativeMessageId,
        contentId: context.message.nativeContentId,
        ...(event.role === undefined ? {} : { role: event.role }),
        ...protocolExtensions(protocol),
      };
    case "TEXT_MESSAGE_CONTENT":
      return {
        messageId: context.message.nativeMessageId,
        contentId: context.message.nativeContentId,
        delta: event.delta,
        ...protocolExtensions(protocol),
      };
    case "TEXT_MESSAGE_END":
      return {
        messageId: context.message.nativeMessageId,
        contentId: context.message.nativeContentId,
        ...protocolExtensions(protocol),
      };
  }
}

function reasoningData(
  event:
    | AgUiEventOf<"REASONING_MESSAGE_START">
    | AgUiEventOf<"REASONING_MESSAGE_CONTENT">
    | AgUiEventOf<"REASONING_MESSAGE_END">,
  context: Extract<AgUiContentProfileContext, { readonly family: "reasoning" }>,
  protocol: JsonObject,
) {
  switch (event.type) {
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_END":
      return {
        messageId: context.message.nativeMessageId,
        contentId: context.message.nativeContentId,
        ...protocolExtensions(protocol),
      };
    case "REASONING_MESSAGE_CONTENT":
      return {
        messageId: context.message.nativeMessageId,
        contentId: context.message.nativeContentId,
        delta: event.delta,
        ...protocolExtensions(protocol),
      };
  }
}

function canonicalCommand(
  family: AgUiContentProfileFamily,
  event: AgUiContentNativeRecord,
  protocol: JsonObject,
): AgUiContentProjectionCommand {
  return { kind: "canonical-event", family, event, protocol: { agui: protocol } };
}

export function projectAgUiContentEvent(
  input: ProjectAgUiContentInput,
): AgUiContentProjectionCommand {
  const event = supportedAgUiEvent(input.event);
  const context = validateContext(input.context);
  const family = eventFamily(event);
  assertContextFamily(family, context.family);
  const protocol = protocolMetadata(event);
  if (protocol === undefined) return nonJsonRequirement(family);

  switch (event.type) {
    case "TEXT_MESSAGE_START":
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_END": {
      if (context.family !== "text") {
        throw new TypeError(
          `AG-UI ${family} content event cannot be projected with ${context.family} context`,
        );
      }
      assertAgUiMessageId(event, context);
      const type = event.type === "TEXT_MESSAGE_START"
        ? "com.veryfront.message.text.started"
        : event.type === "TEXT_MESSAGE_CONTENT"
        ? "com.veryfront.message.text.delta.emitted"
        : "com.veryfront.message.text.ended";
      return canonicalCommand(
        "text",
        recordEnvelope(context, type, textData(event, context, protocol)),
        protocol,
      );
    }
    case "REASONING_MESSAGE_START":
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_END": {
      if (context.family !== "reasoning") {
        throw new TypeError(
          `AG-UI ${family} content event cannot be projected with ${context.family} context`,
        );
      }
      assertAgUiMessageId(event, context);
      const type = event.type === "REASONING_MESSAGE_START"
        ? "com.veryfront.message.reasoning.started"
        : event.type === "REASONING_MESSAGE_CONTENT"
        ? "com.veryfront.message.reasoning.delta.emitted"
        : "com.veryfront.message.reasoning.ended";
      return canonicalCommand(
        "reasoning",
        recordEnvelope(context, type, reasoningData(event, context, protocol)),
        protocol,
      );
    }
    case "STEP_STARTED":
    case "STEP_FINISHED": {
      if (context.family !== "step") {
        throw new TypeError(
          `AG-UI ${family} content event cannot be projected with ${context.family} context`,
        );
      }
      if (event.stepName !== context.step.agUiStepName) {
        throw new TypeError("AG-UI stepName must match persisted mapping");
      }
      const type = event.type === "STEP_STARTED"
        ? "com.veryfront.step.started"
        : "com.veryfront.step.ended";
      return canonicalCommand(
        "step",
        recordEnvelope(context, type, {
          stepId: context.step.nativeStepId,
          ...(event.stepName.length === 0 ? {} : { name: event.stepName }),
          ...protocolExtensions(protocol),
        }),
        protocol,
      );
    }
  }
}

function protocolFromNative(event: AgUiContentNativeRecord): JsonObject | undefined {
  const extensions = event.data.extensions;
  if (extensions === undefined) return undefined;
  const protocol = extensions[AG_UI_CONTENT_PROTOCOL_EXTENSION_URI];
  if (protocol === undefined) return undefined;
  const jsonProtocol = toJsonObject(protocol);
  if (jsonProtocol === undefined) {
    throw new TypeError("native content event has non-JSON AG-UI protocol metadata");
  }
  return jsonProtocol;
}

function requireProtocolHeader(
  protocol: JsonObject | undefined,
  eventType: AgUiContentProfileSupportedEvent["type"],
): Record<string, unknown> | undefined {
  if (protocol === undefined) return undefined;
  requireLiteral(protocol.name, AG_UI_PROTOCOL_NAME, "protocol.agui.name");
  requireLiteral(protocol.version, AG_UI_PROTOCOL_VERSION, "protocol.agui.version");
  requireLiteral(protocol.eventType, eventType, "protocol.agui.eventType");
  return protocol;
}

function invocationSubagentRunId(record: Record<string, unknown>): string | undefined {
  const attribution = record.attribution;
  if (attribution === undefined) return undefined;
  const attributionRecord = requireRecord(attribution, "protocol.agui.attribution");
  const invocation = attributionRecord.invocation;
  if (invocation === undefined) return undefined;
  const invocationRecord = requireRecord(invocation, "protocol.agui.attribution.invocation");
  return requireStringValue(
    invocationRecord.subagentRunId,
    "protocol.agui.attribution.invocation.subagentRunId",
  );
}

function reservedExtensions(
  record: Record<string, unknown> | undefined,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (record === undefined) return undefined;
  const extensions = record.extensions;
  if (extensions === undefined) return undefined;
  const extensionRecord = requireRecord(extensions, "protocol.agui.extensions");
  for (const key of Object.keys(extensionRecord)) {
    if (knownFields.has(key)) {
      throw new TypeError(`protocol.agui.extensions must not contain reserved AG-UI field ${key}`);
    }
  }
  return extensionRecord;
}

function protocolIdentity(
  record: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (record === undefined) return undefined;
  const identity = record.identity;
  if (identity === undefined) return undefined;
  return requireRecord(identity, "protocol.agui.identity");
}

function protocolMessageIdentityMatches(
  record: Record<string, unknown> | undefined,
  context: Extract<AgUiContentProfileContext, { readonly family: "text" | "reasoning" }>,
): boolean {
  const identity = protocolIdentity(record);
  if (identity === undefined) return false;
  const messageId = requireStringValue(identity.messageId, "protocol.agui.identity.messageId");
  if (messageId !== context.message.agUiMessageId) {
    throw new TypeError("content context AG-UI messageId must match saved protocol identity");
  }
  return true;
}

function protocolStepIdentityMatches(
  record: Record<string, unknown> | undefined,
  context: Extract<AgUiContentProfileContext, { readonly family: "step" }>,
): boolean {
  const identity = protocolIdentity(record);
  if (identity === undefined) return false;
  const stepName = requireStringValue(identity.stepName, "protocol.agui.identity.stepName");
  if (stepName !== context.step.agUiStepName) {
    throw new TypeError("content context AG-UI stepName must match saved protocol identity");
  }
  return true;
}

function missingProtocolIdentity(
  family: AgUiContentProfileFamily,
  message: string,
  protocol: JsonObject | undefined,
): AgUiContentProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    family,
    reason: "missing-protocol-identity",
    message,
    ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
  };
}

function protocolTextName(record: Record<string, unknown> | undefined): string | undefined {
  if (record === undefined) return undefined;
  const message = record.message;
  if (message === undefined) return undefined;
  const messageRecord = requireRecord(message, "protocol.agui.message");
  return optionalStringValue(messageRecord.name, "protocol.agui.message.name");
}

function aguiBase(
  record: Record<string, unknown> | undefined,
  knownFields: ReadonlySet<string>,
) {
  if (record === undefined) return {};
  return {
    ...(reservedExtensions(record, knownFields) ?? {}),
    ...(record.timestamp === undefined
      ? {}
      : { timestamp: optionalNumber(record.timestamp, "protocol.agui.timestamp") }),
    ...(record.rawEvent === undefined ? {} : { rawEvent: record.rawEvent }),
    ...(record.metadata === undefined
      ? {}
      : { metadata: requireRecord(record.metadata, "protocol.agui.metadata") }),
    ...(invocationSubagentRunId(record) === undefined
      ? {}
      : { subagentRunId: invocationSubagentRunId(record) }),
  };
}

function validateProjectedAgUi(event: Record<string, unknown>): AgUiContentProfileSupportedEvent {
  const result = safeParseAgUiEvent(event);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid AG-UI content event");
  }
  return supportedAgUiEvent(result.data);
}

function assertNativeTextMapping(
  event: Extract<AgUiContentNativeRecord, {
    readonly type:
      | "com.veryfront.message.text.started"
      | "com.veryfront.message.text.delta.emitted"
      | "com.veryfront.message.text.ended";
  }>,
  context: Extract<AgUiContentProfileContext, { readonly family: "text" }>,
): void {
  if (
    event.data.messageId !== context.message.nativeMessageId ||
    event.data.contentId !== context.message.nativeContentId
  ) {
    throw new TypeError("native text message/content IDs must match persisted mapping");
  }
}

function assertNativeReasoningMapping(
  event: Extract<AgUiContentNativeRecord, {
    readonly type:
      | "com.veryfront.message.reasoning.started"
      | "com.veryfront.message.reasoning.delta.emitted"
      | "com.veryfront.message.reasoning.ended";
  }>,
  context: Extract<AgUiContentProfileContext, { readonly family: "reasoning" }>,
): void {
  if (
    event.data.messageId !== context.message.nativeMessageId ||
    event.data.contentId !== context.message.nativeContentId
  ) {
    throw new TypeError("native reasoning message/content IDs must match persisted mapping");
  }
}

function projectedText(
  event: Extract<AgUiContentNativeRecord, {
    readonly type:
      | "com.veryfront.message.text.started"
      | "com.veryfront.message.text.delta.emitted"
      | "com.veryfront.message.text.ended";
  }>,
  context: Extract<AgUiContentProfileContext, { readonly family: "text" }>,
): AgUiContentProjectionCommand {
  assertNativeTextMapping(event, context);
  const protocol = protocolFromNative(event);
  const eventType = event.type === "com.veryfront.message.text.started"
    ? "TEXT_MESSAGE_START"
    : event.type === "com.veryfront.message.text.delta.emitted"
    ? "TEXT_MESSAGE_CONTENT"
    : "TEXT_MESSAGE_END";
  const protocolRecord = requireProtocolHeader(protocol, eventType);
  if (
    event.type === "com.veryfront.message.text.delta.emitted" && "contentRedacted" in event.data
  ) {
    return {
      kind: "missing-fact-requirement",
      family: "text",
      reason: "redacted-content",
      message: "redacted text content cannot be projected to AG-UI visible text",
      ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
    };
  }
  if (!protocolMessageIdentityMatches(protocolRecord, context)) {
    return missingProtocolIdentity(
      "text",
      "native text content protocol metadata must include saved AG-UI messageId before reverse projection",
      protocol,
    );
  }
  const base = aguiBase(
    protocolRecord,
    event.type === "com.veryfront.message.text.started"
      ? TEXT_START_FIELDS
      : event.type === "com.veryfront.message.text.delta.emitted"
      ? TEXT_CONTENT_FIELDS
      : TEXT_END_FIELDS,
  );
  switch (event.type) {
    case "com.veryfront.message.text.started":
      if (event.data.role === "tool") {
        return {
          kind: "missing-fact-requirement",
          family: "text",
          reason: "unsupported-role",
          message: "native tool text role has no AG-UI text-message role equivalent",
          ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
        };
      }
      return {
        kind: "ag-ui-event",
        family: "text",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...base,
          type: eventType,
          messageId: context.message.agUiMessageId,
          ...(event.data.role === undefined ? {} : { role: event.data.role }),
          ...(protocolTextName(protocolRecord) === undefined
            ? {}
            : { name: protocolTextName(protocolRecord) }),
        }),
      };
    case "com.veryfront.message.text.delta.emitted":
      return {
        kind: "ag-ui-event",
        family: "text",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...base,
          type: eventType,
          messageId: context.message.agUiMessageId,
          delta: event.data.delta,
        }),
      };
    case "com.veryfront.message.text.ended":
      return {
        kind: "ag-ui-event",
        family: "text",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...base,
          type: eventType,
          messageId: context.message.agUiMessageId,
        }),
      };
  }
}

function projectedReasoning(
  event: Extract<AgUiContentNativeRecord, {
    readonly type:
      | "com.veryfront.message.reasoning.started"
      | "com.veryfront.message.reasoning.delta.emitted"
      | "com.veryfront.message.reasoning.ended";
  }>,
  context: Extract<AgUiContentProfileContext, { readonly family: "reasoning" }>,
): AgUiContentProjectionCommand {
  assertNativeReasoningMapping(event, context);
  const protocol = protocolFromNative(event);
  const eventType = event.type === "com.veryfront.message.reasoning.started"
    ? "REASONING_MESSAGE_START"
    : event.type === "com.veryfront.message.reasoning.delta.emitted"
    ? "REASONING_MESSAGE_CONTENT"
    : "REASONING_MESSAGE_END";
  const protocolRecord = requireProtocolHeader(protocol, eventType);
  if (
    event.type === "com.veryfront.message.reasoning.delta.emitted" &&
    "contentRedacted" in event.data
  ) {
    return {
      kind: "missing-fact-requirement",
      family: "reasoning",
      reason: "redacted-content",
      message: "redacted reasoning content cannot be projected to AG-UI visible reasoning text",
      ...(protocol === undefined ? {} : { protocol: { agui: protocol } }),
    };
  }
  if (!protocolMessageIdentityMatches(protocolRecord, context)) {
    return missingProtocolIdentity(
      "reasoning",
      "native reasoning content protocol metadata must include saved AG-UI messageId before reverse projection",
      protocol,
    );
  }
  const base = aguiBase(
    protocolRecord,
    event.type === "com.veryfront.message.reasoning.started"
      ? REASONING_START_FIELDS
      : event.type === "com.veryfront.message.reasoning.delta.emitted"
      ? REASONING_CONTENT_FIELDS
      : REASONING_END_FIELDS,
  );
  switch (event.type) {
    case "com.veryfront.message.reasoning.started":
      return {
        kind: "ag-ui-event",
        family: "reasoning",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...base,
          type: eventType,
          messageId: context.message.agUiMessageId,
          role: "reasoning",
        }),
      };
    case "com.veryfront.message.reasoning.delta.emitted":
      return {
        kind: "ag-ui-event",
        family: "reasoning",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...base,
          type: eventType,
          messageId: context.message.agUiMessageId,
          delta: event.data.delta,
        }),
      };
    case "com.veryfront.message.reasoning.ended":
      return {
        kind: "ag-ui-event",
        family: "reasoning",
        producerOccurrence: { source: event.source, id: event.id },
        event: validateProjectedAgUi({
          ...base,
          type: eventType,
          messageId: context.message.agUiMessageId,
        }),
      };
  }
}

function projectedStep(
  event: Extract<AgUiContentNativeRecord, {
    readonly type: "com.veryfront.step.started" | "com.veryfront.step.ended";
  }>,
  context: Extract<AgUiContentProfileContext, { readonly family: "step" }>,
): AgUiContentProjectionCommand {
  if (event.data.stepId !== context.step.nativeStepId) {
    throw new TypeError("native stepId must match persisted mapping");
  }
  if (event.runid !== context.runid) {
    throw new TypeError("native step runid must match persisted mapping");
  }
  if (event.data.name !== undefined && event.data.name !== context.step.agUiStepName) {
    throw new TypeError("native step name must match persisted mapping");
  }
  const protocol = protocolFromNative(event);
  const eventType = event.type === "com.veryfront.step.started" ? "STEP_STARTED" : "STEP_FINISHED";
  const protocolRecord = requireProtocolHeader(protocol, eventType);
  if (!protocolStepIdentityMatches(protocolRecord, context)) {
    return missingProtocolIdentity(
      "step",
      "native step content protocol metadata must include saved AG-UI stepName before reverse projection",
      protocol,
    );
  }
  return {
    kind: "ag-ui-event",
    family: "step",
    producerOccurrence: { source: event.source, id: event.id },
    event: validateProjectedAgUi({
      ...aguiBase(protocolRecord, STEP_FIELDS),
      type: eventType,
      stepName: context.step.agUiStepName,
    }),
  };
}

export function projectNativeContentEvent(
  input: ProjectNativeContentInput,
): AgUiContentProjectionCommand {
  const event = parseNativeContentRecord(input.event);
  const context = validateContext(input.context);
  validateContextOccurrenceMatchesRecord(context, event);
  const family = nativeFamily(event);
  assertContextFamily(family, context.family);

  switch (event.type) {
    case "com.veryfront.message.text.started":
    case "com.veryfront.message.text.delta.emitted":
    case "com.veryfront.message.text.ended":
      if (context.family === "text") return projectedText(event, context);
      break;
    case "com.veryfront.message.reasoning.started":
    case "com.veryfront.message.reasoning.delta.emitted":
    case "com.veryfront.message.reasoning.ended":
      if (context.family === "reasoning") return projectedReasoning(event, context);
      break;
    case "com.veryfront.step.started":
    case "com.veryfront.step.ended":
      if (context.family === "step") return projectedStep(event, context);
      break;
  }
  throw new TypeError(
    `native ${family} content event cannot be projected with ${context.family} context`,
  );
}

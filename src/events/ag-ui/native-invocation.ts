import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { assertEventSchemaValidator, getEventSchemaValidatorVersion } from "../schema-validator.ts";
import type { JsonObject, JsonValue } from "../types.ts";
import { parseAgUiEvent, safeParseAgUiEvent } from "./parser.ts";
import {
  AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA,
  AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE,
} from "./native-invocation-contract.ts";
import type {
  AgUiInvocationEventType,
  AgUiInvocationProtocolMetadata,
  AgUiNativeInvocationAnyRecord,
  AgUiNativeInvocationRecord,
  AgUiNativeInvocationType,
} from "./native-invocation-types.generated.ts";
import type { AgUiEventOf } from "./types.ts";
export {
  AG_UI_NATIVE_INVOCATION_JSON_SCHEMA,
  AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA,
  AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE,
  AG_UI_NATIVE_INVOCATION_SCHEMA_ID,
  AG_UI_NATIVE_INVOCATION_TYPES,
} from "./native-invocation-contract.ts";
export type {
  AgUiInvocationEventByType,
  AgUiInvocationEventType,
  AgUiInvocationParentAttribution,
  AgUiInvocationProtocolMetadata,
  AgUiNativeInvocationAnyPayload,
  AgUiNativeInvocationAnyRecord,
  AgUiNativeInvocationDataschema,
  AgUiNativeInvocationPayload,
  AgUiNativeInvocationPayloadByType,
  AgUiNativeInvocationRecord,
  AgUiNativeInvocationType,
} from "./native-invocation-types.generated.ts";

const AG_UI_PROTOCOL_NAME = "ag-ui";
const AG_UI_PROTOCOL_VERSION = "1.0";

export type AgUiInvocationSupportedEvent =
  | AgUiEventOf<"SUBAGENT_STARTED">
  | AgUiEventOf<"SUBAGENT_FINISHED">
  | AgUiEventOf<"SUBAGENT_ERROR">;

export interface AgUiInvocationOccurrence {
  readonly source: string;
  readonly id: string;
  readonly time?: string;
  readonly recordedat?: string;
}

export interface AgUiInvocationProjectionContext {
  readonly occurrence: AgUiInvocationOccurrence;
  readonly runid?: string;
  readonly runkind?: "agent" | "workflow" | "task";
  readonly conversationid?: string;
  readonly subject?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface AgUiGeneratedInvocationFrame {
  readonly kind: "generated-read-frame";
  readonly event: AgUiInvocationSupportedEvent;
  readonly protocol: {
    readonly agui: JsonObject;
  };
}

export interface ProjectAgUiInvocationInput {
  readonly event: unknown;
  readonly context: AgUiInvocationProjectionContext;
}

export interface ProjectNativeInvocationInput {
  readonly event: unknown;
}

export type AgUiInvocationProjectionCommand =
  | {
    readonly kind: "canonical-event";
    readonly event: AgUiNativeInvocationAnyRecord;
    readonly protocol: {
      readonly agui: JsonObject;
    };
  }
  | {
    readonly kind: "missing-fact-requirement";
    readonly reason: "non-json-protocol-metadata";
    readonly message: string;
    readonly protocol?: {
      readonly agui: JsonObject;
    };
  };

const KNOWN_SUBAGENT_STARTED_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "name",
  "description",
  "parentSubagentRunId",
  "parentToolCallId",
  "parentMessageId",
]);
const KNOWN_SUBAGENT_FINISHED_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "result",
  "outcome",
]);
const KNOWN_SUBAGENT_ERROR_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "message",
  "code",
]);

let compiledValidator: JsonSchemaValidationFunction<AgUiNativeInvocationAnyRecord> | undefined;
let compiledValidatorVersion = -1;

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

function requireLiteral<TLiteral extends string>(
  value: unknown,
  expected: TLiteral,
  label: string,
): TLiteral {
  if (value !== expected) throw new TypeError(`${label} must be ${expected}`);
  return expected;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") throw new TypeError(`${label} must be a number`);
  return value;
}

function jsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
    case "string":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      if (Array.isArray(value)) return value.every(jsonValue);
      if (!isRecord(value)) return false;
      return Object.values(value).every(jsonValue);
    default:
      return false;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(jsonValue);
}

function toJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function isPromiseLikeValidationResult(
  value:
    | JsonSchemaValidationResult<AgUiNativeInvocationAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeInvocationAnyRecord>>,
): value is PromiseLike<JsonSchemaValidationResult<AgUiNativeInvocationAnyRecord>> {
  return "then" in value && typeof value.then === "function";
}

function validationResultSync(
  result:
    | JsonSchemaValidationResult<AgUiNativeInvocationAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeInvocationAnyRecord>>,
): JsonSchemaValidationResult<AgUiNativeInvocationAnyRecord> {
  if (isPromiseLikeValidationResult(result)) {
    throw new TypeError("AG-UI native invocation requires a synchronous JSON Schema validator");
  }
  return result;
}

function validator(): JsonSchemaValidationFunction<AgUiNativeInvocationAnyRecord> {
  const version = getEventSchemaValidatorVersion();
  if (compiledValidator && compiledValidatorVersion === version) return compiledValidator;
  const schemaValidator = assertEventSchemaValidator();
  if (!schemaValidator.compileJsonSchema) {
    throw new TypeError("AG-UI native invocation requires compileJsonSchema support");
  }
  compiledValidator = schemaValidator.compileJsonSchema<AgUiNativeInvocationAnyRecord>(
    AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA,
  );
  compiledValidatorVersion = version;
  return compiledValidator;
}

export function parseNativeInvocationRecord(input: unknown): AgUiNativeInvocationAnyRecord {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) {
    throw new TypeError("native invocation event must be bounded data-only JSON");
  }
  const result = validationResultSync(validator()(snapshot.value));
  if (!result.success) {
    const first = result.errors[0];
    const suffix = first?.message ? `: ${first.message}` : "";
    throw new TypeError(`Invalid native invocation event${suffix}`);
  }
  return result.value;
}

function supportedAgUiEvent(input: unknown): AgUiInvocationSupportedEvent {
  const event = parseAgUiEvent(input);
  switch (event.type) {
    case "SUBAGENT_STARTED":
    case "SUBAGENT_FINISHED":
    case "SUBAGENT_ERROR":
      return event;
    default:
      throw new TypeError(`${event.type} is not an AG-UI invocation event`);
  }
}

function extensionFields(
  event: AgUiInvocationSupportedEvent,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(event).filter(([key]) => !knownFields.has(key));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function parentAttribution(
  event: AgUiInvocationSupportedEvent,
): Record<string, unknown> | undefined {
  if (event.type !== "SUBAGENT_STARTED") return undefined;
  const parent = {
    ...(event.parentSubagentRunId === undefined
      ? {}
      : { invocation: { subagentRunId: event.parentSubagentRunId } }),
    ...(event.parentToolCallId === undefined
      ? {}
      : { tool: { toolCallId: event.parentToolCallId } }),
    ...(event.parentMessageId === undefined
      ? {}
      : { message: { messageId: event.parentMessageId } }),
  };
  return Object.keys(parent).length === 0 ? undefined : { parent };
}

function baseProtocolMetadata(
  event: AgUiInvocationSupportedEvent,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> {
  const extensionData = extensionFields(event, knownFields);
  const attribution = parentAttribution(event);
  return {
    name: AG_UI_PROTOCOL_NAME,
    version: AG_UI_PROTOCOL_VERSION,
    eventType: event.type,
    ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
    ...(event.rawEvent === undefined ? {} : { rawEvent: event.rawEvent }),
    ...(event.metadata === undefined ? {} : { metadata: event.metadata }),
    ...(extensionData === undefined ? {} : { extensions: extensionData }),
    ...(attribution === undefined ? {} : { attribution }),
  };
}

interface ProtocolMetadataResult<TEventType extends AgUiInvocationEventType> {
  readonly typed: AgUiInvocationProtocolMetadata<TEventType>;
  readonly json: JsonObject;
}

function protocolMetadata<TEvent extends AgUiInvocationSupportedEvent>(
  event: TEvent,
): ProtocolMetadataResult<TEvent["type"]> | undefined {
  let protocol: Record<string, unknown>;
  switch (event.type) {
    case "SUBAGENT_STARTED":
      protocol = baseProtocolMetadata(event, KNOWN_SUBAGENT_STARTED_FIELDS);
      break;
    case "SUBAGENT_FINISHED":
      protocol = baseProtocolMetadata(event, KNOWN_SUBAGENT_FINISHED_FIELDS);
      break;
    case "SUBAGENT_ERROR":
      protocol = baseProtocolMetadata(event, KNOWN_SUBAGENT_ERROR_FIELDS);
      break;
  }
  const json = toJsonObject(protocol);
  return json === undefined ? undefined : {
    typed: protocol as AgUiInvocationProtocolMetadata<TEvent["type"]>,
    json,
  };
}

function validateContext(
  context: AgUiInvocationProjectionContext,
): AgUiInvocationProjectionContext {
  requireString(context.occurrence.source, "invocation occurrence source");
  requireString(context.occurrence.id, "invocation occurrence id");
  optionalString(context.occurrence.time, "invocation occurrence time");
  optionalString(context.occurrence.recordedat, "invocation occurrence recordedat");
  optionalString(context.runid, "invocation runid");
  optionalString(context.conversationid, "invocation conversationid");
  optionalString(context.subject, "invocation subject");
  optionalString(context.traceparent, "invocation traceparent");
  optionalString(context.tracestate, "invocation tracestate");
  return context;
}

function recordEnvelope<TType extends AgUiNativeInvocationType>(
  context: AgUiInvocationProjectionContext,
  type: TType,
  data: AgUiNativeInvocationRecord<TType>["data"],
): AgUiNativeInvocationRecord<TType> {
  const candidate = {
    specversion: "1.0",
    id: context.occurrence.id,
    source: context.occurrence.source,
    type,
    datacontenttype: "application/json",
    dataschema: AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE[type],
    data,
    ...(context.runid === undefined ? {} : { runid: context.runid }),
    ...(context.occurrence.time === undefined ? {} : { time: context.occurrence.time }),
    ...(context.occurrence.recordedat === undefined
      ? {}
      : { recordedat: context.occurrence.recordedat }),
    ...(context.runkind === undefined ? {} : { runkind: context.runkind }),
    ...(context.conversationid === undefined ? {} : { conversationid: context.conversationid }),
    ...(context.subject === undefined ? {} : { subject: context.subject }),
    ...(context.traceparent === undefined ? {} : { traceparent: context.traceparent }),
    ...(context.tracestate === undefined ? {} : { tracestate: context.tracestate }),
  };
  const parsed = parseNativeInvocationRecord(candidate);
  if (parsed.type !== type) {
    throw new TypeError(`validated invocation type ${parsed.type} did not match ${type}`);
  }
  return parsed as AgUiNativeInvocationRecord<TType>;
}

function nonJsonRequirement(): AgUiInvocationProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    reason: "non-json-protocol-metadata",
    message:
      "AG-UI invocation metadata contains a value that cannot be preserved inside the JSON native payload protocol metadata.",
  };
}

export function projectAgUiInvocationEvent(
  input: ProjectAgUiInvocationInput,
): AgUiInvocationProjectionCommand {
  const event = supportedAgUiEvent(input.event);
  const context = validateContext(input.context);
  switch (event.type) {
    case "SUBAGENT_STARTED": {
      const protocol = protocolMetadata(event);
      if (protocol === undefined) return nonJsonRequirement();
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.invocation.started", {
          invocation: {
            subagentRunId: event.subagentRunId,
            name: event.name,
            ...(event.description === undefined ? {} : { description: event.description }),
          },
          protocol: { agui: protocol.typed },
        }),
        protocol: { agui: protocol.json },
      };
    }
    case "SUBAGENT_FINISHED": {
      const protocol = protocolMetadata(event);
      if (protocol === undefined) return nonJsonRequirement();
      if (event.outcome?.type === "suspended") {
        return {
          kind: "canonical-event",
          event: recordEnvelope(context, "com.veryfront.invocation.paused", {
            invocation: {
              subagentRunId: event.subagentRunId,
              ...(event.result === undefined ? {} : { result: event.result }),
              outcome: event.outcome,
            },
            protocol: { agui: protocol.typed },
          }),
          protocol: { agui: protocol.json },
        };
      }
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.invocation.succeeded", {
          invocation: {
            subagentRunId: event.subagentRunId,
            ...(event.result === undefined ? {} : { result: event.result }),
            ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
          },
          protocol: { agui: protocol.typed },
        }),
        protocol: { agui: protocol.json },
      };
    }
    case "SUBAGENT_ERROR": {
      const protocol = protocolMetadata(event);
      if (protocol === undefined) return nonJsonRequirement();
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.invocation.failed", {
          invocation: {
            subagentRunId: event.subagentRunId,
            message: event.message,
            ...(event.code === undefined ? {} : { code: event.code }),
          },
          protocol: { agui: protocol.typed },
        }),
        protocol: { agui: protocol.json },
      };
    }
  }
}

function protocolFromNative(event: AgUiNativeInvocationAnyRecord): JsonObject {
  const protocol = event.data.protocol.agui;
  const jsonProtocol = toJsonObject(protocol);
  if (jsonProtocol === undefined) {
    throw new TypeError("native invocation event has non-JSON AG-UI protocol metadata");
  }
  return jsonProtocol;
}

function requireProtocolHeader(
  protocol: JsonObject,
  eventType: AgUiInvocationEventType,
): Record<string, unknown> {
  const record = protocol;
  requireLiteral(record.name, AG_UI_PROTOCOL_NAME, "protocol.agui.name");
  requireLiteral(record.version, AG_UI_PROTOCOL_VERSION, "protocol.agui.version");
  requireLiteral(record.eventType, eventType, "protocol.agui.eventType");
  return record;
}

function reservedExtensions(record: Record<string, unknown>, knownFields: ReadonlySet<string>) {
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

function startedParentFields(record: Record<string, unknown>): Record<string, string> {
  const attribution = record.attribution;
  if (attribution === undefined) return {};
  const attributionRecord = requireRecord(attribution, "protocol.agui.attribution");
  const parent = attributionRecord.parent;
  if (parent === undefined) return {};
  const parentRecord = requireRecord(parent, "protocol.agui.attribution.parent");
  const invocation = parentRecord.invocation === undefined
    ? undefined
    : requireRecord(parentRecord.invocation, "protocol.agui.attribution.parent.invocation");
  const tool = parentRecord.tool === undefined
    ? undefined
    : requireRecord(parentRecord.tool, "protocol.agui.attribution.parent.tool");
  const message = parentRecord.message === undefined
    ? undefined
    : requireRecord(parentRecord.message, "protocol.agui.attribution.parent.message");
  return {
    ...(invocation === undefined ? {} : {
      parentSubagentRunId: requireStringValue(
        invocation.subagentRunId,
        "protocol.agui.attribution.parent.invocation.subagentRunId",
      ),
    }),
    ...(tool === undefined ? {} : {
      parentToolCallId: requireStringValue(
        tool.toolCallId,
        "protocol.agui.attribution.parent.tool.toolCallId",
      ),
    }),
    ...(message === undefined ? {} : {
      parentMessageId: requireStringValue(
        message.messageId,
        "protocol.agui.attribution.parent.message.messageId",
      ),
    }),
  };
}

function aguiBase(
  record: Record<string, unknown>,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> {
  return {
    ...(reservedExtensions(record, knownFields) ?? {}),
    ...(record.timestamp === undefined
      ? {}
      : { timestamp: optionalNumber(record.timestamp, "protocol.agui.timestamp") }),
    ...(record.rawEvent === undefined ? {} : { rawEvent: record.rawEvent }),
    ...(record.metadata === undefined
      ? {}
      : { metadata: requireRecord(record.metadata, "protocol.agui.metadata") }),
  };
}

function validateProjectedAgUi(event: Record<string, unknown>): AgUiInvocationSupportedEvent {
  const result = safeParseAgUiEvent(event);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid AG-UI invocation event");
  }
  return supportedAgUiEvent(result.data);
}

function projectedStarted(
  event: AgUiNativeInvocationRecord<"com.veryfront.invocation.started">,
) {
  const protocol = protocolFromNative(event);
  const record = requireProtocolHeader(protocol, "SUBAGENT_STARTED");
  const candidate = validateProjectedAgUi({
    ...aguiBase(record, KNOWN_SUBAGENT_STARTED_FIELDS),
    ...startedParentFields(record),
    type: "SUBAGENT_STARTED",
    subagentRunId: event.data.invocation.subagentRunId,
    name: event.data.invocation.name,
    ...(event.data.invocation.description === undefined
      ? {}
      : { description: event.data.invocation.description }),
  });
  if (candidate.type !== "SUBAGENT_STARTED") {
    throw new TypeError("protocol.agui.eventType did not produce SUBAGENT_STARTED");
  }
  return candidate;
}

function projectedFinished(
  event:
    | AgUiNativeInvocationRecord<"com.veryfront.invocation.succeeded">
    | AgUiNativeInvocationRecord<"com.veryfront.invocation.paused">,
) {
  const protocol = protocolFromNative(event);
  requireProtocolHeader(protocol, "SUBAGENT_FINISHED");
  const candidate = validateProjectedAgUi({
    ...aguiBase(protocol, KNOWN_SUBAGENT_FINISHED_FIELDS),
    type: "SUBAGENT_FINISHED",
    subagentRunId: event.data.invocation.subagentRunId,
    ...(event.data.invocation.result === undefined ? {} : { result: event.data.invocation.result }),
    ...(event.data.invocation.outcome === undefined
      ? {}
      : { outcome: event.data.invocation.outcome }),
  });
  if (candidate.type !== "SUBAGENT_FINISHED") {
    throw new TypeError("protocol.agui.eventType did not produce SUBAGENT_FINISHED");
  }
  if (event.type === "com.veryfront.invocation.paused" && candidate.outcome?.type !== "suspended") {
    throw new TypeError("invocation.paused requires SUBAGENT_FINISHED suspended outcome metadata");
  }
  if (
    event.type === "com.veryfront.invocation.succeeded" &&
    candidate.outcome?.type === "suspended"
  ) {
    throw new TypeError("invocation.succeeded cannot carry suspended outcome metadata");
  }
  return candidate;
}

function projectedFailed(event: AgUiNativeInvocationRecord<"com.veryfront.invocation.failed">) {
  const protocol = protocolFromNative(event);
  requireProtocolHeader(protocol, "SUBAGENT_ERROR");
  const candidate = validateProjectedAgUi({
    ...aguiBase(protocol, KNOWN_SUBAGENT_ERROR_FIELDS),
    type: "SUBAGENT_ERROR",
    subagentRunId: event.data.invocation.subagentRunId,
    message: event.data.invocation.message,
    ...(event.data.invocation.code === undefined ? {} : { code: event.data.invocation.code }),
  });
  if (candidate.type !== "SUBAGENT_ERROR") {
    throw new TypeError("protocol.agui.eventType did not produce SUBAGENT_ERROR");
  }
  return candidate;
}

export function parseNativeInvocationEvent(input: unknown): AgUiNativeInvocationAnyRecord {
  const event = parseNativeInvocationRecord(input);
  const agui = projectNativeInvocationEvent({ event });
  const projected = projectAgUiInvocationEvent({
    event: agui,
    context: {
      occurrence: {
        source: event.source,
        id: event.id,
        ...(event.time === undefined ? {} : { time: event.time }),
        ...(event.recordedat === undefined ? {} : { recordedat: event.recordedat }),
      },
      ...(event.runid === undefined ? {} : { runid: event.runid }),
      ...(event.runkind === undefined ? {} : { runkind: event.runkind }),
      ...(event.conversationid === undefined ? {} : { conversationid: event.conversationid }),
      ...(event.subject === undefined ? {} : { subject: event.subject }),
      ...(event.traceparent === undefined ? {} : { traceparent: event.traceparent }),
      ...(event.tracestate === undefined ? {} : { tracestate: event.tracestate }),
    },
  });
  if (projected.kind !== "canonical-event") throw new TypeError(projected.message);
  if (projected.event.type !== event.type) {
    throw new TypeError(`${event.type} does not match AG-UI protocol metadata`);
  }
  return event;
}

export function projectNativeInvocationEvent(
  input: ProjectNativeInvocationInput,
): AgUiInvocationSupportedEvent {
  const event = parseNativeInvocationRecord(input.event);
  switch (event.type) {
    case "com.veryfront.invocation.started":
      return projectedStarted(event);
    case "com.veryfront.invocation.succeeded":
    case "com.veryfront.invocation.paused":
      return projectedFinished(event);
    case "com.veryfront.invocation.failed":
      return projectedFailed(event);
  }
}

export function createGeneratedInvocationFrame(event: unknown): AgUiGeneratedInvocationFrame {
  const agui = supportedAgUiEvent(event);
  const protocol = protocolMetadata(agui);
  if (protocol === undefined) {
    throw new TypeError(
      "AG-UI invocation metadata contains a value that cannot be preserved inside JSON.",
    );
  }
  return {
    kind: "generated-read-frame",
    event: agui,
    protocol: { agui: protocol.json },
  };
}

import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import { assertEventSchemaValidator, getEventSchemaValidatorVersion } from "../schema-validator.ts";
import type { JsonObject } from "../types.ts";
import {
  AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA,
  AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE,
} from "./native-signal-contract.ts";
import type {
  AgUiNativeSignalAnyRecord,
  AgUiNativeSignalRecord,
  AgUiNativeSignalType,
  AgUiSignalEventType,
} from "./native-signal-types.generated.ts";
import { parseAgUiEvent, safeParseAgUiEvent } from "./parser.ts";
import type { AgUiEventOf } from "./types.ts";
export {
  AG_UI_NATIVE_SIGNAL_JSON_SCHEMA,
  AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA,
  AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE,
  AG_UI_NATIVE_SIGNAL_SCHEMA_ID,
  AG_UI_NATIVE_SIGNAL_TYPES,
} from "./native-signal-contract.ts";
export type {
  AgUiNativeSignalAnyPayload,
  AgUiNativeSignalAnyRecord,
  AgUiNativeSignalDataschema,
  AgUiNativeSignalPayload,
  AgUiNativeSignalPayloadByType,
  AgUiNativeSignalRecord,
  AgUiNativeSignalType,
  AgUiSignalAttribution,
  AgUiSignalEventByType,
  AgUiSignalEventType,
  AgUiSignalProtocolMetadata,
} from "./native-signal-types.generated.ts";

const AG_UI_PROTOCOL_NAME = "ag-ui";
const AG_UI_PROTOCOL_VERSION = "1.0";

export type AgUiSignalSupportedEvent = AgUiEventOf<"RAW"> | AgUiEventOf<"CUSTOM">;

export interface AgUiSignalOccurrence {
  readonly source: string;
  readonly id: string;
  readonly time?: string;
  readonly recordedat?: string;
}

export interface AgUiSignalProjectionContext {
  readonly occurrence: AgUiSignalOccurrence;
  readonly runid?: string;
  readonly runkind?: "agent" | "workflow" | "task";
  readonly conversationid?: string;
  readonly subject?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface AgUiGeneratedSignalFrame {
  readonly kind: "generated-read-frame";
  readonly event: AgUiSignalSupportedEvent;
  readonly protocol: {
    readonly agui: JsonObject;
  };
}

export interface ProjectAgUiSignalInput {
  readonly event: unknown;
  readonly context: AgUiSignalProjectionContext;
}

export interface ProjectNativeSignalInput {
  readonly event: unknown;
}

export type AgUiSignalProjectionCommand =
  | {
    readonly kind: "canonical-event";
    readonly event: AgUiNativeSignalAnyRecord;
    readonly protocol: {
      readonly agui: JsonObject;
    };
  }
  | {
    readonly kind: "missing-fact-requirement";
    readonly reason: "non-json-protocol-signal";
    readonly message: string;
    readonly protocol?: {
      readonly agui: JsonObject;
    };
  };

const KNOWN_RAW_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "event",
  "source",
]);
const KNOWN_CUSTOM_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "name",
  "value",
]);

let compiledValidator: JsonSchemaValidationFunction<AgUiNativeSignalAnyRecord> | undefined;
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

function toJsonObject(value: unknown): JsonObject | undefined {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) return undefined;
  const { value: snapshotValue } = snapshot;
  return isRecord(snapshotValue) ? snapshotValue : undefined;
}

function isPromiseLikeValidationResult(
  value:
    | JsonSchemaValidationResult<AgUiNativeSignalAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeSignalAnyRecord>>,
): value is PromiseLike<JsonSchemaValidationResult<AgUiNativeSignalAnyRecord>> {
  return "then" in value && typeof value.then === "function";
}

function validationResultSync(
  result:
    | JsonSchemaValidationResult<AgUiNativeSignalAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeSignalAnyRecord>>,
): JsonSchemaValidationResult<AgUiNativeSignalAnyRecord> {
  if (isPromiseLikeValidationResult(result)) {
    throw new TypeError("AG-UI native signal requires a synchronous JSON Schema validator");
  }
  return result;
}

function validator(): JsonSchemaValidationFunction<AgUiNativeSignalAnyRecord> {
  const version = getEventSchemaValidatorVersion();
  if (compiledValidator && compiledValidatorVersion === version) return compiledValidator;
  const schemaValidator = assertEventSchemaValidator();
  if (!schemaValidator.compileJsonSchema) {
    throw new TypeError("AG-UI native signal requires compileJsonSchema support");
  }
  compiledValidator = schemaValidator.compileJsonSchema<AgUiNativeSignalAnyRecord>(
    AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA,
  );
  compiledValidatorVersion = version;
  return compiledValidator;
}

export function parseNativeSignalRecord(input: unknown): AgUiNativeSignalAnyRecord {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) {
    throw new TypeError("native signal event must be bounded data-only JSON");
  }
  const result = validationResultSync(validator()(snapshot.value));
  if (!result.success) {
    const first = result.errors[0];
    const suffix = first?.message ? `: ${first.message}` : "";
    throw new TypeError(`Invalid native signal event${suffix}`);
  }
  return result.value;
}

function supportedAgUiEvent(input: unknown): AgUiSignalSupportedEvent {
  const event = parseAgUiEvent(input);
  switch (event.type) {
    case "RAW":
    case "CUSTOM":
      return event;
    default:
      throw new TypeError(`${event.type} is not an AG-UI signal event`);
  }
}

function nonJsonInputRequirement(input: unknown): AgUiSignalProjectionCommand | undefined {
  if (!isRecord(input)) return undefined;
  const typeDescriptor = Reflect.getOwnPropertyDescriptor(input, "type");
  if (!typeDescriptor || !("value" in typeDescriptor)) return undefined;
  if (typeDescriptor.value !== "RAW" && typeDescriptor.value !== "CUSTOM") return undefined;
  const snapshot = snapshotBoundedJsonValue(input);
  return snapshot.success ? undefined : nonJsonRequirement();
}

function extensionFields(
  event: AgUiSignalSupportedEvent,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  const entries = Object.entries(event).filter(([key]) => !knownFields.has(key));
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

function baseProtocolMetadata(
  event: AgUiSignalSupportedEvent,
  knownFields: ReadonlySet<string>,
): Record<string, unknown> {
  const extensionData = extensionFields(event, knownFields);
  return {
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
  };
}

function protocolMetadata(event: AgUiSignalSupportedEvent): JsonObject | undefined {
  switch (event.type) {
    case "RAW":
      return toJsonObject(baseProtocolMetadata(event, KNOWN_RAW_FIELDS));
    case "CUSTOM":
      return toJsonObject(baseProtocolMetadata(event, KNOWN_CUSTOM_FIELDS));
  }
}

function validateContext(context: AgUiSignalProjectionContext): AgUiSignalProjectionContext {
  requireString(context.occurrence.source, "signal occurrence source");
  requireString(context.occurrence.id, "signal occurrence id");
  optionalString(context.occurrence.time, "signal occurrence time");
  optionalString(context.occurrence.recordedat, "signal occurrence recordedat");
  optionalString(context.runid, "signal runid");
  optionalString(context.conversationid, "signal conversationid");
  optionalString(context.subject, "signal subject");
  optionalString(context.traceparent, "signal traceparent");
  optionalString(context.tracestate, "signal tracestate");
  return context;
}

function recordEnvelope(
  context: AgUiSignalProjectionContext,
  type: AgUiNativeSignalType,
  data: unknown,
): AgUiNativeSignalAnyRecord {
  const candidate = {
    specversion: "1.0",
    id: context.occurrence.id,
    source: context.occurrence.source,
    type,
    datacontenttype: "application/json",
    dataschema: AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE[type],
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
  const parsed = parseNativeSignalRecord(candidate);
  if (parsed.type !== type) {
    throw new TypeError(`validated signal type ${parsed.type} did not match ${type}`);
  }
  return parsed;
}

function nonJsonRequirement(): AgUiSignalProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    reason: "non-json-protocol-signal",
    message:
      "AG-UI RAW/CUSTOM signal contains a value that cannot be preserved inside the JSON native payload.",
  };
}

export function projectAgUiSignalEvent(input: ProjectAgUiSignalInput): AgUiSignalProjectionCommand {
  let event: AgUiSignalSupportedEvent;
  try {
    event = supportedAgUiEvent(input.event);
  } catch (error) {
    const requirement = nonJsonInputRequirement(input.event);
    if (requirement) return requirement;
    throw error;
  }
  const context = validateContext(input.context);
  const protocol = protocolMetadata(event);
  if (protocol === undefined) return nonJsonRequirement();

  switch (event.type) {
    case "RAW":
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.signal.raw.recorded", {
          signal: {
            event: event.event,
            ...(event.source === undefined ? {} : { source: event.source }),
          },
          protocol: { agui: protocol },
        }),
        protocol: { agui: protocol },
      };
    case "CUSTOM":
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.signal.custom.recorded", {
          signal: { name: event.name, value: event.value },
          protocol: { agui: protocol },
        }),
        protocol: { agui: protocol },
      };
  }
}

function protocolFromNative(event: AgUiNativeSignalAnyRecord): JsonObject {
  const protocol = event.data.protocol.agui;
  const jsonProtocol = toJsonObject(protocol);
  if (jsonProtocol === undefined) {
    throw new TypeError("native signal event has non-JSON AG-UI protocol metadata");
  }
  return jsonProtocol;
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

function aguiBase(record: Record<string, unknown>, knownFields: ReadonlySet<string>) {
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

function requireProtocolHeader(
  protocol: JsonObject,
  eventType: AgUiSignalEventType,
): Record<string, unknown> {
  const record = protocol;
  requireLiteral(record.name, AG_UI_PROTOCOL_NAME, "protocol.agui.name");
  requireLiteral(record.version, AG_UI_PROTOCOL_VERSION, "protocol.agui.version");
  requireLiteral(record.eventType, eventType, "protocol.agui.eventType");
  return record;
}

function validateProjectedAgUi(event: Record<string, unknown>): AgUiSignalSupportedEvent {
  const result = safeParseAgUiEvent(event);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid AG-UI signal event");
  }
  return supportedAgUiEvent(result.data);
}

function projectedRaw(event: AgUiNativeSignalRecord<"com.veryfront.signal.raw.recorded">) {
  const protocol = protocolFromNative(event);
  const record = requireProtocolHeader(protocol, "RAW");
  const candidate = validateProjectedAgUi({
    ...aguiBase(record, KNOWN_RAW_FIELDS),
    type: "RAW",
    event: event.data.signal.event,
    ...(event.data.signal.source === undefined ? {} : { source: event.data.signal.source }),
  });
  if (candidate.type !== "RAW") {
    throw new TypeError("protocol.agui.eventType did not produce RAW");
  }
  return candidate;
}

function projectedCustom(event: AgUiNativeSignalRecord<"com.veryfront.signal.custom.recorded">) {
  const protocol = protocolFromNative(event);
  const record = requireProtocolHeader(protocol, "CUSTOM");
  const candidate = validateProjectedAgUi({
    ...aguiBase(record, KNOWN_CUSTOM_FIELDS),
    type: "CUSTOM",
    name: event.data.signal.name,
    value: event.data.signal.value,
  });
  if (candidate.type !== "CUSTOM") {
    throw new TypeError("protocol.agui.eventType did not produce CUSTOM");
  }
  return candidate;
}

export function parseNativeSignalEvent(input: unknown): AgUiNativeSignalAnyRecord {
  const event = parseNativeSignalRecord(input);
  const agui = projectNativeSignalEvent({ event });
  const projected = projectAgUiSignalEvent({
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

export function projectNativeSignalEvent(
  input: ProjectNativeSignalInput,
): AgUiSignalSupportedEvent {
  const event = parseNativeSignalRecord(input.event);
  switch (event.type) {
    case "com.veryfront.signal.raw.recorded":
      return projectedRaw(event);
    case "com.veryfront.signal.custom.recorded":
      return projectedCustom(event);
  }
}

export function createGeneratedSignalFrame(event: unknown): AgUiGeneratedSignalFrame {
  const agui = supportedAgUiEvent(event);
  const protocol = protocolMetadata(agui);
  if (protocol === undefined) {
    throw new TypeError(
      "AG-UI RAW/CUSTOM signal contains a value that cannot be preserved inside JSON.",
    );
  }
  return {
    kind: "generated-read-frame",
    event: agui,
    protocol: { agui: protocol },
  };
}

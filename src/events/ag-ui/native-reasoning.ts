import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  aguiBase,
  baseProtocolMetadata,
  nativeContextFields,
  nativeOccurrenceFields,
  optionalString,
  requireLiteral,
  requireString,
  toJsonObject,
} from "#veryfront/events/ag-ui/native-profile-helpers.ts";
import type {
  JsonSchemaValidationFunction,
  JsonSchemaValidationResult,
} from "#veryfront/extensions/schema/index.ts";
import {
  assertEventSchemaValidator,
  getEventSchemaValidatorVersion,
} from "#veryfront/events/schema-validator.ts";
import type { JsonObject } from "#veryfront/events/types.ts";
import { parseAgUiEvent, safeParseAgUiEvent } from "#veryfront/events/ag-ui/parser.ts";
import {
  AG_UI_NATIVE_REASONING_RECORD_SCHEMA,
  AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE,
} from "#veryfront/events/ag-ui/native-reasoning-contract.ts";
import type {
  AgUiNativeReasoningAnyRecord,
  AgUiNativeReasoningRecord,
  AgUiNativeReasoningType,
  AgUiReasoningEventType,
} from "#veryfront/events/ag-ui/native-reasoning-types.generated.ts";
import type { AgUiEventOf } from "#veryfront/events/ag-ui/types.ts";
export {
  AG_UI_NATIVE_REASONING_JSON_SCHEMA,
  AG_UI_NATIVE_REASONING_RECORD_SCHEMA,
  AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE,
  AG_UI_NATIVE_REASONING_SCHEMA_ID,
  AG_UI_NATIVE_REASONING_TYPES,
} from "#veryfront/events/ag-ui/native-reasoning-contract.ts";
export type {
  AgUiNativeReasoningAnyPayload,
  AgUiNativeReasoningAnyRecord,
  AgUiNativeReasoningDataschema,
  AgUiNativeReasoningPayload,
  AgUiNativeReasoningPayloadByType,
  AgUiNativeReasoningRecord,
  AgUiNativeReasoningType,
  AgUiReasoningAttribution,
  AgUiReasoningEventByType,
  AgUiReasoningEventType,
  AgUiReasoningProtocolMetadata,
} from "#veryfront/events/ag-ui/native-reasoning-types.generated.ts";

const AG_UI_PROTOCOL_NAME = "ag-ui";
const AG_UI_PROTOCOL_VERSION = "1.0";

export type AgUiReasoningSupportedEvent =
  | AgUiEventOf<"REASONING_START">
  | AgUiEventOf<"REASONING_END">
  | AgUiEventOf<"REASONING_ENCRYPTED_VALUE">;

export interface AgUiReasoningOccurrence {
  readonly source: string;
  readonly id: string;
  readonly time?: string;
  readonly recordedat?: string;
}

export interface AgUiReasoningProjectionContext {
  readonly occurrence: AgUiReasoningOccurrence;
  readonly runid?: string;
  readonly runkind?: "agent" | "workflow" | "task";
  readonly conversationid?: string;
  readonly subject?: string;
  readonly traceparent?: string;
  readonly tracestate?: string;
}

export interface AgUiGeneratedReasoningFrame {
  readonly kind: "generated-read-frame";
  readonly event: AgUiReasoningSupportedEvent;
  readonly protocol: {
    readonly agui: JsonObject;
  };
}

export interface ProjectAgUiReasoningInput {
  readonly event: unknown;
  readonly context: AgUiReasoningProjectionContext;
}

export interface ProjectNativeReasoningInput {
  readonly event: unknown;
}

export type AgUiReasoningProjectionCommand =
  | {
    readonly kind: "canonical-event";
    readonly event: AgUiNativeReasoningAnyRecord;
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

const KNOWN_REASONING_START_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "messageId",
]);
const KNOWN_REASONING_END_FIELDS = KNOWN_REASONING_START_FIELDS;
const KNOWN_REASONING_ENCRYPTED_VALUE_FIELDS = new Set([
  "type",
  "timestamp",
  "rawEvent",
  "metadata",
  "subagentRunId",
  "subtype",
  "entityId",
  "encryptedValue",
]);

let compiledValidator: JsonSchemaValidationFunction<AgUiNativeReasoningAnyRecord> | undefined;
let compiledValidatorVersion = -1;

function isPromiseLikeValidationResult(
  value:
    | JsonSchemaValidationResult<AgUiNativeReasoningAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeReasoningAnyRecord>>,
): value is PromiseLike<JsonSchemaValidationResult<AgUiNativeReasoningAnyRecord>> {
  return "then" in value && typeof value.then === "function";
}

function validationResultSync(
  result:
    | JsonSchemaValidationResult<AgUiNativeReasoningAnyRecord>
    | PromiseLike<JsonSchemaValidationResult<AgUiNativeReasoningAnyRecord>>,
): JsonSchemaValidationResult<AgUiNativeReasoningAnyRecord> {
  if (isPromiseLikeValidationResult(result)) {
    throw new TypeError("AG-UI native reasoning requires a synchronous JSON Schema validator");
  }
  return result;
}

function validator(): JsonSchemaValidationFunction<AgUiNativeReasoningAnyRecord> {
  const version = getEventSchemaValidatorVersion();
  if (compiledValidator && compiledValidatorVersion === version) return compiledValidator;
  const schemaValidator = assertEventSchemaValidator();
  if (!schemaValidator.compileJsonSchema) {
    throw new TypeError("AG-UI native reasoning requires compileJsonSchema support");
  }
  compiledValidator = schemaValidator.compileJsonSchema<AgUiNativeReasoningAnyRecord>(
    AG_UI_NATIVE_REASONING_RECORD_SCHEMA,
  );
  compiledValidatorVersion = version;
  return compiledValidator;
}

export function parseNativeReasoningRecord(input: unknown): AgUiNativeReasoningAnyRecord {
  const snapshot = snapshotBoundedJsonValue(input);
  if (!snapshot.success) {
    throw new TypeError("native reasoning event must be bounded data-only JSON");
  }
  const result = validationResultSync(validator()(snapshot.value));
  if (!result.success) {
    const first = result.errors[0];
    const suffix = first?.message ? `: ${first.message}` : "";
    throw new TypeError(`Invalid native reasoning event${suffix}`);
  }
  return result.value;
}

function supportedAgUiEvent(input: unknown): AgUiReasoningSupportedEvent {
  const event = parseAgUiEvent(input);
  switch (event.type) {
    case "REASONING_START":
    case "REASONING_END":
    case "REASONING_ENCRYPTED_VALUE":
      return event;
    default:
      throw new TypeError(`${event.type} is not an AG-UI reasoning event`);
  }
}

function protocolMetadata(event: AgUiReasoningSupportedEvent): JsonObject | undefined {
  switch (event.type) {
    case "REASONING_START":
      return toJsonObject(baseProtocolMetadata(event, KNOWN_REASONING_START_FIELDS));
    case "REASONING_END":
      return toJsonObject(baseProtocolMetadata(event, KNOWN_REASONING_END_FIELDS));
    case "REASONING_ENCRYPTED_VALUE":
      return toJsonObject(baseProtocolMetadata(event, KNOWN_REASONING_ENCRYPTED_VALUE_FIELDS));
  }
}

function validateContext(context: AgUiReasoningProjectionContext): AgUiReasoningProjectionContext {
  requireString(context.occurrence.source, "reasoning occurrence source");
  requireString(context.occurrence.id, "reasoning occurrence id");
  optionalString(context.occurrence.time, "reasoning occurrence time");
  optionalString(context.occurrence.recordedat, "reasoning occurrence recordedat");
  optionalString(context.runid, "reasoning runid");
  optionalString(context.conversationid, "reasoning conversationid");
  optionalString(context.subject, "reasoning subject");
  optionalString(context.traceparent, "reasoning traceparent");
  optionalString(context.tracestate, "reasoning tracestate");
  return context;
}

function recordEnvelope(
  context: AgUiReasoningProjectionContext,
  type: AgUiNativeReasoningType,
  data: unknown,
): AgUiNativeReasoningAnyRecord {
  const candidate = {
    specversion: "1.0",
    id: context.occurrence.id,
    source: context.occurrence.source,
    type,
    datacontenttype: "application/json",
    dataschema: AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE[type],
    data,
    ...(context.runid === undefined ? {} : { runid: context.runid }),
    ...(context.occurrence.time === undefined ? {} : { time: context.occurrence.time }),
    ...(context.occurrence.recordedat === undefined
      ? {}
      : { recordedat: context.occurrence.recordedat }),
    ...nativeContextFields(context),
  };
  const parsed = parseNativeReasoningRecord(candidate);
  if (parsed.type !== type) {
    throw new TypeError(`validated reasoning type ${parsed.type} did not match ${type}`);
  }
  return parsed;
}

function nonJsonRequirement(): AgUiReasoningProjectionCommand {
  return {
    kind: "missing-fact-requirement",
    reason: "non-json-protocol-metadata",
    message:
      "AG-UI reasoning metadata contains a value that cannot be preserved inside the JSON native payload protocol metadata.",
  };
}

export function projectAgUiReasoningEvent(
  input: ProjectAgUiReasoningInput,
): AgUiReasoningProjectionCommand {
  const event = supportedAgUiEvent(input.event);
  const context = validateContext(input.context);
  const protocol = protocolMetadata(event);
  if (protocol === undefined) return nonJsonRequirement();

  switch (event.type) {
    case "REASONING_START":
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.reasoning.context.started", {
          context: { messageId: event.messageId },
          protocol: { agui: protocol },
        }),
        protocol: { agui: protocol },
      };
    case "REASONING_END":
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.reasoning.context.ended", {
          context: { messageId: event.messageId },
          protocol: { agui: protocol },
        }),
        protocol: { agui: protocol },
      };
    case "REASONING_ENCRYPTED_VALUE":
      return {
        kind: "canonical-event",
        event: recordEnvelope(context, "com.veryfront.reasoning.continuation.recorded", {
          continuation: {
            subtype: event.subtype,
            entityId: event.entityId,
            encryptedValue: event.encryptedValue,
          },
          protocol: { agui: protocol },
        }),
        protocol: { agui: protocol },
      };
  }
}

function protocolFromNative(event: AgUiNativeReasoningAnyRecord): JsonObject {
  const protocol = event.data.protocol.agui;
  const jsonProtocol = toJsonObject(protocol);
  if (jsonProtocol === undefined) {
    throw new TypeError("native reasoning event has non-JSON AG-UI protocol metadata");
  }
  return jsonProtocol;
}

function requireProtocolHeader(
  protocol: JsonObject,
  eventType: AgUiReasoningEventType,
): Record<string, unknown> {
  const record = protocol;
  requireLiteral(record.name, AG_UI_PROTOCOL_NAME, "protocol.agui.name");
  requireLiteral(record.version, AG_UI_PROTOCOL_VERSION, "protocol.agui.version");
  requireLiteral(record.eventType, eventType, "protocol.agui.eventType");
  return record;
}

function validateProjectedAgUi(event: Record<string, unknown>): AgUiReasoningSupportedEvent {
  const result = safeParseAgUiEvent(event);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid AG-UI reasoning event");
  }
  return supportedAgUiEvent(result.data);
}

function projectedStart(
  event: AgUiNativeReasoningRecord<"com.veryfront.reasoning.context.started">,
) {
  const protocol = protocolFromNative(event);
  const record = requireProtocolHeader(protocol, "REASONING_START");
  const candidate = validateProjectedAgUi({
    ...aguiBase(record, KNOWN_REASONING_START_FIELDS),
    type: "REASONING_START",
    messageId: event.data.context.messageId,
  });
  if (candidate.type !== "REASONING_START") {
    throw new TypeError("protocol.agui.eventType did not produce REASONING_START");
  }
  return candidate;
}

function projectedEnd(event: AgUiNativeReasoningRecord<"com.veryfront.reasoning.context.ended">) {
  const protocol = protocolFromNative(event);
  const record = requireProtocolHeader(protocol, "REASONING_END");
  const candidate = validateProjectedAgUi({
    ...aguiBase(record, KNOWN_REASONING_END_FIELDS),
    type: "REASONING_END",
    messageId: event.data.context.messageId,
  });
  if (candidate.type !== "REASONING_END") {
    throw new TypeError("protocol.agui.eventType did not produce REASONING_END");
  }
  return candidate;
}

function projectedContinuation(
  event: AgUiNativeReasoningRecord<"com.veryfront.reasoning.continuation.recorded">,
) {
  const protocol = protocolFromNative(event);
  const record = requireProtocolHeader(protocol, "REASONING_ENCRYPTED_VALUE");
  const candidate = validateProjectedAgUi({
    ...aguiBase(record, KNOWN_REASONING_ENCRYPTED_VALUE_FIELDS),
    type: "REASONING_ENCRYPTED_VALUE",
    subtype: event.data.continuation.subtype,
    entityId: event.data.continuation.entityId,
    encryptedValue: event.data.continuation.encryptedValue,
  });
  if (candidate.type !== "REASONING_ENCRYPTED_VALUE") {
    throw new TypeError("protocol.agui.eventType did not produce REASONING_ENCRYPTED_VALUE");
  }
  return candidate;
}

export function parseNativeReasoningEvent(input: unknown): AgUiNativeReasoningAnyRecord {
  const event = parseNativeReasoningRecord(input);
  const agui = projectNativeReasoningEvent({ event });
  const projected = projectAgUiReasoningEvent({
    event: agui,
    context: {
      occurrence: nativeOccurrenceFields(event),
      ...(event.runid === undefined ? {} : { runid: event.runid }),
      ...nativeContextFields(event),
    },
  });
  if (projected.kind !== "canonical-event") throw new TypeError(projected.message);
  if (projected.event.type !== event.type) {
    throw new TypeError(`${event.type} does not match AG-UI protocol metadata`);
  }
  return event;
}

export function projectNativeReasoningEvent(
  input: ProjectNativeReasoningInput,
): AgUiReasoningSupportedEvent {
  const event = parseNativeReasoningRecord(input.event);
  switch (event.type) {
    case "com.veryfront.reasoning.context.started":
      return projectedStart(event);
    case "com.veryfront.reasoning.context.ended":
      return projectedEnd(event);
    case "com.veryfront.reasoning.continuation.recorded":
      return projectedContinuation(event);
  }
}

export function createGeneratedReasoningFrame(event: unknown): AgUiGeneratedReasoningFrame {
  const agui = supportedAgUiEvent(event);
  const protocol = protocolMetadata(agui);
  if (protocol === undefined) {
    throw new TypeError(
      "AG-UI reasoning metadata contains a value that cannot be preserved inside JSON.",
    );
  }
  return {
    kind: "generated-read-frame",
    event: agui,
    protocol: { agui: protocol },
  };
}

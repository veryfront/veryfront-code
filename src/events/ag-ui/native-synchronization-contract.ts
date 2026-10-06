import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { AG_UI_EVENT_SCHEMA } from "./schema.ts";

export const AG_UI_NATIVE_SYNCHRONIZATION_TYPES = [
  "com.veryfront.synchronization.state.snapshot.recorded",
  "com.veryfront.synchronization.state.delta.recorded",
  "com.veryfront.synchronization.transcript.snapshot.recorded",
  "com.veryfront.synchronization.activity.snapshot.recorded",
  "com.veryfront.synchronization.activity.delta.recorded",
] as const;

export type AgUiNativeSynchronizationType = typeof AG_UI_NATIVE_SYNCHRONIZATION_TYPES[number];

export const AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID =
  "urn:veryfront:ag-ui:internal:synchronization:payloads:1";

export const AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE = {
  "com.veryfront.synchronization.state.snapshot.recorded":
    `${AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID}#/$defs/StateSnapshotRecorded`,
  "com.veryfront.synchronization.state.delta.recorded":
    `${AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID}#/$defs/StateDeltaRecorded`,
  "com.veryfront.synchronization.transcript.snapshot.recorded":
    `${AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID}#/$defs/TranscriptSnapshotRecorded`,
  "com.veryfront.synchronization.activity.snapshot.recorded":
    `${AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID}#/$defs/ActivitySnapshotRecorded`,
  "com.veryfront.synchronization.activity.delta.recorded":
    `${AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID}#/$defs/ActivityDeltaRecorded`,
} as const satisfies Record<AgUiNativeSynchronizationType, string>;

type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneSchema<T>(value: T): T {
  return structuredClone(value);
}

function eventSchema(type: string): SchemaRecord {
  const variants = AG_UI_EVENT_SCHEMA.oneOf;
  if (!Array.isArray(variants)) throw new TypeError("AG-UI event schema is missing oneOf");
  for (const variant of variants) {
    if (!isRecord(variant) || !isRecord(variant.properties)) continue;
    const typeProperty = variant.properties.type;
    if (isRecord(typeProperty) && typeProperty.const === type) return variant;
  }
  throw new TypeError(`Missing AG-UI event schema for ${type}`);
}

export function agUiEventPropertySchema(type: string, property: string): JsonSchema {
  const schema = eventSchema(type);
  const properties = schema.properties;
  if (!isRecord(properties) || !(property in properties)) {
    throw new TypeError(`Missing AG-UI schema property ${type}.${property}`);
  }
  return cloneSchema(properties[property]) as JsonSchema;
}

function protocolSchema(eventType: string): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["agui"],
    properties: {
      agui: {
        type: "object",
        additionalProperties: false,
        required: ["name", "version", "eventType"],
        properties: {
          name: { const: "ag-ui" },
          version: { const: "1.0" },
          eventType: { const: eventType },
          timestamp: agUiEventPropertySchema(eventType, "timestamp"),
          rawEvent: agUiEventPropertySchema(eventType, "rawEvent"),
          metadata: agUiEventPropertySchema(eventType, "metadata"),
          extensions: { type: "object", additionalProperties: true },
          attribution: {
            type: "object",
            additionalProperties: false,
            properties: {
              invocation: {
                type: "object",
                additionalProperties: false,
                required: ["subagentRunId"],
                properties: { subagentRunId: { type: "string" } },
              },
            },
          },
        },
      },
    },
  };
}

function payloadSchema(
  group: string,
  groupSchema: JsonSchema,
  eventType: string,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: [group, "protocol"],
    properties: {
      [group]: groupSchema,
      protocol: protocolSchema(eventType),
    },
  };
}

const stateSnapshot = payloadSchema(
  "state",
  {
    type: "object",
    additionalProperties: false,
    required: ["snapshot"],
    properties: { snapshot: agUiEventPropertySchema("STATE_SNAPSHOT", "snapshot") },
  },
  "STATE_SNAPSHOT",
);
const stateDelta = payloadSchema(
  "state",
  {
    type: "object",
    additionalProperties: false,
    required: ["delta"],
    properties: { delta: agUiEventPropertySchema("STATE_DELTA", "delta") },
  },
  "STATE_DELTA",
);
const transcriptSnapshot = payloadSchema(
  "transcript",
  {
    type: "object",
    additionalProperties: false,
    required: ["messages"],
    properties: { messages: agUiEventPropertySchema("MESSAGES_SNAPSHOT", "messages") },
  },
  "MESSAGES_SNAPSHOT",
);
const activitySnapshot = payloadSchema(
  "activity",
  {
    type: "object",
    additionalProperties: false,
    required: ["messageId", "activityType", "content"],
    properties: {
      messageId: agUiEventPropertySchema("ACTIVITY_SNAPSHOT", "messageId"),
      activityType: agUiEventPropertySchema("ACTIVITY_SNAPSHOT", "activityType"),
      content: agUiEventPropertySchema("ACTIVITY_SNAPSHOT", "content"),
      replace: agUiEventPropertySchema("ACTIVITY_SNAPSHOT", "replace"),
    },
  },
  "ACTIVITY_SNAPSHOT",
);
const activityDelta = payloadSchema(
  "activity",
  {
    type: "object",
    additionalProperties: false,
    required: ["messageId", "activityType", "patch"],
    properties: {
      messageId: agUiEventPropertySchema("ACTIVITY_DELTA", "messageId"),
      activityType: agUiEventPropertySchema("ACTIVITY_DELTA", "activityType"),
      patch: agUiEventPropertySchema("ACTIVITY_DELTA", "patch"),
    },
  },
  "ACTIVITY_DELTA",
);

export const AG_UI_NATIVE_SYNCHRONIZATION_JSON_SCHEMA = {
  $id: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Veryfront internal AG-UI synchronization payloads",
  description:
    "Internal, non-public synchronization contracts derived from pinned AG-UI 1.0.2 synchronization event schemas.",
  $defs: {
    StateSnapshotRecorded: stateSnapshot,
    StateDeltaRecorded: stateDelta,
    TranscriptSnapshotRecorded: transcriptSnapshot,
    ActivitySnapshotRecorded: activitySnapshot,
    ActivityDeltaRecorded: activityDelta,
  },
} as const satisfies JsonSchema;

function recordSchema<TType extends AgUiNativeSynchronizationType>(
  type: TType,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["specversion", "id", "source", "type", "dataschema", "datacontenttype", "data"],
    properties: {
      specversion: { const: "1.0" },
      id: { type: "string", minLength: 1 },
      source: { type: "string", minLength: 1 },
      type: { const: type },
      dataschema: { const: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[type] },
      datacontenttype: { const: "application/json" },
      data: { $ref: AG_UI_NATIVE_SYNCHRONIZATION_SCHEMA_BY_TYPE[type] },
    },
  };
}

export const AG_UI_NATIVE_SYNCHRONIZATION_RECORD_SCHEMA = {
  ...AG_UI_NATIVE_SYNCHRONIZATION_JSON_SCHEMA,
  oneOf: AG_UI_NATIVE_SYNCHRONIZATION_TYPES.map((type) => recordSchema(type)),
} as const satisfies JsonSchema;

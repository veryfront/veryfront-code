import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { agUiEventPropertySchema } from "./native-synchronization-contract.ts";

export const AG_UI_NATIVE_SIGNAL_TYPES = [
  "com.veryfront.signal.raw.recorded",
  "com.veryfront.signal.custom.recorded",
] as const;

export type AgUiNativeSignalType = typeof AG_UI_NATIVE_SIGNAL_TYPES[number];

export const AG_UI_NATIVE_SIGNAL_SCHEMA_ID = "urn:veryfront:ag-ui:internal:signals:payloads:1";

export const AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE = {
  "com.veryfront.signal.raw.recorded": `${AG_UI_NATIVE_SIGNAL_SCHEMA_ID}#/$defs/RawSignalRecorded`,
  "com.veryfront.signal.custom.recorded":
    `${AG_UI_NATIVE_SIGNAL_SCHEMA_ID}#/$defs/CustomSignalRecorded`,
} as const satisfies Record<AgUiNativeSignalType, string>;

type SignalAgUiEventType = "RAW" | "CUSTOM";

function protocolSchema(eventType: SignalAgUiEventType): JsonSchema {
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
  signalSchema: JsonSchema,
  eventType: SignalAgUiEventType,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["signal", "protocol"],
    properties: {
      signal: signalSchema,
      protocol: protocolSchema(eventType),
    },
  };
}

const rawSignalRecorded = payloadSchema(
  {
    type: "object",
    additionalProperties: false,
    required: ["event"],
    properties: {
      event: agUiEventPropertySchema("RAW", "event"),
      source: agUiEventPropertySchema("RAW", "source"),
    },
  },
  "RAW",
);

const customSignalRecorded = payloadSchema(
  {
    type: "object",
    additionalProperties: false,
    required: ["name", "value"],
    properties: {
      name: agUiEventPropertySchema("CUSTOM", "name"),
      value: agUiEventPropertySchema("CUSTOM", "value"),
    },
  },
  "CUSTOM",
);

export const AG_UI_NATIVE_SIGNAL_JSON_SCHEMA = {
  $id: AG_UI_NATIVE_SIGNAL_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Veryfront internal AG-UI signal payloads",
  description:
    "Internal, non-public RAW/CUSTOM signal contracts derived from pinned AG-UI 1.0.2 signal event schemas.",
  $defs: {
    RawSignalRecorded: rawSignalRecorded,
    CustomSignalRecorded: customSignalRecorded,
  },
} as const satisfies JsonSchema;

function recordSchema<TType extends AgUiNativeSignalType>(type: TType): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["specversion", "id", "source", "type", "dataschema", "datacontenttype", "data"],
    properties: {
      specversion: { const: "1.0" },
      id: { type: "string", minLength: 1 },
      source: { type: "string", minLength: 1 },
      type: { const: type },
      dataschema: { const: AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE[type] },
      datacontenttype: { const: "application/json" },
      data: { $ref: AG_UI_NATIVE_SIGNAL_SCHEMA_BY_TYPE[type] },
      runid: { type: "string", minLength: 1 },
      runkind: { enum: ["agent", "workflow", "task"] },
      conversationid: { type: "string" },
      subject: { type: "string" },
      time: { type: "string" },
      recordedat: { type: "string" },
      traceparent: { type: "string" },
      tracestate: { type: "string" },
    },
  };
}

export const AG_UI_NATIVE_SIGNAL_RECORD_SCHEMA = {
  ...AG_UI_NATIVE_SIGNAL_JSON_SCHEMA,
  oneOf: AG_UI_NATIVE_SIGNAL_TYPES.map((type) => recordSchema(type)),
} as const satisfies JsonSchema;

import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { agUiEventPropertySchema } from "./native-synchronization-contract.ts";

export const AG_UI_NATIVE_REASONING_TYPES = [
  "com.veryfront.reasoning.context.started",
  "com.veryfront.reasoning.context.ended",
  "com.veryfront.reasoning.continuation.recorded",
] as const;

export type AgUiNativeReasoningType = typeof AG_UI_NATIVE_REASONING_TYPES[number];

export const AG_UI_NATIVE_REASONING_SCHEMA_ID = "urn:veryfront:ag-ui:internal:reasoning:payloads:1";

export const AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE = {
  "com.veryfront.reasoning.context.started":
    `${AG_UI_NATIVE_REASONING_SCHEMA_ID}#/$defs/ReasoningContextStarted`,
  "com.veryfront.reasoning.context.ended":
    `${AG_UI_NATIVE_REASONING_SCHEMA_ID}#/$defs/ReasoningContextEnded`,
  "com.veryfront.reasoning.continuation.recorded":
    `${AG_UI_NATIVE_REASONING_SCHEMA_ID}#/$defs/ReasoningContinuationRecorded`,
} as const satisfies Record<AgUiNativeReasoningType, string>;

type ReasoningAgUiEventType =
  | "REASONING_START"
  | "REASONING_END"
  | "REASONING_ENCRYPTED_VALUE";

function protocolSchema(eventType: ReasoningAgUiEventType): JsonSchema {
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

function contextSchema(eventType: "REASONING_START" | "REASONING_END"): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["messageId"],
    properties: { messageId: agUiEventPropertySchema(eventType, "messageId") },
  };
}

function payloadSchema(
  group: "context" | "continuation",
  groupSchema: JsonSchema,
  eventType: ReasoningAgUiEventType,
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

const reasoningContextStarted = payloadSchema(
  "context",
  contextSchema("REASONING_START"),
  "REASONING_START",
);

const reasoningContextEnded = payloadSchema(
  "context",
  contextSchema("REASONING_END"),
  "REASONING_END",
);

const reasoningContinuationRecorded = payloadSchema(
  "continuation",
  {
    type: "object",
    additionalProperties: false,
    required: ["subtype", "entityId", "encryptedValue"],
    properties: {
      subtype: agUiEventPropertySchema("REASONING_ENCRYPTED_VALUE", "subtype"),
      entityId: agUiEventPropertySchema("REASONING_ENCRYPTED_VALUE", "entityId"),
      encryptedValue: agUiEventPropertySchema("REASONING_ENCRYPTED_VALUE", "encryptedValue"),
    },
  },
  "REASONING_ENCRYPTED_VALUE",
);

export const AG_UI_NATIVE_REASONING_JSON_SCHEMA = {
  $id: AG_UI_NATIVE_REASONING_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Veryfront internal AG-UI reasoning payloads",
  description:
    "Internal, non-public reasoning contracts derived from pinned AG-UI 1.0.2 reasoning event schemas.",
  $defs: {
    ReasoningContextStarted: reasoningContextStarted,
    ReasoningContextEnded: reasoningContextEnded,
    ReasoningContinuationRecorded: reasoningContinuationRecorded,
  },
} as const satisfies JsonSchema;

function recordSchema<TType extends AgUiNativeReasoningType>(type: TType): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["specversion", "id", "source", "type", "dataschema", "datacontenttype", "data"],
    properties: {
      specversion: { const: "1.0" },
      id: { type: "string", minLength: 1 },
      source: { type: "string", minLength: 1 },
      type: { const: type },
      dataschema: { const: AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE[type] },
      datacontenttype: { const: "application/json" },
      data: { $ref: AG_UI_NATIVE_REASONING_SCHEMA_BY_TYPE[type] },
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

export const AG_UI_NATIVE_REASONING_RECORD_SCHEMA = {
  ...AG_UI_NATIVE_REASONING_JSON_SCHEMA,
  oneOf: AG_UI_NATIVE_REASONING_TYPES.map((type) => recordSchema(type)),
} as const satisfies JsonSchema;

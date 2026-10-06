import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { agUiEventPropertySchema } from "./native-synchronization-contract.ts";

export const AG_UI_NATIVE_INVOCATION_TYPES = [
  "com.veryfront.invocation.started",
  "com.veryfront.invocation.succeeded",
  "com.veryfront.invocation.paused",
  "com.veryfront.invocation.failed",
] as const;

export type AgUiNativeInvocationType = typeof AG_UI_NATIVE_INVOCATION_TYPES[number];

export const AG_UI_NATIVE_INVOCATION_SCHEMA_ID =
  "urn:veryfront:ag-ui:internal:invocation:payloads:1";

export const AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE = {
  "com.veryfront.invocation.started":
    `${AG_UI_NATIVE_INVOCATION_SCHEMA_ID}#/$defs/InvocationStarted`,
  "com.veryfront.invocation.succeeded":
    `${AG_UI_NATIVE_INVOCATION_SCHEMA_ID}#/$defs/InvocationSucceeded`,
  "com.veryfront.invocation.paused": `${AG_UI_NATIVE_INVOCATION_SCHEMA_ID}#/$defs/InvocationPaused`,
  "com.veryfront.invocation.failed": `${AG_UI_NATIVE_INVOCATION_SCHEMA_ID}#/$defs/InvocationFailed`,
} as const satisfies Record<AgUiNativeInvocationType, string>;

type InvocationAgUiEventType = "SUBAGENT_STARTED" | "SUBAGENT_FINISHED" | "SUBAGENT_ERROR";
type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneSchema<T>(value: T): T {
  return structuredClone(value);
}

function subagentFinishedOutcomeBranch(type: "success" | "suspended"): SchemaRecord {
  const outcome = agUiEventPropertySchema("SUBAGENT_FINISHED", "outcome");
  if (!Array.isArray(outcome.oneOf)) {
    throw new TypeError("AG-UI SUBAGENT_FINISHED outcome schema is missing oneOf");
  }
  for (const branch of outcome.oneOf) {
    if (!isRecord(branch) || !isRecord(branch.properties)) continue;
    const typeProperty = branch.properties.type;
    if (isRecord(typeProperty) && typeProperty.const === type) return cloneSchema(branch);
  }
  throw new TypeError(`Missing AG-UI SUBAGENT_FINISHED ${type} outcome schema`);
}

function protocolSchema(eventType: InvocationAgUiEventType): JsonSchema {
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
              parent: {
                type: "object",
                additionalProperties: false,
                properties: {
                  invocation: {
                    type: "object",
                    additionalProperties: false,
                    required: ["subagentRunId"],
                    properties: {
                      subagentRunId: agUiEventPropertySchema(
                        "SUBAGENT_STARTED",
                        "parentSubagentRunId",
                      ),
                    },
                  },
                  tool: {
                    type: "object",
                    additionalProperties: false,
                    required: ["toolCallId"],
                    properties: {
                      toolCallId: agUiEventPropertySchema("SUBAGENT_STARTED", "parentToolCallId"),
                    },
                  },
                  message: {
                    type: "object",
                    additionalProperties: false,
                    required: ["messageId"],
                    properties: {
                      messageId: agUiEventPropertySchema("SUBAGENT_STARTED", "parentMessageId"),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function payloadSchema(
  invocationSchema: JsonSchema,
  eventType: InvocationAgUiEventType,
): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["invocation", "protocol"],
    properties: {
      invocation: invocationSchema,
      protocol: protocolSchema(eventType),
    },
  };
}

const invocationStarted = payloadSchema(
  {
    type: "object",
    additionalProperties: false,
    required: ["subagentRunId", "name"],
    properties: {
      subagentRunId: agUiEventPropertySchema("SUBAGENT_STARTED", "subagentRunId"),
      name: agUiEventPropertySchema("SUBAGENT_STARTED", "name"),
      description: agUiEventPropertySchema("SUBAGENT_STARTED", "description"),
    },
  },
  "SUBAGENT_STARTED",
);

const invocationSucceeded = payloadSchema(
  {
    type: "object",
    additionalProperties: false,
    required: ["subagentRunId"],
    properties: {
      subagentRunId: agUiEventPropertySchema("SUBAGENT_FINISHED", "subagentRunId"),
      result: agUiEventPropertySchema("SUBAGENT_FINISHED", "result"),
      outcome: subagentFinishedOutcomeBranch("success"),
    },
  },
  "SUBAGENT_FINISHED",
);

const invocationPaused = payloadSchema(
  {
    type: "object",
    additionalProperties: false,
    required: ["subagentRunId", "outcome"],
    properties: {
      subagentRunId: agUiEventPropertySchema("SUBAGENT_FINISHED", "subagentRunId"),
      result: agUiEventPropertySchema("SUBAGENT_FINISHED", "result"),
      outcome: subagentFinishedOutcomeBranch("suspended"),
    },
  },
  "SUBAGENT_FINISHED",
);

const invocationFailed = payloadSchema(
  {
    type: "object",
    additionalProperties: false,
    required: ["subagentRunId", "message"],
    properties: {
      subagentRunId: agUiEventPropertySchema("SUBAGENT_ERROR", "subagentRunId"),
      message: agUiEventPropertySchema("SUBAGENT_ERROR", "message"),
      code: agUiEventPropertySchema("SUBAGENT_ERROR", "code"),
    },
  },
  "SUBAGENT_ERROR",
);

export const AG_UI_NATIVE_INVOCATION_JSON_SCHEMA = {
  $id: AG_UI_NATIVE_INVOCATION_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Veryfront internal AG-UI invocation payloads",
  description:
    "Internal, non-public invocation contracts derived from pinned AG-UI 1.0.2 subagent event schemas.",
  $defs: {
    InvocationStarted: invocationStarted,
    InvocationSucceeded: invocationSucceeded,
    InvocationPaused: invocationPaused,
    InvocationFailed: invocationFailed,
  },
} as const satisfies JsonSchema;

function recordSchema<TType extends AgUiNativeInvocationType>(type: TType): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["specversion", "id", "source", "type", "dataschema", "datacontenttype", "data"],
    properties: {
      specversion: { const: "1.0" },
      id: { type: "string", minLength: 1 },
      source: { type: "string", minLength: 1 },
      type: { const: type },
      dataschema: { const: AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE[type] },
      datacontenttype: { const: "application/json" },
      data: { $ref: AG_UI_NATIVE_INVOCATION_SCHEMA_BY_TYPE[type] },
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

export const AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA = {
  ...AG_UI_NATIVE_INVOCATION_JSON_SCHEMA,
  oneOf: AG_UI_NATIVE_INVOCATION_TYPES.map((type) => recordSchema(type)),
} as const satisfies JsonSchema;

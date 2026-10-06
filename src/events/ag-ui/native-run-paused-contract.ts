import type { JsonSchema } from "#veryfront/extensions/schema/index.ts";
import { agUiEventPropertySchema } from "#veryfront/events/ag-ui/native-synchronization-contract.ts";

export const AG_UI_NATIVE_RUN_PAUSED_TYPE = "com.veryfront.run.paused" as const;
export type AgUiNativeRunPausedType = typeof AG_UI_NATIVE_RUN_PAUSED_TYPE;

export const AG_UI_NATIVE_RUN_PAUSED_SCHEMA_ID = "urn:veryfront:ag-ui:internal:run-paused:1";
export const AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA =
  `${AG_UI_NATIVE_RUN_PAUSED_SCHEMA_ID}#/$defs/RunPaused`;
export const AG_UI_PROTOCOL_EXTENSION_URI = "urn:veryfront:ag-ui:protocol:run-lifecycle:1";

type SchemaRecord = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneSchema<T>(value: T): T {
  return structuredClone(value);
}

function interruptOutcomeSchema(): SchemaRecord {
  const outcome = agUiEventPropertySchema("RUN_FINISHED", "outcome");
  if (!Array.isArray(outcome.oneOf)) {
    throw new TypeError("AG-UI RUN_FINISHED outcome schema is missing oneOf");
  }
  for (const branch of outcome.oneOf) {
    if (!isRecord(branch) || !isRecord(branch.properties)) continue;
    const type = branch.properties.type;
    if (isRecord(type) && type.const === "interrupt") return cloneSchema(branch);
  }
  throw new TypeError("Missing AG-UI RUN_FINISHED interrupt outcome schema");
}

function requiredSchemaProperty(schema: SchemaRecord, property: string): SchemaRecord {
  if (!isRecord(schema.properties)) {
    throw new TypeError(`Schema is missing properties while reading ${property}`);
  }
  const value = schema.properties[property];
  if (!isRecord(value)) throw new TypeError(`Schema property ${property} must be an object`);
  return value;
}

function protocolMetadataSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: ["name", "version", "eventType", "run", "outcome"],
    properties: {
      name: { const: "ag-ui" },
      version: { const: "1.0" },
      eventType: { const: "RUN_FINISHED" },
      timestamp: agUiEventPropertySchema("RUN_FINISHED", "timestamp"),
      rawEvent: agUiEventPropertySchema("RUN_FINISHED", "rawEvent"),
      metadata: agUiEventPropertySchema("RUN_FINISHED", "metadata"),
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
      run: {
        type: "object",
        additionalProperties: false,
        required: ["threadId", "runId"],
        properties: {
          threadId: { type: "string" },
          runId: { type: "string" },
          result: agUiEventPropertySchema("RUN_FINISHED", "result"),
        },
      },
      outcome: interruptOutcomeSchema(),
      usage: agUiEventPropertySchema("RUN_FINISHED", "usage"),
    },
  };
}

export const AG_UI_NATIVE_RUN_PAUSED_PAYLOAD_SCHEMA = {
  $id: AG_UI_NATIVE_RUN_PAUSED_SCHEMA_ID,
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Veryfront internal AG-UI run paused payload",
  description:
    "Internal canonical run.paused lifecycle fact derived from pinned AG-UI RUN_FINISHED interrupt outcome.",
  $defs: {
    RunPaused: {
      type: "object",
      additionalProperties: false,
      required: ["pause", "extensions"],
      properties: {
        pause: {
          type: "object",
          additionalProperties: false,
          required: ["interrupts"],
          properties: {
            interrupts: requiredSchemaProperty(interruptOutcomeSchema(), "interrupts"),
          },
        },
        extensions: {
          type: "object",
          additionalProperties: { type: "object", additionalProperties: true },
          required: [AG_UI_PROTOCOL_EXTENSION_URI],
          properties: {
            [AG_UI_PROTOCOL_EXTENSION_URI]: protocolMetadataSchema(),
          },
        },
      },
    },
  },
} as const satisfies JsonSchema;

export const AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA = {
  ...AG_UI_NATIVE_RUN_PAUSED_PAYLOAD_SCHEMA,
  type: "object",
  additionalProperties: false,
  required: [
    "specversion",
    "id",
    "source",
    "type",
    "dataschema",
    "datacontenttype",
    "data",
    "runid",
  ],
  properties: {
    specversion: { const: "1.0" },
    id: { type: "string", minLength: 1 },
    source: { type: "string", minLength: 1 },
    type: { const: AG_UI_NATIVE_RUN_PAUSED_TYPE },
    dataschema: { const: AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA },
    datacontenttype: { const: "application/json" },
    data: { $ref: AG_UI_NATIVE_RUN_PAUSED_DATASCHEMA },
    runid: { type: "string", minLength: 1 },
    runkind: { enum: ["agent", "workflow", "task"] },
    conversationid: { type: "string" },
    subject: { type: "string" },
    time: { type: "string" },
    recordedat: { type: "string" },
    traceparent: { type: "string" },
    tracestate: { type: "string" },
  },
} as const satisfies JsonSchema;

import {
  createNativeTypeGenerator,
  isRecord,
  literal,
  type Schema,
  writeGeneratedTypes,
} from "#veryfront/events/ag-ui/generator.ts";
import { AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA } from "#veryfront/events/ag-ui/native-run-paused-contract.ts";

const OUTPUT_PATH = new URL("./native-run-paused-types.generated.ts", import.meta.url);

const PATH_TYPE_ALIASES = new Map<string, string>([
  [
    "RunPaused.pause.interrupts",
    'Extract<NonNullable<AgUiEventOf<"RUN_FINISHED">["outcome"]>, { readonly type: "interrupt" }>["interrupts"]',
  ],
  [
    "RunPaused.extensions",
    'AgUiProtocolExtensionFields & { readonly "urn:veryfront:ag-ui:protocol:run-lifecycle:1": AgUiNativeRunPausedProtocolMetadata }',
  ],
  ["RunPausedProtocol.timestamp", "number"],
  ["RunPausedProtocol.rawEvent", 'AgUiEventOf<"RUN_FINISHED">["rawEvent"]'],
  ["RunPausedProtocol.metadata", 'AgUiEventOf<"RUN_FINISHED">["metadata"]'],
  ["RunPausedProtocol.extensions", "AgUiProtocolExtensionFields"],
  ["RunPausedProtocol.run.result", 'AgUiEventOf<"RUN_FINISHED">["result"]'],
  [
    "RunPausedProtocol.outcome",
    'Extract<NonNullable<AgUiEventOf<"RUN_FINISHED">["outcome"]>, { readonly type: "interrupt" }>',
  ],
  ["RunPausedProtocol.usage", 'AgUiEventOf<"RUN_FINISHED">["usage"]'],
]);

const { failUnsupported, resolveRef, tsForSchema } = createNativeTypeGenerator({
  recordSchema: AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA,
  pathAliases: PATH_TYPE_ALIASES,
  label: "native run.paused",
});

function schemaProperty(schema: Schema, path: string, property: string): unknown {
  const properties = schema.properties;
  if (!isRecord(properties) || !(property in properties)) {
    return failUnsupported(path, `missing property ${property}`);
  }
  return properties[property];
}

function requiredStringConst(schema: Schema, path: string, property: string): string {
  const propertySchema = schemaProperty(schema, path, property);
  if (!isRecord(propertySchema)) {
    return failUnsupported(`${path}.${property}`, "property must be schema");
  }
  if (typeof propertySchema.const === "string") return propertySchema.const;
  return failUnsupported(`${path}.${property}`, "property must be string const");
}

function generatedSource(): string {
  const recordSchema = AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA;
  const payloadSchema = resolveRef(
    requiredStringConst(recordSchema, "RunPausedRecord", "dataschema"),
  );
  if (!isRecord(payloadSchema)) {
    return failUnsupported("RunPaused", "payload definition must be object");
  }
  const protocolSchema = schemaProperty(
    schemaProperty(payloadSchema, "RunPaused", "extensions") as Schema,
    "RunPaused.extensions",
    "urn:veryfront:ag-ui:protocol:run-lifecycle:1",
  );
  if (!isRecord(protocolSchema)) {
    return failUnsupported("RunPausedProtocol", "protocol schema must be object");
  }
  return `/**
 * Generated internal AG-UI run.paused record types.
 *
 * Source: src/events/ag-ui/native-run-paused-contract.ts AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-native-run-paused-types.ts
 */

import type { AgUiEventOf, AgUiProtocolExtensionFields } from "#veryfront/events/ag-ui/types.ts";

export type AgUiNativeRunPausedType = ${
    literal(requiredStringConst(recordSchema, "RunPausedRecord", "type"))
  };
export type AgUiNativeRunPausedDataschema = ${
    literal(requiredStringConst(recordSchema, "RunPausedRecord", "dataschema"))
  };

export type AgUiNativeRunPausedPayload = ${tsForSchema(payloadSchema, "RunPaused")};

export type AgUiNativeRunPausedProtocolMetadata = ${
    tsForSchema(protocolSchema, "RunPausedProtocol")
  };

export type AgUiNativeRunPausedRecord = ${tsForSchema(recordSchema, "RunPausedRecord")};
`;
}

await writeGeneratedTypes({
  source: generatedSource(),
  outputPath: OUTPUT_PATH,
  tempPrefix: "ag-ui-run-paused-types-",
  outdatedMessages: [
    "Generated native run.paused types are out of date. Run:",
    "  deno run -A src/events/ag-ui/generate-native-run-paused-types.ts",
  ],
});

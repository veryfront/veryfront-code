import { AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA } from "./native-run-paused-contract.ts";

const OUTPUT_PATH = new URL("./native-run-paused-types.generated.ts", import.meta.url);

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function failUnsupported(path: string, detail: string): never {
  throw new Error(`Unsupported AG-UI native run.paused schema construct at ${path}: ${detail}`);
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

function parenthesize(value: string): string {
  return value.includes(" | ") || value.includes(" & ") ? `(${value})` : value;
}

function readonlyArray(item: string, minItems: unknown): string {
  if (minItems !== undefined && minItems !== 1) {
    failUnsupported("array.minItems", `only minItems: 1 is supported, got ${String(minItems)}`);
  }
  return minItems === 1 ? `readonly [${item}, ...${item}[]]` : `readonly (${item})[]`;
}

function localRefName(ref: string): string {
  const marker = "#/$defs/";
  const index = ref.indexOf(marker);
  if (index < 0) failUnsupported("$ref", `only local $defs refs are supported, got ${ref}`);
  return ref.slice(index + marker.length);
}

function schemaDefs(): Record<string, unknown> {
  const defs = AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA.$defs;
  if (!isRecord(defs)) failUnsupported("$defs", "schema definitions must be an object");
  return defs;
}

function resolveRef(ref: string): unknown {
  const defs = schemaDefs();
  const name = localRefName(ref);
  if (!(name in defs)) failUnsupported("$ref", `missing definition ${name}`);
  return defs[name];
}

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

function tsForSchema(schemaValue: unknown, path: string): string {
  const alias = PATH_TYPE_ALIASES.get(path);
  if (alias) return alias;
  if (!isRecord(schemaValue)) failUnsupported(path, "schema must be an object");
  const schema = schemaValue;
  if (typeof schema.$ref === "string") {
    return tsForSchema(resolveRef(schema.$ref), localRefName(schema.$ref));
  }
  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(" | ");
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((entry, index) => tsForSchema(entry, `${path}.oneOf${index}`)).join(
      " | ",
    );
  }
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => tsForSchema({ ...schema, type }, path)).join(" | ");
  }
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";
  if (schema.type === "array") {
    if (!("items" in schema)) failUnsupported(path, "array schema requires items");
    return readonlyArray(parenthesize(tsForSchema(schema.items, `${path}.items`)), schema.minItems);
  }
  if (schema.type === "object" || isRecord(schema.properties)) return tsForObject(schema, path);
  if (Object.keys(schema).length === 0) return "unknown";
  failUnsupported(path, `unhandled schema keys ${Object.keys(schema).join(",")}`);
}

function tsForObject(schema: Schema, path: string): string {
  const alias = PATH_TYPE_ALIASES.get(path);
  if (alias) return alias;
  if (schema.additionalProperties !== false && schema.additionalProperties !== undefined) {
    failUnsupported(path, "open object schemas require an explicit path alias");
  }
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [],
  );
  const lines = Object.entries(properties).map(([key, value]) => {
    const optional = required.has(key) ? "" : "?";
    return `  readonly ${literal(key)}${optional}: ${tsForSchema(value, `${path}.${key}`)};`;
  });
  return lines.length === 0 ? "{}" : ["{", ...lines, "}"].join("\n");
}

function schemaProperty(schema: Schema, path: string, property: string): unknown {
  const properties = schema.properties;
  if (!isRecord(properties) || !(property in properties)) {
    failUnsupported(path, `missing property ${property}`);
  }
  return properties[property];
}

function requiredStringConst(schema: Schema, path: string, property: string): string {
  const propertySchema = schemaProperty(schema, path, property);
  if (!isRecord(propertySchema)) failUnsupported(`${path}.${property}`, "property must be schema");
  if (typeof propertySchema.const === "string") return propertySchema.const;
  failUnsupported(`${path}.${property}`, "property must be string const");
}

function generatedSource(): string {
  const recordSchema = AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA;
  const payloadSchema = resolveRef(
    requiredStringConst(recordSchema, "RunPausedRecord", "dataschema"),
  );
  if (!isRecord(payloadSchema)) failUnsupported("RunPaused", "payload definition must be object");
  const protocolSchema = schemaProperty(
    schemaProperty(payloadSchema, "RunPaused", "extensions") as Schema,
    "RunPaused.extensions",
    "urn:veryfront:ag-ui:protocol:run-lifecycle:1",
  );
  if (!isRecord(protocolSchema)) {
    failUnsupported("RunPausedProtocol", "protocol schema must be object");
  }
  return `/**
 * Generated internal AG-UI run.paused record types.
 *
 * Source: src/events/ag-ui/native-run-paused-contract.ts AG_UI_NATIVE_RUN_PAUSED_RECORD_SCHEMA.
 * Regenerate with: deno run -A src/events/ag-ui/generate-native-run-paused-types.ts
 */

import type { AgUiEventOf, AgUiProtocolExtensionFields } from "./types.ts";

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

async function formattedSource(source: string): Promise<string> {
  const path = await Deno.makeTempFile({ prefix: "ag-ui-run-paused-types-", suffix: ".ts" });
  try {
    await Deno.writeTextFile(path, source);
    const status = await new Deno.Command(Deno.execPath(), {
      args: ["fmt", "--config=deno.json", path],
      stdout: "null",
      stderr: "inherit",
    }).spawn().status;
    if (!status.success) Deno.exit(status.code);
    return await Deno.readTextFile(path);
  } finally {
    await Deno.remove(path).catch(() => undefined);
  }
}

const generated = await formattedSource(generatedSource());
if (Deno.args.includes("--check")) {
  const current = await Deno.readTextFile(OUTPUT_PATH);
  if (current !== generated) {
    console.error("Generated native run.paused types are out of date. Run:");
    console.error("  deno run -A src/events/ag-ui/generate-native-run-paused-types.ts");
    Deno.exit(1);
  }
} else {
  await Deno.writeTextFile(OUTPUT_PATH, generated);
}

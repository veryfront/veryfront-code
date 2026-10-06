import { AG_UI_NATIVE_REASONING_RECORD_SCHEMA } from "./native-reasoning-contract.ts";

const OUTPUT_PATH = new URL("./native-reasoning-types.generated.ts", import.meta.url);

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function failUnsupported(path: string, detail: string): never {
  throw new Error(
    `Unsupported AG-UI native reasoning schema construct at ${path}: ${detail}`,
  );
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
  const defs = AG_UI_NATIVE_REASONING_RECORD_SCHEMA.$defs;
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
  ["ReasoningContextStarted.context.messageId", 'AgUiEventOf<"REASONING_START">["messageId"]'],
  ["ReasoningContextEnded.context.messageId", 'AgUiEventOf<"REASONING_END">["messageId"]'],
  [
    "ReasoningContinuationRecorded.continuation.subtype",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["subtype"]',
  ],
  [
    "ReasoningContinuationRecorded.continuation.entityId",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["entityId"]',
  ],
  [
    "ReasoningContinuationRecorded.continuation.encryptedValue",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["encryptedValue"]',
  ],
  ["ReasoningContextStarted.protocol.agui.timestamp", "number"],
  ["ReasoningContextEnded.protocol.agui.timestamp", "number"],
  ["ReasoningContinuationRecorded.protocol.agui.timestamp", "number"],
  ["ReasoningContextStarted.protocol.agui.rawEvent", 'AgUiEventOf<"REASONING_START">["rawEvent"]'],
  ["ReasoningContextEnded.protocol.agui.rawEvent", 'AgUiEventOf<"REASONING_END">["rawEvent"]'],
  [
    "ReasoningContinuationRecorded.protocol.agui.rawEvent",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["rawEvent"]',
  ],
  ["ReasoningContextStarted.protocol.agui.metadata", 'AgUiEventOf<"REASONING_START">["metadata"]'],
  ["ReasoningContextEnded.protocol.agui.metadata", 'AgUiEventOf<"REASONING_END">["metadata"]'],
  [
    "ReasoningContinuationRecorded.protocol.agui.metadata",
    'AgUiEventOf<"REASONING_ENCRYPTED_VALUE">["metadata"]',
  ],
  ["ReasoningContextStarted.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["ReasoningContextEnded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["ReasoningContinuationRecorded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
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

function requiredStringProperty(schema: Schema, path: string, property: string): string {
  const properties = schema.properties;
  if (!isRecord(properties) || !(property in properties)) {
    failUnsupported(path, `missing property ${property}`);
  }
  const propertySchema = properties[property];
  if (!isRecord(propertySchema)) failUnsupported(`${path}.${property}`, "property must be schema");
  if (typeof propertySchema.const === "string") return propertySchema.const;
  failUnsupported(`${path}.${property}`, "property must be string const");
}

function recordVariantSchemas(): readonly Schema[] {
  const variants = AG_UI_NATIVE_REASONING_RECORD_SCHEMA.oneOf;
  if (!Array.isArray(variants)) failUnsupported("record.oneOf", "record schema must have variants");
  return variants.map((variant, index) => {
    if (!isRecord(variant)) failUnsupported(`record.oneOf${index}`, "variant must be an object");
    return variant;
  });
}

function payloadTypeName(defName: string): string {
  return `AgUiNative${defName}Payload`;
}

function eventTypeForPayload(defName: string, payloadSchema: Schema): string {
  const protocol = payloadSchema.properties;
  if (!isRecord(protocol)) failUnsupported(defName, "payload properties missing");
  const protocolSchema = protocol.protocol;
  if (!isRecord(protocolSchema)) failUnsupported(`${defName}.protocol`, "protocol schema missing");
  const protocolProperties = protocolSchema.properties;
  if (!isRecord(protocolProperties)) {
    failUnsupported(`${defName}.protocol`, "protocol properties missing");
  }
  const agui = protocolProperties.agui;
  if (!isRecord(agui)) failUnsupported(`${defName}.protocol.agui`, "agui schema missing");
  const aguiProperties = agui.properties;
  if (!isRecord(aguiProperties)) {
    failUnsupported(`${defName}.protocol.agui`, "agui properties missing");
  }
  const eventType = aguiProperties.eventType;
  if (!isRecord(eventType) || typeof eventType.const !== "string") {
    failUnsupported(`${defName}.protocol.agui.eventType`, "eventType must be const string");
  }
  return eventType.const;
}

function payloadDefinitionEntries(): readonly [string, Schema][] {
  return Object.entries(schemaDefs()).map(([name, schema]) => {
    if (!isRecord(schema)) failUnsupported(`$defs.${name}`, "definition must be an object");
    return [name, schema] as const;
  });
}

function recordGenericLines(schema: Schema, path: string): readonly string[] {
  const properties = schema.properties;
  if (!isRecord(properties)) failUnsupported(path, "record properties missing");
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [],
  );
  return Object.keys(properties).map((key) => {
    const optional = required.has(key) ? "" : "?";
    if (key === "type") return `  readonly ${literal(key)}${optional}: TType;`;
    if (key === "dataschema") {
      return `  readonly ${literal(key)}${optional}: AgUiNativeReasoningDataschema<TType>;`;
    }
    if (key === "data") {
      return `  readonly ${literal(key)}${optional}: AgUiNativeReasoningPayload<TType>;`;
    }
    return `  readonly ${literal(key)}${optional}: ${
      tsForSchema(properties[key], `${path}.${key}`)
    };`;
  });
}

function generatedSource(): string {
  const variants = recordVariantSchemas();
  const variantTypes = variants.map((variant, index) => ({
    schema: variant,
    type: requiredStringProperty(variant, `record.oneOf${index}`, "type"),
    dataschema: requiredStringProperty(variant, `record.oneOf${index}`, "dataschema"),
  }));
  const payloads = payloadDefinitionEntries();
  const eventTypes = [
    ...new Set(payloads.map(([name, schema]) => eventTypeForPayload(name, schema))),
  ];
  const lines = [
    "/**",
    " * Generated internal AG-UI reasoning record types.",
    " *",
    " * Source: src/events/ag-ui/native-reasoning-contract.ts AG_UI_NATIVE_REASONING_RECORD_SCHEMA.",
    " * Regenerate with: deno run -A src/events/ag-ui/generate-native-reasoning-types.ts",
    " */",
    "",
    'import type { AgUiEventOf, AgUiProtocolExtensionFields } from "./types.ts";',
    "",
    "export type AgUiNativeReasoningType =",
    ...variantTypes.map(({ type }) => `  | ${literal(type)}`),
    "  ;",
    "",
    "export interface AgUiNativeReasoningDataschemaByType {",
    ...variantTypes.map(({ type, dataschema }) =>
      `  readonly ${literal(type)}: ${literal(dataschema)};`
    ),
    "}",
    "",
    "export type AgUiNativeReasoningDataschema<TType extends AgUiNativeReasoningType> =",
    "  AgUiNativeReasoningDataschemaByType[TType];",
    "",
    "export interface AgUiReasoningAttribution {",
    "  readonly invocation?: {",
    "    readonly subagentRunId: string;",
    "  };",
    "}",
    "",
    "export type AgUiReasoningEventType =",
    ...eventTypes.map((type) => `  | ${literal(type)}`),
    "  ;",
    "",
    "export interface AgUiReasoningEventByType {",
    ...eventTypes.map((type) => `  readonly ${type}: AgUiEventOf<${literal(type)}>;`),
    "}",
    "",
    ...payloads.flatMap(([name, schema]) => [
      `export type ${payloadTypeName(name)} = ${tsForSchema(schema, name)};`,
      "",
    ]),
    "export interface AgUiNativeReasoningPayloadByType {",
    ...variantTypes.map(({ type, dataschema }) => {
      const defName = localRefName(dataschema);
      return `  readonly ${literal(type)}: ${payloadTypeName(defName)};`;
    }),
    "}",
    "",
    "type AgUiReasoningProtocolMetadataUnion = {",
    "  readonly [TType in AgUiNativeReasoningType]: AgUiNativeReasoningPayloadByType[TType] extends {",
    "    readonly protocol: { readonly agui: infer TProtocol };",
    "  } ? TProtocol : never;",
    "}[AgUiNativeReasoningType];",
    "",
    "export type AgUiReasoningProtocolMetadata<",
    "  TEventType extends AgUiReasoningEventType = AgUiReasoningEventType,",
    "> = Extract<AgUiReasoningProtocolMetadataUnion, { readonly eventType: TEventType }>;",
    "",
    "export type AgUiNativeReasoningPayload<TType extends AgUiNativeReasoningType> =",
    "  AgUiNativeReasoningPayloadByType[TType];",
    "",
    "export type AgUiNativeReasoningAnyPayload = {",
    "  readonly [TType in AgUiNativeReasoningType]: AgUiNativeReasoningPayload<TType>;",
    "}[AgUiNativeReasoningType];",
    "",
    "export type AgUiNativeReasoningRecord<TType extends AgUiNativeReasoningType> = {",
    ...recordGenericLines(variants[0]!, "record.oneOf0"),
    "};",
    "",
    "export type AgUiNativeReasoningAnyRecord = {",
    "  readonly [TType in AgUiNativeReasoningType]: AgUiNativeReasoningRecord<TType>;",
    "}[AgUiNativeReasoningType];",
    "",
  ];
  return lines.join("\n");
}

async function formattedSource(source: string): Promise<string> {
  const path = await Deno.makeTempFile({ prefix: "ag-ui-native-sync-types-", suffix: ".ts" });
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
    console.error("Generated native reasoning types are out of date. Run:");
    console.error("  deno run -A src/events/ag-ui/generate-native-reasoning-types.ts");
    Deno.exit(1);
  }
} else {
  await Deno.writeTextFile(OUTPUT_PATH, generated);
}

import { AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA } from "./native-invocation-contract.ts";

const OUTPUT_PATH = new URL("./native-invocation-types.generated.ts", import.meta.url);

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function failUnsupported(path: string, detail: string): never {
  throw new Error(`Unsupported AG-UI native invocation schema construct at ${path}: ${detail}`);
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
  const defs = AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA.$defs;
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
    "InvocationStarted.invocation.subagentRunId",
    'AgUiEventOf<"SUBAGENT_STARTED">["subagentRunId"]',
  ],
  ["InvocationStarted.invocation.name", 'AgUiEventOf<"SUBAGENT_STARTED">["name"]'],
  ["InvocationStarted.invocation.description", 'AgUiEventOf<"SUBAGENT_STARTED">["description"]'],
  [
    "InvocationSucceeded.invocation.subagentRunId",
    'AgUiEventOf<"SUBAGENT_FINISHED">["subagentRunId"]',
  ],
  ["InvocationSucceeded.invocation.result", 'AgUiEventOf<"SUBAGENT_FINISHED">["result"]'],
  [
    "InvocationSucceeded.invocation.outcome",
    'Extract<NonNullable<AgUiEventOf<"SUBAGENT_FINISHED">["outcome"]>, { readonly type: "success" }>',
  ],
  [
    "InvocationPaused.invocation.subagentRunId",
    'AgUiEventOf<"SUBAGENT_FINISHED">["subagentRunId"]',
  ],
  ["InvocationPaused.invocation.result", 'AgUiEventOf<"SUBAGENT_FINISHED">["result"]'],
  [
    "InvocationPaused.invocation.outcome",
    'Extract<NonNullable<AgUiEventOf<"SUBAGENT_FINISHED">["outcome"]>, { readonly type: "suspended" }>',
  ],
  ["InvocationFailed.invocation.subagentRunId", 'AgUiEventOf<"SUBAGENT_ERROR">["subagentRunId"]'],
  ["InvocationFailed.invocation.message", 'AgUiEventOf<"SUBAGENT_ERROR">["message"]'],
  ["InvocationFailed.invocation.code", 'AgUiEventOf<"SUBAGENT_ERROR">["code"]'],
  ["InvocationStarted.protocol.agui.timestamp", "number"],
  ["InvocationSucceeded.protocol.agui.timestamp", "number"],
  ["InvocationPaused.protocol.agui.timestamp", "number"],
  ["InvocationFailed.protocol.agui.timestamp", "number"],
  ["InvocationStarted.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_STARTED">["rawEvent"]'],
  ["InvocationSucceeded.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_FINISHED">["rawEvent"]'],
  ["InvocationPaused.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_FINISHED">["rawEvent"]'],
  ["InvocationFailed.protocol.agui.rawEvent", 'AgUiEventOf<"SUBAGENT_ERROR">["rawEvent"]'],
  ["InvocationStarted.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_STARTED">["metadata"]'],
  ["InvocationSucceeded.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_FINISHED">["metadata"]'],
  ["InvocationPaused.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_FINISHED">["metadata"]'],
  ["InvocationFailed.protocol.agui.metadata", 'AgUiEventOf<"SUBAGENT_ERROR">["metadata"]'],
  ["InvocationStarted.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["InvocationSucceeded.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["InvocationPaused.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
  ["InvocationFailed.protocol.agui.extensions", "AgUiProtocolExtensionFields"],
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
  const variants = AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA.oneOf;
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
  const properties = payloadSchema.properties;
  if (!isRecord(properties)) failUnsupported(defName, "payload properties missing");
  const protocolSchema = properties.protocol;
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
      return `  readonly ${literal(key)}${optional}: AgUiNativeInvocationDataschema<TType>;`;
    }
    if (key === "data") {
      return `  readonly ${literal(key)}${optional}: AgUiNativeInvocationPayload<TType>;`;
    }
    return `  readonly ${literal(key)}${optional}: ${
      tsForSchema(properties[key], `${path}.${key}`)
    };`;
  });
}

function generatedSource(): string {
  const variants = recordVariantSchemas();
  const variantTypes = variants.map((schema, index) => ({
    type: requiredStringProperty(schema, `record.oneOf${index}`, "type"),
    dataschema: requiredStringProperty(schema, `record.oneOf${index}`, "dataschema"),
  }));
  const payloads = payloadDefinitionEntries();
  const eventTypes = [
    ...new Set(payloads.map(([name, schema]) => eventTypeForPayload(name, schema))),
  ];
  const lines = [
    "/**",
    " * Generated internal AG-UI invocation record types.",
    " *",
    " * Source: src/events/ag-ui/native-invocation-contract.ts AG_UI_NATIVE_INVOCATION_RECORD_SCHEMA.",
    " * Regenerate with: deno run -A src/events/ag-ui/generate-native-invocation-types.ts",
    " */",
    "",
    'import type { AgUiEventOf, AgUiProtocolExtensionFields } from "./types.ts";',
    "",
    "export type AgUiNativeInvocationType =",
    ...variantTypes.map(({ type }) => `  | ${literal(type)}`),
    "  ;",
    "",
    "export interface AgUiNativeInvocationDataschemaByType {",
    ...variantTypes.map(({ type, dataschema }) =>
      `  readonly ${literal(type)}: ${literal(dataschema)};`
    ),
    "}",
    "",
    "export type AgUiNativeInvocationDataschema<TType extends AgUiNativeInvocationType> =",
    "  AgUiNativeInvocationDataschemaByType[TType];",
    "",
    "export interface AgUiInvocationParentAttribution {",
    "  readonly parent?: {",
    "    readonly invocation?: { readonly subagentRunId: string };",
    "    readonly tool?: { readonly toolCallId: string };",
    "    readonly message?: { readonly messageId: string };",
    "  };",
    "}",
    "",
    "export type AgUiInvocationEventType =",
    ...eventTypes.map((type) => `  | ${literal(type)}`),
    "  ;",
    "",
    "export interface AgUiInvocationEventByType {",
    ...eventTypes.map((type) => `  readonly ${type}: AgUiEventOf<${literal(type)}>;`),
    "}",
    "",
    ...payloads.flatMap(([name, schema]) => [
      `export type ${payloadTypeName(name)} = ${tsForSchema(schema, name)};`,
      "",
    ]),
    "export interface AgUiNativeInvocationPayloadByType {",
    ...variantTypes.map(({ type, dataschema }) => {
      const defName = localRefName(dataschema);
      return `  readonly ${literal(type)}: ${payloadTypeName(defName)};`;
    }),
    "}",
    "",
    "type AgUiInvocationProtocolMetadataUnion = {",
    "  readonly [TType in AgUiNativeInvocationType]: AgUiNativeInvocationPayloadByType[TType] extends {",
    "    readonly protocol: { readonly agui: infer TProtocol };",
    "  } ? TProtocol : never;",
    "}[AgUiNativeInvocationType];",
    "",
    "export type AgUiInvocationProtocolMetadata<",
    "  TEventType extends AgUiInvocationEventType = AgUiInvocationEventType,",
    "> = Extract<AgUiInvocationProtocolMetadataUnion, { readonly eventType: TEventType }>;",
    "",
    "export type AgUiNativeInvocationPayload<TType extends AgUiNativeInvocationType> =",
    "  AgUiNativeInvocationPayloadByType[TType];",
    "",
    "export type AgUiNativeInvocationAnyPayload = {",
    "  readonly [TType in AgUiNativeInvocationType]: AgUiNativeInvocationPayload<TType>;",
    "}[AgUiNativeInvocationType];",
    "",
    "export type AgUiNativeInvocationRecord<TType extends AgUiNativeInvocationType> = {",
    ...recordGenericLines(variants[0]!, "record.oneOf0"),
    "};",
    "",
    "export type AgUiNativeInvocationAnyRecord = {",
    "  readonly [TType in AgUiNativeInvocationType]: AgUiNativeInvocationRecord<TType>;",
    "}[AgUiNativeInvocationType];",
    "",
  ];
  return lines.join("\n");
}

async function formattedSource(source: string): Promise<string> {
  const path = await Deno.makeTempFile({ prefix: "ag-ui-native-invocation-types-", suffix: ".ts" });
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
    console.error("Generated native invocation types are out of date. Run:");
    console.error("  deno run -A src/events/ag-ui/generate-native-invocation-types.ts");
    Deno.exit(1);
  }
} else {
  await Deno.writeTextFile(OUTPUT_PATH, generated);
}

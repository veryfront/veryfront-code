import { writeGeneratedTypes } from "#veryfront/events/ag-ui/generator.ts";
import {
  AG_UI_EVENT_SCHEMA,
  AG_UI_EVENT_TYPES,
  type AgUiEventType,
} from "#veryfront/events/ag-ui/schema.ts";

const OUTPUT_PATH = new URL("./types.generated.ts", import.meta.url);
const COMMON_EVENT_FIELDS = new Set(["type", "timestamp", "rawEvent", "metadata", "subagentRunId"]);
const EVENT_HELPER_NAMES = new Map<string, string>([
  ["RUN_STARTED.input", "AgUiRunAgentInput"],
  ["RUN_FINISHED.outcome", "AgUiRunFinishedOutcome"],
  ["SUBAGENT_FINISHED.outcome", "AgUiSubagentFinishedOutcome"],
  ["STATE_DELTA.delta", "AgUiJsonPatch"],
  ["ACTIVITY_DELTA.patch", "AgUiJsonPatch"],
]);

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function failUnsupported(path: string, detail: string): never {
  throw new Error(`Unsupported AG-UI schema construct at ${path}: ${detail}`);
}

function literal(value: unknown): string {
  return JSON.stringify(value);
}

function pascalCase(value: string): string {
  return value.toLowerCase().split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(
    "",
  );
}

function eventTypeName(type: AgUiEventType): string {
  return `AgUi${pascalCase(type)}Event`;
}

function readonlyArray(item: string, minItems: unknown): string {
  if (minItems !== undefined && minItems !== 1) {
    failUnsupported("array.minItems", `only minItems: 1 is supported, got ${String(minItems)}`);
  }
  return minItems === 1 ? `readonly [${item}, ...${item}[]]` : `readonly (${item})[]`;
}

function parenthesizeArrayItem(type: string): string {
  return type.startsWith("(") && type.endsWith(")") ? type.slice(1, -1) : type;
}

function tsForSchema(schema: unknown, path: string, useHelperName = true): string {
  if (!isRecord(schema)) failUnsupported(path, "schema must be an object");
  const helperName = EVENT_HELPER_NAMES.get(path);
  if (useHelperName && helperName) return helperName;

  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(" | ");
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((entry, index) => tsForSchema(entry, `${path}.oneOf${index}`)).join(
      " | ",
    );
  }
  if (schema.not !== undefined) {
    if (isRecord(schema.not) && schema.not.type === "null") return "unknown";
    failUnsupported(path, "only not: { type: 'null' } is supported");
  }
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "array") {
    if (!("items" in schema)) failUnsupported(path, "array schema requires items");
    return readonlyArray(
      parenthesizeArrayItem(tsForSchema(schema.items, `${path}.items`)),
      schema.minItems,
    );
  }
  if (schema.type === "object" || isRecord(schema.properties)) {
    return tsForObject(schema, path);
  }
  if (Object.keys(schema).length === 0) return "unknown";
  failUnsupported(path, `unhandled schema keys ${Object.keys(schema).join(",")}`);
}

function tsForObject(schema: Schema, path: string): string {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    failUnsupported(path, "properties must be an object");
  }
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    failUnsupported(path, "required must be an array");
  }
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [],
  );
  const lines = Object.entries(properties).map(([key, value]) => {
    const optional = required.has(key) ? "" : "?";
    return `  readonly ${literal(key)}${optional}: ${tsForSchema(value, `${path}.${key}`)};`;
  });
  if (lines.length === 0) return "AgUiMetadata";
  return ["AgUiProtocolExtensionFields & {", ...lines, "}"].join("\n");
}

function eventSchemaByType(type: AgUiEventType): Schema {
  const variants = AG_UI_EVENT_SCHEMA.oneOf;
  if (!Array.isArray(variants)) throw new Error("AG_UI_EVENT_SCHEMA.oneOf is missing");
  const variant = variants.find((entry) =>
    isRecord(entry) && isRecord(entry.properties) && isRecord(entry.properties.type) &&
    entry.properties.type.const === type
  );
  if (!isRecord(variant)) throw new Error(`Missing AG-UI event schema for ${type}`);
  return variant;
}

function eventSpecificProperties(type: AgUiEventType, schema: Schema): string[] {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  if (!isRecord(schema.properties)) failUnsupported(type, "event properties must be an object");
  if (schema.required !== undefined && !Array.isArray(schema.required)) {
    failUnsupported(type, "event required must be an array");
  }
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter((key) => typeof key === "string") : [],
  );
  return Object.entries(properties).flatMap(([key, value]) => {
    if (key === "type") return [];
    if (COMMON_EVENT_FIELDS.has(key) && !required.has(key)) return [];
    const optional = required.has(key) ? "" : "?";
    return `  readonly ${literal(key)}${optional}: ${tsForSchema(value, `${type}.${key}`)};`;
  });
}

const helperAliases = [
  ["AgUiRunAgentInput", "RUN_STARTED.input"],
  ["AgUiRunFinishedOutcome", "RUN_FINISHED.outcome"],
  ["AgUiSubagentFinishedOutcome", "SUBAGENT_FINISHED.outcome"],
  ["AgUiJsonPatch", "STATE_DELTA.delta"],
] as const;

function schemaAtPath(path: string): unknown {
  const [type, property] = path.split(".") as [AgUiEventType, string];
  const schema = eventSchemaByType(type);
  const properties = schema.properties;
  if (!isRecord(properties) || !(property in properties)) {
    throw new Error(`Missing schema path ${path}`);
  }
  return properties[property];
}

function generatedSource(): string {
  const eventNames = AG_UI_EVENT_TYPES.map(eventTypeName);
  const lines = [
    "/**",
    " * Generated AG-UI 1.0 TypeScript event contract.",
    " *",
    " * Source: src/events/ag-ui/schema.ts AG_UI_EVENT_SCHEMA.",
    " * Regenerate with: deno run -A src/events/ag-ui/generate-types.ts",
    " */",
    "",
    'import type { AgUiEventType } from "#veryfront/events/ag-ui/schema.ts";',
    "",
    "export type AgUiJsonValue =",
    "  | null",
    "  | boolean",
    "  | number",
    "  | string",
    "  | readonly AgUiJsonValue[]",
    "  | { readonly [key: string]: AgUiJsonValue };",
    "",
    "export type AgUiMetadata = Record<string, unknown>;",
    "export type AgUiProtocolExtensionFields<",
    "  TExtensions extends Record<string, unknown> = Record<never, never>,",
    "> = { readonly [K in keyof TExtensions]: TExtensions[K] };",
    "",
    "export interface AgUiBaseEvent<TType extends AgUiEventType> extends AgUiProtocolExtensionFields {",
    "  readonly type: TType;",
    "  readonly timestamp?: number;",
    "  readonly rawEvent?: unknown;",
    "  readonly metadata?: AgUiMetadata;",
    "  readonly subagentRunId?: string;",
    "}",
    "",
    ...helperAliases.flatMap(([name, path]) => [
      `export type ${name} = ${tsForSchema(schemaAtPath(path), path, false)};`,
      "",
    ]),
    ...AG_UI_EVENT_TYPES.flatMap((type) => {
      const specific = eventSpecificProperties(type, eventSchemaByType(type));
      return [
        `export type ${eventTypeName(type)} = AgUiBaseEvent<${literal(type)}> & {`,
        ...specific,
        "};",
        "",
      ];
    }),
    "export type AgUiEvent =",
    ...eventNames.map((name) => `  | ${name}`),
    "  ;",
    "",
    "export type AgUiEventWithExtensions<",
    "  TEvent extends AgUiEvent = AgUiEvent,",
    "  TExtensions extends Record<string, unknown> = Record<string, unknown>,",
    "> = TEvent & AgUiProtocolExtensionFields<TExtensions>;",
    "",
    "export type AgUiEventByType = {",
    "  readonly [TType in AgUiEventType]: Extract<AgUiEvent, { readonly type: TType }>;",
    "};",
    "",
    "export type AgUiEventOf<TType extends AgUiEventType> = AgUiEventByType[TType];",
    "",
  ];
  return lines.join("\n");
}

await writeGeneratedTypes({
  source: generatedSource(),
  outputPath: OUTPUT_PATH,
  tempPrefix: "ag-ui-types-",
  outdatedMessages: [
    "src/events/ag-ui/types.generated.ts is out of date; run deno run -A src/events/ag-ui/generate-types.ts",
  ],
});

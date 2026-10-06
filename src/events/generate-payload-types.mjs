import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCHEMA_PATH = new URL("./contracts/target-payload-schemas.json", import.meta.url);
const OUTPUT_PATH = new URL("./payload-types.generated.ts", import.meta.url);
const BUNDLE = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
const DEFINITIONS = BUNDLE.$defs;
const TARGET_PAYLOAD_SCHEMA_ID = "urn:veryfront:run-events:target:payloads:1";

function literal(value) {
  return JSON.stringify(value);
}

function refName(ref) {
  const prefix = "#/$defs/";
  const absolutePrefix = `${TARGET_PAYLOAD_SCHEMA_ID}#/$defs/`;
  const name = ref.startsWith(prefix)
    ? ref.slice(prefix.length)
    : ref.startsWith(absolutePrefix)
    ? ref.slice(absolutePrefix.length)
    : undefined;
  if (!name) throw new Error(`Unsupported ref ${ref}`);
  if (name === "JsonValue") return "EventJsonValue";
  if (name === "JsonObject") return "EventJsonObject";
  return name;
}

function tsDoc(schema) {
  if (typeof schema.description !== "string") return [];
  return [
    "/**",
    ...schema.description.split("\n").map((line) => ` * ${line.replaceAll("*/", "* /")}`),
    " */",
  ];
}

function propertyType(schema) {
  if (schema.$ref) return refName(schema.$ref);
  if (schema.const !== undefined) return literal(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(" | ");
  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => propertyType({ ...schema, type })).join(" | ");
  }
  if (schema.oneOf) return oneOfType(schema.oneOf);
  if (schema.anyOf) {
    return schema.anyOf.map((item) => parenthesize(propertyType(item))).join(" | ");
  }
  if (schema.type === "array") return `readonly ${parenthesize(propertyType(schema.items))}[]`;
  if (schema.type === "string") return "string";
  if (schema.type === "integer" || schema.type === "number") return "number";
  if (schema.type === "boolean") return "boolean";
  if (schema.type === "null") return "null";
  if (schema.type === "object" || schema.properties || schema.additionalProperties) {
    return objectType(schema);
  }
  return "EventJsonValue";
}

function parenthesize(value) {
  return value.includes(" | ") || value.includes(" & ") ? `(${value})` : value;
}

function resolveRef(schema) {
  if (!schema.$ref) return schema;
  const name = refName(schema.$ref);
  if (name === "EventJsonValue" || name === "EventJsonObject") return undefined;
  return DEFINITIONS[name];
}

function schemaPropertyKeys(schema) {
  const resolved = resolveRef(schema);
  return Object.keys(resolved?.properties ?? {});
}

function forbiddenProperties(keys) {
  if (keys.length === 0) return "{}";
  return `\n{\n${keys.map((key) => `  readonly ${literal(key)}?: never;`).join("\n")}\n}`;
}

function oneOfType(branches) {
  const branchKeys = branches.map((branch) => new Set(schemaPropertyKeys(branch)));
  const allKeys = new Set(branchKeys.flatMap((keys) => [...keys]));
  return branches.map((branch, index) => {
    const ownKeys = branchKeys[index];
    const forbidden = [...allKeys].filter((key) => !ownKeys.has(key));
    const branchType = propertyType(branch);
    if (forbidden.length === 0) return parenthesize(branchType);
    return `${parenthesize(branchType)} & ${forbiddenProperties(forbidden)}`;
  }).join(" | ");
}

function objectType(schema) {
  if (schema === DEFINITIONS.JsonObject) return "EventJsonObject";
  if (schema === DEFINITIONS.Extensions) return "Extensions";
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const lines = Object.entries(properties).map(([name, property]) => {
    const optional = required.has(name) ? "" : "?";
    return `  readonly ${JSON.stringify(name)}${optional}: ${propertyType(property)};`;
  });
  if (schema.additionalProperties && schema.additionalProperties !== false) {
    const value = propertyType(schema.additionalProperties);
    lines.push(`  readonly [key: string]: ${value};`);
  }
  if (lines.length === 0) return "{}";
  const shape = `{\n${lines.join("\n")}\n}`;
  if (
    schema.minProperties === 1 &&
    required.size === 0 &&
    schema.additionalProperties === false &&
    Object.keys(properties).length > 0
  ) {
    return `EventAtLeastOne<${shape}>`;
  }
  return shape;
}

function withoutKeys(base, keys) {
  return `Omit<${base}, ${keys.map(literal).join(" | ")}>`;
}

function redactionUnion(name, schema) {
  const keys = schema.oneOf?.map((branch) => branch.required?.[0]);
  if (!keys || keys.length !== 2 || keys.some((key) => typeof key !== "string")) return undefined;
  const base = `${name}Base`;
  return [
    ...tsDoc(schema),
    `export type ${base} = ${objectType({ ...schema, oneOf: undefined })};`,
    `export type ${name} = ${withoutKeys(base, keys)} & (`,
    `  | { readonly ${keys[0]}: ${propertyType(schema.properties[keys[0]])}; readonly ${
      keys[1]
    }?: never }`,
    `  | { readonly ${keys[1]}: ${propertyType(schema.properties[keys[1]])}; readonly ${
      keys[0]
    }?: never }`,
    ");",
  ].join("\n");
}

function inputRequestReferenceType() {
  const snapshotKeys = schemaPropertyKeys({ $ref: "#/$defs/InputRequestSnapshot" });
  const referenceKeys = new Set(schemaPropertyKeys({ $ref: "#/$defs/InputRequestReference" }));
  const forbidden = snapshotKeys.filter((key) => !referenceKeys.has(key));
  return `InputRequestReference & ${forbiddenProperties(forbidden)}`;
}

function inputRequestSnapshotType() {
  return `InputRequestSnapshot & ${forbiddenProperties(["uri"])}`;
}

function inputRequestCreatedSnapshotType() {
  return `Omit<InputRequestSnapshot, "status"> & { readonly status: "open" } & ${
    forbiddenProperties(["uri"])
  }`;
}

function inputRequestCreatedType(schema) {
  return [
    ...tsDoc(schema),
    "export type InputRequestCreated = {",
    "  readonly inputRequest:",
    `    | ${inputRequestReferenceType()}`,
    `    | (${inputRequestCreatedSnapshotType()});`,
    "  readonly extensions?: Extensions;",
    "};",
  ].join("\n");
}

function inputRequestUpdatedType(schema) {
  return [
    ...tsDoc(schema),
    "export type InputRequestUpdated =",
    "  | {",
    `    readonly inputRequest: ${inputRequestReferenceType()};`,
    "    readonly changes: InputRequestChanges;",
    "    readonly extensions?: Extensions;",
    "  }",
    "  | {",
    `    readonly inputRequest: ${inputRequestSnapshotType()};`,
    "    readonly changes?: never;",
    "    readonly extensions?: Extensions;",
    "  };",
  ].join("\n");
}

function definitionType(name, schema) {
  if (name === "JsonValue") {
    return [
      "export type EventJsonValue =",
      "  | null",
      "  | boolean",
      "  | number",
      "  | string",
      "  | readonly EventJsonValue[]",
      "  | EventJsonObject;",
    ].join("\n");
  }
  if (name === "JsonObject") {
    return "export type EventJsonObject = { readonly [key: string]: EventJsonValue };";
  }
  if (name === "Extensions") {
    return [
      ...tsDoc(schema),
      "export type Extensions = { readonly [namespace: string]: EventJsonObject };",
    ].join("\n");
  }
  if (name === "InputRequestCreated") return inputRequestCreatedType(schema);
  if (name === "InputRequestUpdated") return inputRequestUpdatedType(schema);
  if (schema.oneOf && schema.type === "object" && schema.properties) {
    const redacted = redactionUnion(name, schema);
    if (redacted) return redacted;
  }
  return [
    ...tsDoc(schema),
    `export type ${name} = ${propertyType(schema)};`,
  ].join("\n");
}

function envelopeRequiredByTypeInterface(name, metadataKey) {
  const lines = roots.flatMap(([, schema]) => {
    const fields = schema[metadataKey];
    if (!Array.isArray(fields) || fields.length === 0) return [];
    return `  readonly ${literal(schema["x-event-type"])}: ${fields.map(literal).join(" | ")};`;
  });
  return [
    `export interface ${name} {`,
    ...lines,
    "}",
  ].join("\n");
}

const roots = Object.entries(DEFINITIONS).filter(([, schema]) => schema["x-event-type"]);
const helperNames = Object.keys(DEFINITIONS).filter((name) => !DEFINITIONS[name]["x-event-type"]);
const rootNames = roots.map(([name]) => name);
const names = [...helperNames, ...rootNames];

const output = [
  "/**",
  " * Generated Agent Events Protocol payload types.",
  " *",
  " * Source: src/events/contracts/target-payload-schemas.json.",
  " * Regenerate with: deno run -A src/events/generate-payload-types.mjs",
  " */",
  "",
  "type EventAtLeastOne<T extends object> = {",
  "  readonly [K in keyof T]-?: T & { readonly [P in K]-?: T[P] };",
  "}[keyof T];",
  "",
  names.map((name) => definitionType(name, DEFINITIONS[name])).join("\n\n"),
  "",
  envelopeRequiredByTypeInterface("EventEnvelopeRequiredByType", "x-envelope-required"),
  "",
  envelopeRequiredByTypeInterface(
    "EventAttemptScopeEnvelopeRequiredByType",
    "x-attempt-scope-envelope-required",
  ),
  "",
  "export interface EventPayloadByType {",
  ...roots.map(([name, schema]) => `  readonly ${literal(schema["x-event-type"])}: ${name};`),
  "}",
  "",
  "export type EventPayload<TType extends keyof EventPayloadByType> =",
  "  EventPayloadByType[TType];",
  "",
].join("\n");

await writeFile(OUTPUT_PATH, output);
execFileSync(Deno.execPath(), ["fmt", fileURLToPath(OUTPUT_PATH)], { stdio: "inherit" });

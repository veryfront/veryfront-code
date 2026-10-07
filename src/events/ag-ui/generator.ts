export type Schema = Record<string, unknown>;

export function isRecord(value: unknown): value is Schema {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function literal(value: unknown): string {
  return JSON.stringify(value);
}

export function createNativeTypeGenerator(options: {
  recordSchema: Schema;
  pathAliases: ReadonlyMap<string, string>;
  label: string;
}) {
  const { recordSchema, pathAliases, label } = options;
  function failUnsupported(path: string, detail: string): never {
    throw new Error(`Unsupported AG-UI ${label} schema construct at ${path}: ${detail}`);
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
    const defs = recordSchema.$defs;
    if (!isRecord(defs)) failUnsupported("$defs", "schema definitions must be an object");
    return defs;
  }

  function resolveRef(ref: string): unknown {
    const defs = schemaDefs();
    const name = localRefName(ref);
    if (!(name in defs)) failUnsupported("$ref", `missing definition ${name}`);
    return defs[name];
  }

  function scalarType(type: unknown): string | undefined {
    switch (type) {
      case "string":
      case "boolean":
      case "null":
        return type;
      case "integer":
      case "number":
        return "number";
      default:
        return undefined;
    }
  }

  function tsForSchema(schemaValue: unknown, path: string): string {
    const alias = pathAliases.get(path);
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
    const scalar = scalarType(schema.type);
    if (scalar !== undefined) return scalar;
    if (schema.type === "array") {
      if (!("items" in schema)) failUnsupported(path, "array schema requires items");
      return readonlyArray(
        parenthesize(tsForSchema(schema.items, `${path}.items`)),
        schema.minItems,
      );
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
      Array.isArray(schema.required)
        ? schema.required.filter((key) => typeof key === "string")
        : [],
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
    if (!isRecord(propertySchema)) {
      failUnsupported(`${path}.${property}`, "property must be schema");
    }
    if (typeof propertySchema.const === "string") return propertySchema.const;
    failUnsupported(`${path}.${property}`, "property must be string const");
  }

  function recordVariantSchemas(): readonly Schema[] {
    const variants = recordSchema.oneOf;
    if (!Array.isArray(variants)) {
      failUnsupported("record.oneOf", "record schema must have variants");
    }
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
    if (!isRecord(protocolSchema)) {
      failUnsupported(`${defName}.protocol`, "protocol schema missing");
    }
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

  function recordGenericLines(schema: Schema, path: string, name: string): readonly string[] {
    const properties = schema.properties;
    if (!isRecord(properties)) failUnsupported(path, "record properties missing");
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((key) => typeof key === "string")
        : [],
    );
    return Object.keys(properties).map((key) => {
      const optional = required.has(key) ? "" : "?";
      if (key === "type") return `  readonly ${literal(key)}${optional}: TType;`;
      if (key === "dataschema") {
        return `  readonly ${literal(key)}${optional}: AgUiNative${name}Dataschema<TType>;`;
      }
      if (key === "data") {
        return `  readonly ${literal(key)}${optional}: AgUiNative${name}Payload<TType>;`;
      }
      return `  readonly ${literal(key)}${optional}: ${
        tsForSchema(properties[key], `${path}.${key}`)
      };`;
    });
  }

  function recordSource(
    options: {
      name: string;
      profile: string;
      schemaName: string;
      attributionLines?: readonly string[];
    },
  ): string {
    const { name, profile, schemaName } = options;
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
      ` * Generated internal AG-UI ${profile} record types.`,
      " *",
      ` * Source: src/events/ag-ui/native-${profile}-contract.ts ${schemaName}.`,
      ` * Regenerate with: deno run -A src/events/ag-ui/generate-native-${profile}-types.ts`,
      " */",
      "",
      'import type { AgUiEventOf, AgUiProtocolExtensionFields } from "#veryfront/events/ag-ui/types.ts";',
      "",
      `export type AgUiNative${name}Type =`,
      ...variantTypes.map(({ type }) => `  | ${literal(type)}`),
      "  ;",
      "",
      `export interface AgUiNative${name}DataschemaByType {`,
      ...variantTypes.map(({ type, dataschema }) =>
        `  readonly ${literal(type)}: ${literal(dataschema)};`
      ),
      "}",
      "",
      `export type AgUiNative${name}Dataschema<TType extends AgUiNative${name}Type> =`,
      `  AgUiNative${name}DataschemaByType[TType];`,
      "",
      ...(options.attributionLines ?? [
        `export interface AgUi${name}Attribution {`,
        "  readonly invocation?: {",
        "    readonly subagentRunId: string;",
        "  };",
        "}",
        "",
      ]),
      `export type AgUi${name}EventType =`,
      ...eventTypes.map((type) => `  | ${literal(type)}`),
      "  ;",
      "",
      `export interface AgUi${name}EventByType {`,
      ...eventTypes.map((type) => `  readonly ${type}: AgUiEventOf<${literal(type)}>;`),
      "}",
      "",
      ...payloads.flatMap(([name, schema]) => [
        `export type ${payloadTypeName(name)} = ${tsForSchema(schema, name)};`,
        "",
      ]),
      `export interface AgUiNative${name}PayloadByType {`,
      ...variantTypes.map(({ type, dataschema }) => {
        const defName = localRefName(dataschema);
        return `  readonly ${literal(type)}: ${payloadTypeName(defName)};`;
      }),
      "}",
      "",
      `type AgUi${name}ProtocolMetadataUnion = {`,
      `  readonly [TType in AgUiNative${name}Type]: AgUiNative${name}PayloadByType[TType] extends {`,
      "    readonly protocol: { readonly agui: infer TProtocol };",
      "  } ? TProtocol : never;",
      `}[AgUiNative${name}Type];`,
      "",
      `export type AgUi${name}ProtocolMetadata<`,
      `  TEventType extends AgUi${name}EventType = AgUi${name}EventType,`,
      `> = Extract<AgUi${name}ProtocolMetadataUnion, { readonly eventType: TEventType }>;`,
      "",
      `export type AgUiNative${name}Payload<TType extends AgUiNative${name}Type> =`,
      `  AgUiNative${name}PayloadByType[TType];`,
      "",
      `export type AgUiNative${name}AnyPayload = {`,
      `  readonly [TType in AgUiNative${name}Type]: AgUiNative${name}Payload<TType>;`,
      `}[AgUiNative${name}Type];`,
      "",
      `export type AgUiNative${name}Record<TType extends AgUiNative${name}Type> = {`,
      ...recordGenericLines(variants[0]!, "record.oneOf0", name),
      "};",
      "",
      `export type AgUiNative${name}AnyRecord = {`,
      `  readonly [TType in AgUiNative${name}Type]: AgUiNative${name}Record<TType>;`,
      `}[AgUiNative${name}Type];`,
      "",
    ];
    return lines.join("\n");
  }
  return { failUnsupported, resolveRef, tsForSchema, recordSource };
}

export async function writeGeneratedTypes(options: {
  source: string;
  outputPath: URL;
  tempPrefix: string;
  outdatedMessages: readonly string[];
}): Promise<void> {
  const path = await Deno.makeTempFile({ prefix: options.tempPrefix, suffix: ".ts" });
  let generated: string;
  try {
    await Deno.writeTextFile(path, options.source);
    const status = await new Deno.Command(Deno.execPath(), {
      args: ["fmt", "--config=deno.json", path],
      stdout: "null",
      stderr: "inherit",
    }).spawn().status;
    if (!status.success) Deno.exit(status.code);
    generated = await Deno.readTextFile(path);
  } finally {
    await Deno.remove(path).catch(() => undefined);
  }
  if (Deno.args.includes("--check")) {
    const current = await Deno.readTextFile(options.outputPath);
    if (current !== generated) {
      for (const message of options.outdatedMessages) console.error(message);
      Deno.exit(1);
    }
  } else {
    await Deno.writeTextFile(options.outputPath, generated);
  }
}

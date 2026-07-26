import type { ToolExecutionContext } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/tool/schema/json-schema.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type {
  SandboxShellClient,
  SandboxShellToolDefinition,
  SandboxShellToolSet,
  SandboxShellToolsProvider,
} from "#veryfront/extensions/sandbox/index.ts";

export type {
  SandboxShellClient as BashToolSandboxLike,
  SandboxShellToolDefinition,
  SandboxShellToolSet,
  SandboxShellToolsProvider as CreateSandboxBashTool,
} from "#veryfront/extensions/sandbox/index.ts";

const SANDBOX_WORKING_DIRECTORY = "/workspace";
const SANDBOX_TOOL_PROMPT =
  "Available tools: agent-browser, awk, cat, column, comm, curl, cut, diff, expand, find, fold, grep, head, iconv, join, jq, nl, node, od, paste, printf, python3, rev, sed, sort, split, strings, tail, tee, tr, unexpand, uniq, veryfront, wc, xargs, xxd, yq, and more";
const JSON_SCHEMA_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);
const JSON_SCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "type",
  "title",
  "description",
  "format",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "enum",
  "const",
  "default",
  "examples",
  "properties",
  "required",
  "propertyNames",
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "anyOf",
  "allOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "prefixItems",
  "contains",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
  "dependentRequired",
  "dependentSchemas",
]);
const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_NODES = 20_000;
const MAX_SCHEMA_BYTES = 4 * 1024 * 1024;
const MISSING = Symbol("missing sandbox tool property");
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ownKeys = Reflect.ownKeys;
const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function ownDataValue(
  record: Record<string, unknown>,
  key: string,
): unknown | typeof MISSING {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return MISSING;
  if (!("value" in descriptor)) {
    invalid(`Sandbox shell tool property ${key} must be a data property`);
  }
  return descriptor.value;
}

interface JsonSnapshotState {
  bytes: number;
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

function countSchemaBytes(value: string, state: JsonSnapshotState): void {
  const remaining = MAX_SCHEMA_BYTES - state.bytes;
  if (value.length > remaining) {
    invalid(`Sandbox tool JSON Schema exceeds ${MAX_SCHEMA_BYTES} bytes`);
  }
  const bytes = textEncoder.encode(value).byteLength;
  if (bytes > remaining) {
    invalid(`Sandbox tool JSON Schema exceeds ${MAX_SCHEMA_BYTES} bytes`);
  }
  state.bytes += bytes;
}

function snapshotJsonValue(
  value: unknown,
  state: JsonSnapshotState,
  depth = 0,
): unknown {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    countSchemaBytes(value, state);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Sandbox tool JSON Schema numbers must be finite");
    return value;
  }
  if (typeof value !== "object") {
    invalid("Sandbox tool JSON Schema must contain only JSON-compatible values");
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    invalid(`Sandbox tool JSON Schema exceeds ${MAX_SCHEMA_DEPTH} levels`);
  }
  state.nodes += 1;
  if (state.nodes > MAX_SCHEMA_NODES) {
    invalid(`Sandbox tool JSON Schema exceeds ${MAX_SCHEMA_NODES} nodes`);
  }
  if (state.ancestors.has(value)) {
    invalid("Sandbox tool JSON Schema must not be cyclic");
  }
  state.ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const output: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          invalid("Sandbox tool JSON Schema arrays must contain data properties");
        }
        output.push(snapshotJsonValue(descriptor.value, state, depth + 1));
      }
      return output;
    }

    const output: Record<string, unknown> = Object.create(null);
    for (const key of ownKeys(value)) {
      const descriptor = getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) continue;
      if (typeof key !== "string") {
        invalid("Sandbox tool JSON Schema must not contain symbol keys");
      }
      countSchemaBytes(key, state);
      if (!("value" in descriptor)) {
        invalid(`Sandbox tool JSON Schema property ${key} must be a data property`);
      }
      if (descriptor.value === undefined) continue;
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value: snapshotJsonValue(descriptor.value, state, depth + 1),
        writable: true,
      });
    }
    return output;
  } finally {
    state.ancestors.delete(value);
  }
}

function isJsonSchemaType(value: unknown): boolean {
  if (typeof value === "string") return JSON_SCHEMA_TYPES.has(value);
  if (!Array.isArray(value) || value.length === 0) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !JSON_SCHEMA_TYPES.has(item) || seen.has(item)) {
      return false;
    }
    seen.add(item);
  }
  return true;
}

function assertStringArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalid(`Sandbox tool JSON Schema ${label} must be an array of strings`);
  }
}

function assertSchemaArray(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    invalid(`Sandbox tool JSON Schema ${label} must be a non-empty schema array`);
  }
  for (const schema of value) assertJsonSchemaObject(schema, `${label} entry`);
}

function assertSchemaMap(value: unknown, label: string): void {
  if (!isRecord(value)) invalid(`Sandbox tool JSON Schema ${label} must be an object`);
  for (const schema of Object.values(value)) {
    assertJsonSchemaObject(schema, `${label} entry`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(`Sandbox tool JSON Schema ${label} must be a non-negative safe integer`);
  }
}

function assertJsonSchemaObject(value: unknown, label: string): asserts value is JsonSchema {
  if (!isRecord(value)) invalid(`Sandbox tool JSON Schema ${label} must be an object`);
  if (value.type !== undefined && !isJsonSchemaType(value.type)) {
    invalid("Sandbox tool JSON Schema type is invalid");
  }
  if (value.required !== undefined) assertStringArray(value.required, "required");
  if (value.properties !== undefined) assertSchemaMap(value.properties, "properties");
  if (value.$defs !== undefined) assertSchemaMap(value.$defs, "$defs");
  if (value.definitions !== undefined) assertSchemaMap(value.definitions, "definitions");
  for (const key of ["anyOf", "allOf", "oneOf", "prefixItems"] as const) {
    if (value[key] !== undefined) assertSchemaArray(value[key], key);
  }
  for (
    const key of [
      "propertyNames",
      "not",
      "if",
      "then",
      "else",
      "contains",
    ] as const
  ) {
    if (value[key] !== undefined) assertJsonSchemaObject(value[key], key);
  }
  if (
    value.items !== undefined &&
    !Array.isArray(value.items) &&
    !isRecord(value.items)
  ) {
    invalid("Sandbox tool JSON Schema items must be a schema or schema array");
  }
  if (Array.isArray(value.items)) assertSchemaArray(value.items, "items");
  else if (value.items !== undefined) assertJsonSchemaObject(value.items, "items");
  for (const key of ["additionalProperties", "unevaluatedProperties"] as const) {
    const candidate = value[key];
    if (
      candidate !== undefined &&
      typeof candidate !== "boolean" &&
      !isRecord(candidate)
    ) {
      invalid(`Sandbox tool JSON Schema ${key} must be a boolean or schema`);
    }
    if (isRecord(candidate)) assertJsonSchemaObject(candidate, key);
  }
  for (
    const key of [
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "minProperties",
      "maxProperties",
    ] as const
  ) {
    if (value[key] !== undefined) assertNonNegativeInteger(value[key], key);
  }
}

function looksLikeJsonSchema(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  for (const key of JSON_SCHEMA_KEYWORDS) {
    const descriptor = getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable) return true;
  }
  return false;
}

function normalizeJsonSchema(value: unknown): JsonSchema | undefined {
  if (!looksLikeJsonSchema(value)) return undefined;
  const snapshot = snapshotJsonValue(value, {
    bytes: 0,
    nodes: 0,
    ancestors: new WeakSet(),
  });
  assertJsonSchemaObject(snapshot, "root");
  return snapshot;
}

function isContractSchema(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (ownDataValue(value, "__zod") !== MISSING) return true;
  const output = ownDataValue(value, "_output");
  const parse = ownDataValue(value, "parse");
  const safeParse = ownDataValue(value, "safeParse");
  return (
    output !== MISSING &&
    typeof parse === "function" &&
    typeof safeParse === "function"
  );
}

function normalizeBashTool(
  toolName: string,
  toolDefinition: unknown,
): SandboxShellToolDefinition {
  if (!isRecord(toolDefinition)) {
    invalid(`Sandbox shell tool ${toolName} definition must be an object`);
  }

  const normalized: SandboxShellToolDefinition = { id: toolName };
  const id = ownDataValue(toolDefinition, "id");
  const type = ownDataValue(toolDefinition, "type");
  const title = ownDataValue(toolDefinition, "title");
  const description = ownDataValue(toolDefinition, "description");
  const inputSchema = ownDataValue(toolDefinition, "inputSchema");
  const inputSchemaJsonValue = ownDataValue(toolDefinition, "inputSchemaJson");
  const inputSchemaJson = inputSchemaJsonValue === MISSING ||
      inputSchemaJsonValue === undefined
    ? undefined
    : normalizeJsonSchema(inputSchemaJsonValue);
  if (
    inputSchemaJsonValue !== MISSING &&
    inputSchemaJsonValue !== undefined &&
    inputSchemaJson === undefined
  ) {
    invalid(`Sandbox shell tool ${toolName} inputSchemaJson is not a JSON Schema`);
  }
  const hasContractInputSchema = isContractSchema(inputSchema);
  const inputSchemaAsJson = hasContractInputSchema ? undefined : normalizeJsonSchema(inputSchema);
  const executeCandidate = ownDataValue(toolDefinition, "execute");
  const mcp = ownDataValue(toolDefinition, "mcp");
  const parameters = ownDataValue(toolDefinition, "parameters");
  const providerOptions = ownDataValue(toolDefinition, "providerOptions");

  if (typeof id === "string") {
    normalized.id = id;
  }
  if (type === "function" || type === "dynamic") {
    normalized.type = type;
  }
  if (typeof title === "string") {
    normalized.title = title;
  }
  if (typeof description === "string") {
    normalized.description = description;
  }
  if (inputSchema !== MISSING && inputSchema !== undefined) {
    normalized.inputSchema = inputSchema;
  }
  if (inputSchemaJson !== undefined) {
    normalized.inputSchemaJson = inputSchemaJson;
  } else if (inputSchemaAsJson !== undefined) {
    normalized.inputSchemaJson = inputSchemaAsJson;
  } else if (
    inputSchema !== MISSING &&
    inputSchema !== undefined &&
    !hasContractInputSchema
  ) {
    invalid(
      `Sandbox shell tool ${toolName} input schema cannot be converted; the provider must supply inputSchemaJson`,
    );
  }
  if (typeof executeCandidate === "function") {
    normalized.execute = async (input: unknown, options?: ToolExecutionContext) =>
      executeCandidate(input, options);
  }
  if (mcp !== MISSING && mcp !== undefined) {
    const snapshot = snapshotJsonValue(mcp, {
      bytes: 0,
      nodes: 0,
      ancestors: new WeakSet(),
    });
    if (!isRecord(snapshot)) invalid(`Sandbox shell tool ${toolName} mcp must be an object`);
    normalized.mcp = snapshot;
  }
  if (parameters !== MISSING && parameters !== undefined) {
    normalized.parameters = snapshotJsonValue(parameters, {
      bytes: 0,
      nodes: 0,
      ancestors: new WeakSet(),
    });
  }
  if (providerOptions !== MISSING && providerOptions !== undefined) {
    normalized.providerOptions = snapshotJsonValue(providerOptions, {
      bytes: 0,
      nodes: 0,
      ancestors: new WeakSet(),
    });
  }

  return normalized;
}

/** Normalizes bash tool set. */
export function normalizeBashToolSet(bashTools: Record<string, unknown>): SandboxShellToolSet {
  if (!isRecord(bashTools)) invalid("Sandbox shell tools must be an object");
  const normalized: SandboxShellToolSet = Object.create(null);
  for (const name of ownKeys(bashTools)) {
    const descriptor = getOwnPropertyDescriptor(bashTools, name);
    if (!descriptor?.enumerable) continue;
    if (typeof name !== "string" || name.length === 0) {
      invalid("Sandbox shell tool names must be non-empty strings");
    }
    if (!("value" in descriptor)) {
      invalid(`Sandbox shell tool ${name} must be a data property`);
    }
    Object.defineProperty(normalized, name, {
      configurable: true,
      enumerable: true,
      value: normalizeBashTool(name, descriptor.value),
      writable: true,
    });
  }
  return normalized;
}

/** Rename sandbox file tools. */
export function renameSandboxFileTools(
  bashTools: Record<string, unknown>,
): SandboxShellToolSet {
  const tools = normalizeBashToolSet(bashTools);

  const sandboxReadFile = tools.readFile;
  if (sandboxReadFile) {
    tools.sandbox_read_file = {
      ...sandboxReadFile,
      description:
        "Read a file from the sandbox /workspace filesystem only. This does NOT read project files stored in Veryfront. Use project file tools like get_file/get_files for real project source.",
    };
    delete tools.readFile;
  }

  const sandboxWriteFile = tools.writeFile;
  if (sandboxWriteFile) {
    tools.sandbox_write_file = {
      ...sandboxWriteFile,
      description:
        "Write a file inside the sandbox /workspace filesystem only. This does NOT update project files stored in Veryfront. Use project file tools like create_file/update_file for real project source.",
    };
    delete tools.writeFile;
  }

  const sandboxBash = tools.bash;
  if (sandboxBash) {
    tools.bash = {
      ...sandboxBash,
      description:
        "Run shell commands in the sandbox /workspace environment. This is for temporary shell work only and does NOT provide direct access to Veryfront project files.",
    };
  }

  return tools;
}

/** Create sandbox shell tools. */
export async function createSandboxShellTools(
  sandbox: SandboxShellClient,
  createShellTools: SandboxShellToolsProvider,
): Promise<SandboxShellToolSet> {
  const result = await createShellTools({
    sandbox,
    destination: SANDBOX_WORKING_DIRECTORY,
    promptOptions: {
      toolPrompt: SANDBOX_TOOL_PROMPT,
    },
  });
  if (!isRecord(result)) invalid("Sandbox shell tools provider must return an object");
  const bashTools = ownDataValue(result, "tools");
  if (!isRecord(bashTools)) {
    invalid("Sandbox shell tools provider result must include a tools object");
  }

  return renameSandboxFileTools(bashTools);
}

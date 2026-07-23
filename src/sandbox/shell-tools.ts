import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { ToolExecutionContext } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/tool/schema/json-schema.ts";
import type {
  SandboxShellClient,
  SandboxShellToolDefinition,
  SandboxShellToolSet,
  SandboxShellToolsProvider,
} from "#veryfront/extensions/sandbox/index.ts";

export type {
  CreateSandboxShellToolsInput,
  SandboxShellClient,
  SandboxShellClient as BashToolSandboxLike,
  SandboxShellToolAnnotations,
  SandboxShellToolDefinition,
  SandboxShellToolExecute,
  SandboxShellToolExecutionContext,
  SandboxShellToolJsonSchema,
  SandboxShellToolJsonSchemaTypeName,
  SandboxShellToolMcpConfig,
  SandboxShellToolSet,
  SandboxShellToolsProvider,
  SandboxShellToolsProvider as CreateSandboxBashTool,
  SandboxShellToolType,
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
const MAX_TOOL_COUNT = 256;
const MAX_TOOL_NAME_LENGTH = 256;
const MAX_SCHEMA_DEPTH = 32;
const MAX_SCHEMA_NODES = 10_000;
const MAX_SCHEMA_COLLECTION_SIZE = 1_000;
const MAX_SCHEMA_STRING_LENGTH = 1_048_576;
const INVALID_JSON_LITERAL = Symbol("invalid-json-literal");

interface SchemaNormalizationState {
  readonly active: WeakSet<object>;
  nodes: number;
}

function invalidShellTools(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function createPermissiveObjectSchema(): JsonSchema {
  return { type: "object", properties: {}, additionalProperties: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJsonSchemaType(value: unknown): JsonSchema["type"] | undefined {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (
    !values || values.length === 0 || values.length > JSON_SCHEMA_TYPES.size ||
    values.some((item) => typeof item !== "string" || !JSON_SCHEMA_TYPES.has(item))
  ) return undefined;
  const unique = [...new Set(values)] as NonNullable<JsonSchema["type"]>[];
  return unique.length === 1
    ? unique[0] as NonNullable<JsonSchema["type"]>
    : unique as JsonSchema["type"];
}

function normalizeJsonLiteral(
  value: unknown,
  state: SchemaNormalizationState,
  depth: number,
): unknown | typeof INVALID_JSON_LITERAL {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= MAX_SCHEMA_STRING_LENGTH ? value : INVALID_JSON_LITERAL;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID_JSON_LITERAL;
  if (typeof value !== "object") return INVALID_JSON_LITERAL;
  if (depth > MAX_SCHEMA_DEPTH) {
    invalidShellTools(`Sandbox shell tool schema exceeds ${MAX_SCHEMA_DEPTH} levels`);
  }
  if (state.active.has(value)) {
    invalidShellTools("Sandbox shell tool schema must not contain cycles");
  }
  state.nodes += 1;
  if (state.nodes > MAX_SCHEMA_NODES) {
    invalidShellTools("Sandbox shell tool schema exceeds the supported size");
  }
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_SCHEMA_COLLECTION_SIZE) return INVALID_JSON_LITERAL;
      const normalized: unknown[] = [];
      for (const item of value) {
        const result = normalizeJsonLiteral(item, state, depth + 1);
        if (result === INVALID_JSON_LITERAL) return INVALID_JSON_LITERAL;
        normalized.push(result);
      }
      return normalized;
    }
    if (!isRecord(value)) return INVALID_JSON_LITERAL;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID_JSON_LITERAL;
    const entries = Object.entries(value);
    if (entries.length > MAX_SCHEMA_COLLECTION_SIZE) return INVALID_JSON_LITERAL;
    const normalized: Record<string, unknown> = Object.create(null);
    for (const [key, item] of entries) {
      if (key.length === 0 || key.length > MAX_TOOL_NAME_LENGTH) return INVALID_JSON_LITERAL;
      const result = normalizeJsonLiteral(item, state, depth + 1);
      if (result === INVALID_JSON_LITERAL) return INVALID_JSON_LITERAL;
      normalized[key] = result;
    }
    return normalized;
  } finally {
    state.active.delete(value);
  }
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (
    !Array.isArray(value) || value.length > MAX_SCHEMA_COLLECTION_SIZE ||
    value.some((item) => typeof item !== "string" || item.length > MAX_TOOL_NAME_LENGTH)
  ) {
    return undefined;
  }

  return value.map(String);
}

function normalizeJsonSchemaArray(
  value: unknown,
  state: SchemaNormalizationState,
  depth: number,
): JsonSchema[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_SCHEMA_COLLECTION_SIZE) {
    return undefined;
  }

  const schemas = value.map((item) => normalizeJsonSchema(item, state, depth)).filter((schema) =>
    schema !== undefined
  );
  return schemas.length === value.length ? schemas : undefined;
}

function normalizeJsonSchemaProperties(
  value: unknown,
  state: SchemaNormalizationState,
  depth: number,
): Record<string, JsonSchema> | undefined {
  if (!isRecord(value) || Object.keys(value).length > MAX_SCHEMA_COLLECTION_SIZE) {
    return undefined;
  }

  const properties: Record<string, JsonSchema> = {};
  for (const [key, propertyValue] of Object.entries(value)) {
    if (key.length === 0 || key.length > MAX_TOOL_NAME_LENGTH) return undefined;
    const schema = normalizeJsonSchema(propertyValue, state, depth);
    if (schema === undefined) {
      return undefined;
    }
    properties[key] = schema;
  }
  return properties;
}

function normalizeJsonSchema(
  value: unknown,
  state: SchemaNormalizationState = { active: new WeakSet(), nodes: 0 },
  depth = 0,
): JsonSchema | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (depth > MAX_SCHEMA_DEPTH) {
    invalidShellTools(`Sandbox shell tool schema exceeds ${MAX_SCHEMA_DEPTH} levels`);
  }
  if (state.active.has(value)) {
    invalidShellTools("Sandbox shell tool schema must not contain cycles");
  }
  state.nodes += 1;
  if (state.nodes > MAX_SCHEMA_NODES) {
    invalidShellTools("Sandbox shell tool schema exceeds the supported size");
  }
  state.active.add(value);

  try {
    const schema: JsonSchema = {};
    const type = normalizeJsonSchemaType(value.type);
    const description = typeof value.description === "string" &&
        value.description.length <= MAX_SCHEMA_STRING_LENGTH
      ? value.description
      : undefined;
    const required = normalizeStringArray(value.required);
    const properties = normalizeJsonSchemaProperties(value.properties, state, depth + 1);
    const items = normalizeJsonSchema(value.items, state, depth + 1);
    const anyOf = normalizeJsonSchemaArray(value.anyOf, state, depth + 1);
    const prefixItems = normalizeJsonSchemaArray(value.prefixItems, state, depth + 1);

    if (type !== undefined) schema.type = type;
    if (description !== undefined) schema.description = description;
    if (Array.isArray(value.enum) && value.enum.length <= MAX_SCHEMA_COLLECTION_SIZE) {
      const normalizedEnum = normalizeJsonLiteral(value.enum, state, depth + 1);
      if (normalizedEnum !== INVALID_JSON_LITERAL) schema.enum = normalizedEnum as unknown[];
    }
    if ("const" in value) {
      const normalizedConst = normalizeJsonLiteral(value.const, state, depth + 1);
      if (normalizedConst !== INVALID_JSON_LITERAL) schema.const = normalizedConst;
    }
    if ("default" in value) {
      const normalizedDefault = normalizeJsonLiteral(value.default, state, depth + 1);
      if (normalizedDefault !== INVALID_JSON_LITERAL) schema.default = normalizedDefault;
    }
    if (properties !== undefined) schema.properties = properties;
    if (required !== undefined) schema.required = required;
    if (items !== undefined) schema.items = items;
    if (typeof value.additionalProperties === "boolean") {
      schema.additionalProperties = value.additionalProperties;
    } else {
      const additionalProperties = normalizeJsonSchema(
        value.additionalProperties,
        state,
        depth + 1,
      );
      if (additionalProperties !== undefined) schema.additionalProperties = additionalProperties;
    }
    if (anyOf !== undefined) schema.anyOf = anyOf;
    if (prefixItems !== undefined) schema.prefixItems = prefixItems;
    if (
      typeof value.minItems === "number" && Number.isSafeInteger(value.minItems) &&
      value.minItems >= 0
    ) {
      schema.minItems = value.minItems;
    }
    if (
      typeof value.maxItems === "number" && Number.isSafeInteger(value.maxItems) &&
      value.maxItems >= 0 && (schema.minItems === undefined || value.maxItems >= schema.minItems)
    ) {
      schema.maxItems = value.maxItems;
    }

    return schema;
  } finally {
    state.active.delete(value);
  }
}

function isContractSchema(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if ("__zod" in value) return true;
  return (
    "_output" in value &&
    typeof value.parse === "function" &&
    typeof value.safeParse === "function"
  );
}

function normalizeBashTool(
  toolName: string,
  toolDefinition: unknown,
): SandboxShellToolDefinition {
  if (!isRecord(toolDefinition)) {
    return { id: toolName };
  }

  const normalized: SandboxShellToolDefinition = { id: toolName };
  const id = toolDefinition.id;
  const type = toolDefinition.type;
  const title = toolDefinition.title;
  const description = toolDefinition.description;
  const inputSchema = toolDefinition.inputSchema;
  const inputSchemaJson = normalizeJsonSchema(toolDefinition.inputSchemaJson);
  const hasContractInputSchema = isContractSchema(inputSchema);
  const normalizedInputSchema = hasContractInputSchema
    ? undefined
    : normalizeJsonSchema(inputSchema);
  const inputSchemaAsJson = normalizedInputSchema !== undefined &&
      (Object.keys(normalizedInputSchema).length > 0 ||
        (isRecord(inputSchema) && Object.keys(inputSchema).length === 0))
    ? normalizedInputSchema
    : undefined;
  const executeCandidate = toolDefinition.execute;
  const mcp = toolDefinition.mcp;

  if (typeof id === "string" && id.length > 0 && id.length <= MAX_TOOL_NAME_LENGTH) {
    normalized.id = id;
  }
  if (type === "function" || type === "dynamic") {
    normalized.type = type;
  }
  if (typeof title === "string" && title.length <= MAX_SCHEMA_STRING_LENGTH) {
    normalized.title = title;
  }
  if (typeof description === "string" && description.length <= MAX_SCHEMA_STRING_LENGTH) {
    normalized.description = description;
  }
  if (inputSchema !== undefined) {
    normalized.inputSchema = inputSchema;
  }
  if (inputSchemaJson !== undefined) {
    normalized.inputSchemaJson = inputSchemaJson;
  } else if (inputSchemaAsJson !== undefined) {
    normalized.inputSchemaJson = inputSchemaAsJson;
  } else if (inputSchema !== undefined && !hasContractInputSchema) {
    normalized.inputSchemaJson = createPermissiveObjectSchema();
  }
  if (typeof executeCandidate === "function") {
    normalized.execute = async (input: unknown, options?: ToolExecutionContext) =>
      executeCandidate(input, options);
  }
  if (isRecord(mcp)) {
    normalized.mcp = Object.fromEntries(Object.entries(mcp));
  }

  return normalized;
}

/** Normalizes bash tool set. */
export function normalizeBashToolSet(bashTools: Record<string, unknown>): SandboxShellToolSet {
  if (!isRecord(bashTools)) invalidShellTools("Sandbox shell tools must be an object");
  const entries = Object.entries(bashTools);
  if (entries.length > MAX_TOOL_COUNT) {
    invalidShellTools("Sandbox shell tools exceed the supported entry count");
  }
  return Object.fromEntries(
    entries.map((
      [name, toolDefinition],
    ) => {
      if (name.length === 0 || name.length > MAX_TOOL_NAME_LENGTH) {
        invalidShellTools("Sandbox shell tool name is outside the supported range");
      }
      return [name, normalizeBashTool(name, toolDefinition)];
    }),
  );
}

/** Rename sandbox file tools. */
export function renameSandboxFileTools(bashTools: SandboxShellToolSet): SandboxShellToolSet {
  const tools: SandboxShellToolSet = { ...bashTools };

  if (tools.readFile && tools.sandbox_read_file) {
    invalidShellTools("Sandbox shell tools contain both readFile and sandbox_read_file");
  }
  if (tools.writeFile && tools.sandbox_write_file) {
    invalidShellTools("Sandbox shell tools contain both writeFile and sandbox_write_file");
  }

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
  if (!isRecord(result) || !isRecord(result.tools)) {
    invalidShellTools("Sandbox shell tools provider must return a tools object");
  }

  return renameSandboxFileTools(normalizeBashToolSet(result.tools));
}

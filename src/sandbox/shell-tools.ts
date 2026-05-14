import type { ToolExecutionContext } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/tool/schema/json-schema.ts";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeJsonSchemaType(value: unknown): JsonSchema["type"] | undefined {
  if (typeof value !== "string" || !JSON_SCHEMA_TYPES.has(value)) {
    return undefined;
  }

  switch (value) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
    case "object":
    case "array":
    case "null":
      return value;
  }
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }

  return value.map(String);
}

function normalizeJsonSchemaArray(value: unknown): JsonSchema[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const schemas = value.map(normalizeJsonSchema).filter((schema) => schema !== undefined);
  return schemas.length === value.length ? schemas : undefined;
}

function normalizeJsonSchemaProperties(value: unknown): Record<string, JsonSchema> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const properties: Record<string, JsonSchema> = {};
  for (const [key, propertyValue] of Object.entries(value)) {
    const schema = normalizeJsonSchema(propertyValue);
    if (schema === undefined) {
      return undefined;
    }
    properties[key] = schema;
  }
  return properties;
}

function normalizeJsonSchema(value: unknown): JsonSchema | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const schema: JsonSchema = {};
  const type = normalizeJsonSchemaType(value.type);
  const description = typeof value.description === "string" ? value.description : undefined;
  const required = normalizeStringArray(value.required);
  const properties = normalizeJsonSchemaProperties(value.properties);
  const items = normalizeJsonSchema(value.items);
  const anyOf = normalizeJsonSchemaArray(value.anyOf);
  const prefixItems = normalizeJsonSchemaArray(value.prefixItems);

  if (type !== undefined) schema.type = type;
  if (description !== undefined) schema.description = description;
  if (Array.isArray(value.enum)) schema.enum = [...value.enum];
  if ("const" in value) schema.const = value.const;
  if ("default" in value) schema.default = value.default;
  if (properties !== undefined) schema.properties = properties;
  if (required !== undefined) schema.required = required;
  if (items !== undefined) schema.items = items;
  if (typeof value.additionalProperties === "boolean") {
    schema.additionalProperties = value.additionalProperties;
  } else {
    const additionalProperties = normalizeJsonSchema(value.additionalProperties);
    if (additionalProperties !== undefined) schema.additionalProperties = additionalProperties;
  }
  if (anyOf !== undefined) schema.anyOf = anyOf;
  if (prefixItems !== undefined) schema.prefixItems = prefixItems;
  if (typeof value.minItems === "number") schema.minItems = value.minItems;
  if (typeof value.maxItems === "number") schema.maxItems = value.maxItems;

  return schema;
}

function normalizeBashTool(toolDefinition: unknown): SandboxShellToolDefinition {
  if (!isRecord(toolDefinition)) {
    return {};
  }

  const normalized: SandboxShellToolDefinition = {};
  const id = toolDefinition.id;
  const type = toolDefinition.type;
  const description = toolDefinition.description;
  const inputSchema = toolDefinition.inputSchema;
  const inputSchemaJson = normalizeJsonSchema(toolDefinition.inputSchemaJson);
  const executeCandidate = toolDefinition.execute;
  const mcp = toolDefinition.mcp;

  if (typeof id === "string") {
    normalized.id = id;
  }
  if (type === "function" || type === "dynamic") {
    normalized.type = type;
  }
  if (typeof description === "string") {
    normalized.description = description;
  }
  if (inputSchema !== undefined) {
    normalized.inputSchema = inputSchema;
  }
  if (inputSchemaJson !== undefined) {
    normalized.inputSchemaJson = inputSchemaJson;
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

export function normalizeBashToolSet(bashTools: Record<string, unknown>): SandboxShellToolSet {
  return Object.fromEntries(
    Object.entries(bashTools).map((
      [name, toolDefinition],
    ) => [name, normalizeBashTool(toolDefinition)]),
  );
}

export function renameSandboxFileTools(bashTools: SandboxShellToolSet): SandboxShellToolSet {
  const tools: SandboxShellToolSet = { ...bashTools };

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

export async function createSandboxShellTools(
  sandbox: SandboxShellClient,
  createShellTools: SandboxShellToolsProvider,
): Promise<SandboxShellToolSet> {
  const { tools: bashTools } = await createShellTools({
    sandbox,
    destination: SANDBOX_WORKING_DIRECTORY,
    promptOptions: {
      toolPrompt: SANDBOX_TOOL_PROMPT,
    },
  });

  return renameSandboxFileTools(normalizeBashToolSet(bashTools));
}

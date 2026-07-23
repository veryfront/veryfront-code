import { dynamicTool, tool } from "./factory.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { JsonSchema, Schema } from "#veryfront/extensions/schema/index.ts";
import type { Tool, ToolConfig, ToolExecutionContext, ToolSet } from "./types.ts";

/** Execution callback accepted from a host-provided tool definition. */
export type HostToolExecute = {
  bivarianceHack: (input: unknown, options?: ToolExecutionContext) => Promise<unknown> | unknown;
}["bivarianceHack"];

/** Definition for host tool. */
export type HostToolDefinition = {
  id?: string;
  type?: Tool["type"];
  /** Owning agent id retained for owner-aware hosted tool selection. */
  ownerAgentId?: string;
  /** Short selector accepted by the owning agent's `tools:` configuration. */
  shortName?: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  inputSchemaJson?: JsonSchema;
  parameters?: unknown;
  providerOptions?: unknown;
  execute?: Tool["execute"] | HostToolExecute;
  mcp?: ToolConfig["mcp"];
};

/** Public API contract for host tool set. */
export type HostToolSet = Record<string, HostToolDefinition>;

type RunnableHostToolDefinition = HostToolDefinition & {
  description: string;
  inputSchema: Schema<unknown>;
  execute: HostToolExecute;
};

const INVALID_HOST_PROPERTY = Symbol("invalid-host-property");

const MAX_HOST_METADATA_LENGTH = 128;
const MAX_HOST_TOOL_DEFINITIONS = 10_000;
const MAX_TOOL_CALL_ID_LENGTH = 512;

/** Options accepted by host tool materialization. */
export interface HostToolMaterializationOptions {
  /** Creates a stable call identifier when the execution context does not provide one. */
  generateToolCallId?: (toolName: string) => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUnsafeControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isOptionalHostMetadata(value: unknown): value is string | undefined {
  return value === undefined ||
    (typeof value === "string" && value.trim().length > 0 && value.trim() === value &&
      value.length <= MAX_HOST_METADATA_LENGTH && !hasUnsafeControlCharacter(value));
}

/** Detect a contract `Schema<T>` value produced by defineSchema. */
function isSchemaLike(value: unknown): value is Schema<unknown> {
  if (!isRecord(value)) return false;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const parse = descriptors.parse;
    if (!parse || !("value" in parse) || typeof parse.value !== "function") return false;
    const brand = descriptors.__zod;
    if (brand && "value" in brand) return true;
    const output = descriptors._output;
    const safeParse = descriptors.safeParse;
    return Boolean(
      output && "value" in output && safeParse && "value" in safeParse &&
        typeof safeParse.value === "function",
    );
  } catch {
    return false;
  }
}

function readHostDataProperty(
  descriptors: PropertyDescriptorMap,
  property: keyof HostToolDefinition,
): unknown | typeof INVALID_HOST_PROPERTY {
  const descriptor = descriptors[property];
  if (!descriptor) return undefined;
  return "value" in descriptor ? descriptor.value : INVALID_HOST_PROPERTY;
}

function snapshotRunnableHostToolDefinition(
  value: unknown,
): RunnableHostToolDefinition | undefined {
  if (!isRecord(value)) return undefined;
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return undefined;
  }

  const description = readHostDataProperty(descriptors, "description");
  const inputSchema = readHostDataProperty(descriptors, "inputSchema");
  const execute = readHostDataProperty(descriptors, "execute");
  const ownerAgentId = readHostDataProperty(descriptors, "ownerAgentId");
  const shortName = readHostDataProperty(descriptors, "shortName");
  const inputSchemaJson = readHostDataProperty(descriptors, "inputSchemaJson");
  const mcp = readHostDataProperty(descriptors, "mcp");
  if (
    [description, inputSchema, execute, ownerAgentId, shortName, inputSchemaJson, mcp].includes(
      INVALID_HOST_PROPERTY,
    ) || typeof description !== "string" || !isSchemaLike(inputSchema) ||
    typeof execute !== "function" || !isOptionalHostMetadata(ownerAgentId) ||
    !isOptionalHostMetadata(shortName) ||
    (shortName !== undefined && ownerAgentId === undefined)
  ) {
    return undefined;
  }

  return {
    description,
    inputSchema,
    execute: execute as HostToolExecute,
    ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
    ...(shortName === undefined ? {} : { shortName }),
    ...(inputSchemaJson === undefined ? {} : { inputSchemaJson: inputSchemaJson as JsonSchema }),
    ...(mcp === undefined ? {} : { mcp: mcp as ToolConfig["mcp"] }),
  };
}

function defaultToolCallId(toolName: string): string {
  return `${toolName}-${crypto.randomUUID()}`;
}

function getHostDefinitionEntries(
  definitions: Record<string, unknown>,
): Array<[string, unknown]> {
  if (!isRecord(definitions)) {
    throw INVALID_ARGUMENT.create({ detail: "Host tool definitions must be an object" });
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(definitions);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "Host tool definitions could not be inspected" });
  }
  const names = Object.keys(descriptors);
  if (names.length > MAX_HOST_TOOL_DEFINITIONS) {
    throw INVALID_ARGUMENT.create({
      detail: `Host tool definitions cannot exceed ${MAX_HOST_TOOL_DEFINITIONS} entries`,
    });
  }
  const entries: Array<[string, unknown]> = [];
  for (const name of names) {
    const descriptor = descriptors[name];
    if (descriptor?.enumerable && "value" in descriptor) {
      entries.push([name, descriptor.value]);
    }
  }
  return entries;
}

function normalizeExecutionContext(
  toolName: string,
  context: ToolExecutionContext | undefined,
  generateToolCallId: (toolName: string) => string,
): ToolExecutionContext {
  const toolCallId = typeof context?.toolCallId === "string" && context.toolCallId.length > 0
    ? context.toolCallId
    : generateToolCallId(toolName);
  if (typeof toolCallId !== "string" || toolCallId.trim().length === 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Generated tool call id must be a non-empty string",
    });
  }
  if (
    toolCallId.trim() !== toolCallId || toolCallId.length > MAX_TOOL_CALL_ID_LENGTH ||
    hasUnsafeControlCharacter(toolCallId)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Generated tool call id is invalid" });
  }

  return {
    ...(isRecord(context) ? context : {}),
    toolCallId,
  };
}

/** Create tools from host definitions. */
export function createToolsFromHostDefinitions(
  definitions: HostToolSet,
  options?: HostToolMaterializationOptions,
): ToolSet;
/** Create tools from host definitions. */
export function createToolsFromHostDefinitions(
  definitions: Record<string, unknown>,
  options?: HostToolMaterializationOptions,
): ToolSet;
/** Create tools from host definitions. */
export function createToolsFromHostDefinitions(
  definitions: Record<string, unknown>,
  options: HostToolMaterializationOptions = {},
): ToolSet {
  const tools: ToolSet = {};
  const generateToolCallId = options.generateToolCallId ?? defaultToolCallId;
  if (typeof generateToolCallId !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "generateToolCallId must be a function" });
  }

  for (const [toolName, rawDefinition] of getHostDefinitionEntries(definitions)) {
    const definition = snapshotRunnableHostToolDefinition(rawDefinition);
    if (!definition) continue;

    const hostExecute = definition.execute;
    const execute = async (input: unknown, context: ToolExecutionContext | undefined) =>
      await hostExecute(
        input,
        normalizeExecutionContext(toolName, context, generateToolCallId),
      );

    try {
      const runtimeTool = definition.inputSchemaJson
        ? dynamicTool({
          id: toolName,
          description: definition.description,
          inputSchema: definition.inputSchema,
          inputSchemaJson: definition.inputSchemaJson,
          execute,
          mcp: definition.mcp,
        })
        : tool({
          id: toolName,
          description: definition.description,
          inputSchema: definition.inputSchema,
          execute,
          mcp: definition.mcp,
        });
      runtimeTool.ownerAgentId = definition.ownerAgentId;
      runtimeTool.shortName = definition.shortName;
      Object.defineProperty(tools, toolName, {
        value: runtimeTool,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } catch (error) {
      agentLogger.warn("Skipping host tool: schema conversion failed", {
        toolName,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      continue;
    }
  }

  return tools;
}

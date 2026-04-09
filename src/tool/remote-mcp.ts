import type { ToolAnnotations } from "#veryfront/mcp/types.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";

type ResolvableValue<T> = T | ((context?: ToolExecutionContext) => T | Promise<T>);

export interface RemoteMCPToolSourceConfig {
  id?: string;
  endpoint: ResolvableValue<string>;
  headers?: ResolvableValue<HeadersInit | undefined>;
  fetch?: typeof fetch;
  listMethod?: string;
  callMethod?: string;
}

interface JsonRpcErrorObject {
  message?: unknown;
  data?: unknown;
}

interface JsonRpcCallToolContentItem {
  text?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isToolAnnotations(value: unknown): value is ToolAnnotations {
  if (!isRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (
      key !== "readOnlyHint" &&
      key !== "destructiveHint" &&
      key !== "idempotentHint" &&
      key !== "openWorldHint"
    ) {
      return false;
    }

    const entry = value[key];
    if (entry !== undefined && typeof entry !== "boolean") {
      return false;
    }
  }

  return true;
}

function normalizeParameters(inputSchema: unknown): JsonSchema {
  if (!isRecord(inputSchema) || Object.keys(inputSchema).length === 0) {
    return { type: "object", properties: {} };
  }

  return inputSchema as JsonSchema;
}

function normalizeToolDefinitions(result: unknown): ToolDefinition[] {
  if (!isRecord(result)) return [];
  const rawTools = result.tools;
  if (!Array.isArray(rawTools)) return [];

  const definitions: ToolDefinition[] = [];
  for (const entry of rawTools) {
    if (!isRecord(entry)) continue;
    if (typeof entry.name !== "string" || entry.name.length === 0) continue;
    if (typeof entry.description !== "string") continue;

    const definition: ToolDefinition = {
      name: entry.name,
      description: entry.description,
      parameters: normalizeParameters(entry.inputSchema),
    };

    if (typeof entry.title === "string" && entry.title.length > 0) {
      definition.title = entry.title;
    }
    if (isToolAnnotations(entry.annotations)) {
      definition.annotations = entry.annotations;
    }

    definitions.push(definition);
  }

  return definitions;
}

function joinCallToolText(content: JsonRpcCallToolContentItem[]): string {
  return content
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter((item) => item.length > 0)
    .join("\n");
}

function parseJsonText(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function extractJsonRpcErrorMessage(payload: Record<string, unknown>): string {
  const rawError = payload.error;
  if (!isRecord(rawError)) return "Remote MCP server returned an error";

  const errorObject = rawError as JsonRpcErrorObject;
  if (typeof errorObject.message === "string" && errorObject.message.length > 0) {
    return errorObject.message;
  }
  if (typeof errorObject.data === "string" && errorObject.data.length > 0) {
    return errorObject.data;
  }
  if (isRecord(errorObject.data) && typeof errorObject.data.detail === "string") {
    return errorObject.data.detail;
  }

  return "Remote MCP server returned an error";
}

async function resolveValue<T>(
  value: ResolvableValue<T>,
  context?: ToolExecutionContext,
): Promise<T> {
  if (typeof value === "function") {
    return await value(context);
  }
  return value;
}

async function resolveHeaders(
  headers: ResolvableValue<HeadersInit | undefined> | undefined,
  context?: ToolExecutionContext,
): Promise<Headers> {
  const resolvedHeaders = headers ? await resolveValue(headers, context) : undefined;
  const finalHeaders = new Headers(resolvedHeaders);
  finalHeaders.set("Content-Type", "application/json");
  return finalHeaders;
}

async function postJsonRpc(
  endpoint: string,
  headers: Headers,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Remote MCP request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  return await response.json();
}

function getJsonRpcResult(payload: unknown): unknown {
  if (!isRecord(payload)) {
    throw new Error("Remote MCP response was not a JSON object");
  }

  if ("error" in payload) {
    throw new Error(extractJsonRpcErrorMessage(payload));
  }

  if (!("result" in payload)) {
    throw new Error("Remote MCP response did not include a result");
  }

  return payload.result;
}

function normalizeCallToolResult(result: unknown): unknown {
  if (!isRecord(result)) return result;

  const rawContent = result.content;
  if (Array.isArray(rawContent)) {
    const text = joinCallToolText(
      rawContent.filter((item): item is JsonRpcCallToolContentItem => isRecord(item)),
    );

    if (result.isError === true) {
      return parseJsonText(text) ?? { error: "tool_error", message: text };
    }

    if ("structuredContent" in result) {
      return result.structuredContent;
    }

    return parseJsonText(text) ?? text;
  }

  if ("structuredContent" in result) {
    return result.structuredContent;
  }

  return result;
}

export function createRemoteMCPToolSource(
  config: RemoteMCPToolSourceConfig,
): RemoteToolSource {
  const id = config.id ?? "remote-mcp";
  const listMethod = config.listMethod ?? "tools/list";
  const callMethod = config.callMethod ?? "tools/call";

  return {
    id,
    async listTools(context) {
      const endpoint = await resolveValue(config.endpoint, context);
      const headers = await resolveHeaders(config.headers, context);
      const payload = await postJsonRpc(
        endpoint,
        headers,
        {
          jsonrpc: "2.0",
          id: `${id}:tools:list`,
          method: listMethod,
        },
        config.fetch ?? globalThis.fetch,
      );

      return normalizeToolDefinitions(getJsonRpcResult(payload));
    },

    async executeTool(toolName, args, context) {
      const endpoint = await resolveValue(config.endpoint, context);
      const headers = await resolveHeaders(config.headers, context);
      const payload = await postJsonRpc(
        endpoint,
        headers,
        {
          jsonrpc: "2.0",
          id: `${id}:tools:call:${toolName}`,
          method: callMethod,
          params: {
            name: toolName,
            arguments: args,
          },
        },
        config.fetch ?? globalThis.fetch,
      );

      return normalizeCallToolResult(getJsonRpcResult(payload));
    },
  };
}

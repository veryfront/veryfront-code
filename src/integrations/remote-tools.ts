/**
 * Remote Integration Tools
 *
 * Fetches integration tool definitions from the API and executes tool calls
 * via the API's /integrations/tools/call endpoint.
 *
 * Design: NO global registration. Tools are fetched per-request because
 * different projects have different enabled integrations. The agent runtime
 * calls these functions at tool-enumeration and tool-execution time.
 */

import { logger } from "#veryfront/utils";
import { getApiBaseUrlEnv, getApiTokenEnv } from "#veryfront/config/env.ts";

import type { ToolDefinition } from "#veryfront/tool";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RemoteToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface CallToolTextContent {
  text?: string;
}

// ---------------------------------------------------------------------------
// Per-request token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the API token for the current request context.
 * In multi-tenant mode, different projects have different tokens.
 * Falls back to the environment token for single-project mode.
 */
function resolveRequestToken(): string | undefined {
  try {
    const mod = (globalThis as Record<string, unknown>).__vf_multi_project_adapter as
      | {
        getCurrentRequestContext?: () => { token?: string } | null;
      }
      | undefined;
    const reqToken = mod?.getCurrentRequestContext?.()?.token;
    if (reqToken) return reqToken;
  } catch {
    // Not in multi-project mode
  }
  return getApiTokenEnv();
}

// ---------------------------------------------------------------------------
// API communication
// ---------------------------------------------------------------------------

function joinCallToolText(content: CallToolTextContent[]): string {
  return content.map((item) => item.text).join("\n");
}

function parseJsonText(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function fetchToolList(
  baseUrl: string,
  token: string,
): Promise<RemoteToolDefinition[]> {
  const response = await fetch(`${baseUrl}/integrations/tools/list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    logger.warn("Failed to fetch integration tools from API", {
      status: response.status,
    });
    return [];
  }

  const data = (await response.json()) as { tools: RemoteToolDefinition[] };
  return data.tools ?? [];
}

async function callRemoteTool(
  baseUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
  endUserId?: string,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}/integrations/tools/call`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: toolName,
      arguments: args,
      end_user_id: endUserId,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return { error: "api_error", status: response.status, message: text };
  }

  const result = await response.json();

  // If MCP CallToolResult format, extract content
  if (result?.content && Array.isArray(result.content)) {
    const text = joinCallToolText(result.content as CallToolTextContent[]);

    if (result.isError) {
      // Try to preserve structured error data (e.g., authentication_required with connectUrl)
      const parsed = parseJsonText(text);
      if (parsed && typeof parsed === "object") return parsed;
      return { error: "tool_error", message: text };
    }

    if (result.structuredContent) return result.structuredContent;

    return parseJsonText(text) ?? text;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API — called by agent runtime per-request
// ---------------------------------------------------------------------------

/**
 * Fetch integration tool definitions for the current request context.
 * Returns ToolDefinition[] that the agent runtime merges into the model's
 * available tools. Returns empty array if no API config or no tools.
 *
 * Called per agent loop iteration — results are scoped to the current
 * project's enabled integrations via the per-request API token.
 */
export async function getRemoteIntegrationToolDefinitions(): Promise<
  ToolDefinition[]
> {
  const baseUrl = getApiBaseUrlEnv();
  const token = resolveRequestToken();
  if (!baseUrl || !token) return [];

  try {
    const remoteDefs = await fetchToolList(baseUrl, token);
    return remoteDefs.map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.inputSchema && Object.keys(def.inputSchema).length > 0
        ? def.inputSchema
        : { type: "object", properties: {} },
    }));
  } catch (err) {
    logger.warn("Failed to fetch remote integration tool definitions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Check if a tool name looks like a remote integration tool.
 * Integration tools use "integration:tool-id" format.
 */
export function isRemoteIntegrationTool(toolName: string): boolean {
  return toolName.includes(":");
}

/**
 * Execute a remote integration tool via the API.
 * Called by the agent runtime when a tool isn't found in the local registry.
 */
export async function executeRemoteIntegrationTool(
  toolName: string,
  args: Record<string, unknown>,
  endUserId?: string,
): Promise<unknown> {
  const baseUrl = getApiBaseUrlEnv();
  const token = resolveRequestToken();
  if (!baseUrl || !token) {
    return { error: "no_api_token", message: "No API token available" };
  }

  return callRemoteTool(baseUrl, token, toolName, args, endUserId);
}

/**
 * Sync integration config from veryfront.config.ts to the API.
 * This is a full-replace operation. Called by the MCP server path
 * which has access to the config.
 */
export async function syncIntegrationConfig(
  apiBaseUrl: string,
  apiToken: string,
  integrations: Record<string, { scope?: string; tools?: string[] }>,
): Promise<void> {
  try {
    const response = await fetch(`${apiBaseUrl}/integrations/config`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ integrations }),
    });

    if (!response.ok) {
      logger.warn("Failed to sync integration config to API", {
        status: response.status,
      });
    } else {
      const data = (await response.json()) as { synced: number };
      logger.info("Synced integration config to API", { synced: data.synced });
    }
  } catch (err) {
    logger.warn("Failed to sync integration config", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

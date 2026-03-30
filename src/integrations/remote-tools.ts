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

function resolveApiBaseUrl(): string | undefined {
  return getApiBaseUrlEnv();
}

// ---------------------------------------------------------------------------
// API communication
// ---------------------------------------------------------------------------

async function fetchToolList(
  baseUrl: string,
  token: string,
): Promise<RemoteToolDefinition[]> {
  const res = await fetch(`${baseUrl}/integrations/tools/list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    logger.warn("Failed to fetch integration tools from API", {
      status: res.status,
    });
    return [];
  }

  const data = (await res.json()) as { tools: RemoteToolDefinition[] };
  return data.tools ?? [];
}

async function callRemoteTool(
  baseUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
  endUserId?: string,
): Promise<unknown> {
  const res = await fetch(`${baseUrl}/integrations/tools/call`, {
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

  if (!res.ok) {
    const text = await res.text();
    return { error: "api_error", status: res.status, message: text };
  }

  const result = await res.json();

  // If MCP CallToolResult format, extract content
  if (result?.content && Array.isArray(result.content)) {
    if (result.isError) {
      const errorText = result.content
        .map((c: { text?: string }) => c.text)
        .join("\n");
      // Try to preserve structured error data (e.g., authentication_required with connectUrl)
      try {
        const parsed = JSON.parse(errorText);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        // Not JSON
      }
      return { error: "tool_error", message: errorText };
    }
    if (result.structuredContent) return result.structuredContent;
    const text = result.content
      .map((c: { text?: string }) => c.text)
      .join("\n");
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
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
  const baseUrl = resolveApiBaseUrl();
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
  const baseUrl = resolveApiBaseUrl();
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
    const res = await fetch(`${apiBaseUrl}/integrations/config`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ integrations }),
    });

    if (!res.ok) {
      logger.warn("Failed to sync integration config to API", {
        status: res.status,
      });
    } else {
      const data = (await res.json()) as { synced: number };
      logger.info("Synced integration config to API", { synced: data.synced });
    }
  } catch (err) {
    logger.warn("Failed to sync integration config", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

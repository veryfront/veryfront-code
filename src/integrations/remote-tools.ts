/**
 * Remote Integration Tools
 *
 * Fetches integration tool definitions from the API and executes tool calls
 * via the API's /integrations/tools/call endpoint.
 *
 * Design: NO global registration. Tools are fetched per-request because
 * different projects expose different authorized integration tools. The agent runtime
 * calls these functions at tool-enumeration and tool-execution time.
 */

import { logger } from "#veryfront/utils";
import { getApiBaseUrlEnv, getApiTokenEnv } from "#veryfront/config/env.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  parseIntegrationToolIdentity,
} from "#veryfront/integrations/source-policy.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

import type { ToolDefinition } from "#veryfront/tool";

/**
 * Default timeout for outbound integration API calls. Without it, a hung remote
 * server would block the whole agent loop indefinitely.
 */
const INTEGRATION_REQUEST_TIMEOUT_MS = 30_000;

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

type RemoteIntegrationToolExecutionContext = {
  runId?: string;
  agentId?: string;
};

// ---------------------------------------------------------------------------
// Per-request token resolution
// ---------------------------------------------------------------------------

function isValidApiToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token === token.trim();
}

/**
 * Resolve the API token for the active runtime mode.
 * Proxy mode requires a valid request-scoped project token. Single-project
 * runtimes may use their process-wide environment token.
 */
function resolveRequestToken(): string | undefined {
  const requestContext = getCurrentRequestContext();
  if (requestContext) {
    return isValidApiToken(requestContext.token) ? requestContext.token : undefined;
  }
  if (getEnvironmentConfig().proxyMode) return undefined;

  const environmentToken = getApiTokenEnv();
  return isValidApiToken(environmentToken) ? environmentToken : undefined;
}

// ---------------------------------------------------------------------------
// API communication
// ---------------------------------------------------------------------------

function joinCallToolText(content: CallToolTextContent[]): string {
  return content
    .map((item) => item.text)
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

function parseJsonText(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteToolDefinition(value: unknown): value is RemoteToolDefinition {
  return isRecord(value) &&
    typeof value.name === "string" &&
    isRemoteIntegrationTool(value.name) &&
    typeof value.description === "string" &&
    isRecord(value.inputSchema);
}

function isToolListResponse(value: unknown): value is { tools: RemoteToolDefinition[] } {
  return isRecord(value) &&
    Array.isArray(value.tools) &&
    value.tools.every(isRemoteToolDefinition);
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
    signal: AbortSignal.timeout(INTEGRATION_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    // Throw so callers can distinguish a fetch failure from "no remote tools
    // available" (which returns an empty tools array with status 200).
    throw new Error(
      `Integration tools API returned ${response.status} ${response.statusText}`.trim(),
    );
  }

  const rawData = await response.json();
  if (!isToolListResponse(rawData)) {
    throw new Error("Integration tools API returned unexpected response shape");
  }
  return rawData.tools ?? [];
}

async function callRemoteTool(
  baseUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
  context?: RemoteIntegrationToolExecutionContext,
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
      run_id: context?.runId,
      agent_id: context?.agentId,
    }),
    signal: AbortSignal.timeout(INTEGRATION_REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    return { error: "api_error", status: response.status, message: text };
  }

  const result = await response.json();

  // If MCP CallToolResult format, extract content
  if (result?.content && Array.isArray(result.content)) {
    const text = joinCallToolText(result.content as CallToolTextContent[]);

    if (result.structuredContent) {
      return result.structuredContent;
    }

    if (result.isError) {
      // Try to preserve structured error data (e.g., authentication_required with connectUrl)
      const parsed = parseJsonText(text);
      if (parsed && typeof parsed === "object") return parsed;
      return { error: "tool_error", message: text };
    }

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
 * project's authorized integration tools via the per-request API token.
 */
export async function getRemoteIntegrationToolDefinitions(): Promise<
  ToolDefinition[]
> {
  const baseUrl = getApiBaseUrlEnv();
  const token = resolveRequestToken();
  if (!baseUrl || !token) return [];

  try {
    const remoteDefs = await fetchToolList(baseUrl, token);
    const sourceIntegrationPolicy = getActiveSourceIntegrationPolicy();
    return remoteDefs.filter((def) =>
      sourceIntegrationPolicy === undefined ||
      isIntegrationToolAllowedBySourcePolicy(def.name, sourceIntegrationPolicy)
    ).map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.inputSchema && Object.keys(def.inputSchema).length > 0
        ? def.inputSchema
        : { type: "object", properties: {} },
    }));
  } catch (err) {
    logger.error("Failed to fetch remote integration tool definitions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Check if a tool name looks like a remote integration tool.
 * Integration tools use "integration__tool_id" format (double underscore separator).
 */
export function isRemoteIntegrationTool(toolName: string): boolean {
  return parseIntegrationToolIdentity(toolName) !== null;
}

/**
 * Execute a remote integration tool via the API.
 * Called by the agent runtime when a tool isn't found in the local registry.
 */
export async function executeRemoteIntegrationTool(
  toolName: string,
  args: Record<string, unknown>,
  context?: RemoteIntegrationToolExecutionContext,
): Promise<unknown> {
  if (!isRemoteIntegrationTool(toolName)) {
    throw new Error(
      `Remote integration tool "${toolName}" must use the canonical integration__tool_id name`,
    );
  }

  const sourceIntegrationPolicy = getActiveSourceIntegrationPolicy();
  if (
    sourceIntegrationPolicy !== undefined &&
    !isIntegrationToolAllowedBySourcePolicy(toolName, sourceIntegrationPolicy)
  ) {
    throw new Error(`Tool "${toolName}" is not allowed by the source integration policy`);
  }

  const baseUrl = getApiBaseUrlEnv();
  const token = resolveRequestToken();
  if (!baseUrl || !token) {
    return { error: "no_api_token", message: "No API token available" };
  }

  return callRemoteTool(
    baseUrl,
    token,
    toolName,
    args,
    context,
  );
}

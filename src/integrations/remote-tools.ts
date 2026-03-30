/**
 * Remote Integration Tools
 *
 * Loads integration tools from the API and registers them as local proxy tools.
 * Tools are forwarded to the API's POST /integrations/tools/call endpoint.
 *
 * Two loading strategies:
 * - Eager: Load all tools at startup for projects with few integrations (<=5)
 * - On-demand: Register a `use_integration` meta-tool that loads tools when called
 */

import { dynamicTool, type Tool } from "#veryfront/tool";
import { tool } from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { z } from "zod";
import { logger } from "#veryfront/utils";

/** Maximum number of integrations before switching to on-demand loading */
const EAGER_LOAD_THRESHOLD = 5;

interface RemoteToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ApiConfig {
  baseUrl: string;
  token: string;
}

// ---------------------------------------------------------------------------
// Tool loading from API
// ---------------------------------------------------------------------------

async function fetchToolList(api: ApiConfig): Promise<RemoteToolDefinition[]> {
  const res = await fetch(`${api.baseUrl}/integrations/tools/list`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${api.token}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    logger.warn("Failed to fetch integration tools from API", { status: res.status });
    return [];
  }

  const data = (await res.json()) as { tools: RemoteToolDefinition[] };
  return data.tools ?? [];
}

async function fetchToolListForIntegration(
  api: ApiConfig,
  integration: string,
): Promise<RemoteToolDefinition[]> {
  const allTools = await fetchToolList(api);
  return allTools.filter((t) => t.name.startsWith(`${integration}:`));
}

// ---------------------------------------------------------------------------
// Proxy tool creation
// ---------------------------------------------------------------------------

function createProxyTool(
  def: RemoteToolDefinition,
  api: ApiConfig,
): Tool {
  // Use the API-provided JSON Schema directly — preserves parameter descriptions,
  // required fields, and types so the model generates accurate tool calls.
  const inputSchema = def.inputSchema && Object.keys(def.inputSchema).length > 0
    ? def.inputSchema
    : { type: "object", properties: {}, additionalProperties: true };

  return dynamicTool({
    id: def.name,
    description: def.description,
    inputSchema,
    execute: async (input: unknown, context) => {
      const args = input as Record<string, unknown>;
      const res = await fetch(`${api.baseUrl}/integrations/tools/call`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${api.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: def.name,
          arguments: args,
          end_user_id: context?.endUserId,
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
            // Not JSON — return as plain error
          }
          return { error: "tool_error", message: errorText };
        }
        // Return structured content or text
        if (result.structuredContent) return result.structuredContent;
        const text = result.content.map((c: { text?: string }) => c.text).join("\n");
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      }

      return result;
    },
    mcp: { enabled: true },
  });
}

// ---------------------------------------------------------------------------
// use_integration meta-tool
// ---------------------------------------------------------------------------

function createUseIntegrationTool(api: ApiConfig): Tool {
  return tool({
    id: "use_integration",
    description: "Load tools for a connected integration. Call with the integration name " +
      "(e.g., github, slack, linear) to make its tools available for use.",
    inputSchema: z.object({
      integration: z.string().describe(
        "Integration name (e.g., github, slack, linear, jira, notion)",
      ),
    }),
    execute: async ({ integration }) => {
      const tools = await fetchToolListForIntegration(api, integration);

      if (tools.length === 0) {
        return {
          message:
            `No tools available for "${integration}". The integration may not be connected or has no endpoint specs yet.`,
          available: false,
        };
      }

      // Register proxy tools in the registry
      for (const def of tools) {
        const proxyTool = createProxyTool(def, api);
        toolRegistry.register(def.name, proxyTool);
      }

      return {
        message: `Loaded ${tools.length} tools for ${integration}.`,
        available: true,
        tools: tools.map((t) => ({ name: t.name, description: t.description })),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load integration tools from the API.
 *
 * Smart loading strategy:
 * - <=5 integrations: eagerly load all tools into the registry
 * - >5 integrations: register the `use_integration` meta-tool for on-demand loading
 *
 * @returns Number of tools loaded (or 1 for the meta-tool)
 */
export async function loadRemoteIntegrationTools(
  apiBaseUrl: string,
  apiToken: string,
): Promise<number> {
  const api: ApiConfig = { baseUrl: apiBaseUrl, token: apiToken };

  let allTools: RemoteToolDefinition[];
  try {
    allTools = await fetchToolList(api);
  } catch (err) {
    logger.warn("Failed to load remote integration tools", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }

  if (allTools.length === 0) {
    logger.debug("No remote integration tools available");
    return 0;
  }

  // Count distinct integrations
  const integrations = new Set(allTools.map((t) => t.name.split(":")[0]));

  if (integrations.size <= EAGER_LOAD_THRESHOLD) {
    // Eager: register all tools as proxies
    for (const def of allTools) {
      const proxyTool = createProxyTool(def, api);
      toolRegistry.register(def.name, proxyTool);
    }
    logger.info("Eagerly loaded remote integration tools", {
      tools: allTools.length,
      integrations: integrations.size,
    });
    return allTools.length;
  }

  // On-demand: register the meta-tool
  const metaTool = createUseIntegrationTool(api);
  toolRegistry.register("use_integration", metaTool);
  logger.info("Registered use_integration meta-tool", {
    availableIntegrations: integrations.size,
    totalTools: allTools.length,
  });
  return 1;
}

/**
 * Sync integration config from veryfront.config.ts to the API.
 * This is a full-replace operation.
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
      logger.warn("Failed to sync integration config to API", { status: res.status });
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

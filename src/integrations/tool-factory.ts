/**
 * Integration Tool Factory
 *
 * Generates Tool instances from integration connector specs.
 * Each connector tool becomes a dynamicTool with an execute handler that:
 *   1. Gets a token from the API
 *   2. Calls the external API via endpoint-executor
 */

import { dynamicTool } from "#veryfront/tool";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { z } from "zod";
import { logger } from "#veryfront/utils";
import { executeEndpoint } from "./endpoint-executor.ts";
import type { IntegrationConnector, IntegrationEndpointParam, IntegrationRuntimeConfig } from "./types.ts";

interface TokenResponse {
  accessToken?: string;
  error?: "authentication_required" | "refresh_failed";
  connectUrl?: string;
  message?: string;
}

function paramTypeToZod(
  type: IntegrationEndpointParam["type"],
  description: string,
  required?: boolean,
): z.ZodTypeAny {
  let schema: z.ZodTypeAny;
  switch (type) {
    case "number":
      schema = z.number().describe(description);
      break;
    case "boolean":
      schema = z.boolean().describe(description);
      break;
    case "string[]":
      schema = z.array(z.string()).describe(description);
      break;
    case "object":
      schema = z.record(z.unknown()).describe(description);
      break;
    case "array":
      schema = z.array(z.unknown()).describe(description);
      break;
    default:
      schema = z.string().describe(description);
  }
  return required ? schema : schema.optional();
}

export function createIntegrationTools(
  connector: IntegrationConnector,
  integrationConfig: IntegrationRuntimeConfig,
  apiBaseUrl: string,
  apiToken?: string,
): Tool[] {
  const tools: Tool[] = [];

  const toolAllowlist = integrationConfig.tools ? new Set(integrationConfig.tools) : null;

  for (const connectorTool of connector.tools) {
    if (!connectorTool.endpoint) continue;
    if (toolAllowlist && !toolAllowlist.has(connectorTool.id)) continue;

    const toolId = `${connector.name}:${connectorTool.id}`;
    const endpoint = connectorTool.endpoint;

    // Build Zod schema from params + body
    const shape: Record<string, z.ZodTypeAny> = {};
    if (endpoint.params) {
      for (const [key, def] of Object.entries(endpoint.params)) {
        if (def.in === "header") continue; // Headers are internal
        shape[key] = paramTypeToZod(def.type, def.description, def.required);
      }
    }
    if (endpoint.body) {
      for (const [key, def] of Object.entries(endpoint.body)) {
        shape[key] = paramTypeToZod(def.type, def.description, def.required);
      }
    }

    const inputSchema = z.object(shape);
    const perUser = integrationConfig.perUser ?? false;

    tools.push(
      dynamicTool({
        id: toolId,
        description: connectorTool.description,
        inputSchema,
        execute: async (input: unknown, context?: ToolExecutionContext) => {
          const args = input as Record<string, unknown>;

          // Resolve end-user ID for per-user tokens
          const endUserParam = perUser && context?.endUserId
            ? `&endUserId=${encodeURIComponent(context.endUserId)}`
            : "";

          // Get token from API — we need projectId from context
          const projectId = context?.projectId as string | undefined;
          if (!projectId) {
            return {
              error: "missing_project_id",
              message: "Project ID is required for integration tools",
            };
          }

          const tokenUrl = `${apiBaseUrl}/oauth/token/${
            encodeURIComponent(connector.name)
          }?projectId=${encodeURIComponent(projectId)}${endUserParam}`;

          const headers: Record<string, string> = { Accept: "application/json" };
          if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

          let tokenResponse: TokenResponse;
          try {
            const res = await fetch(tokenUrl, { headers });
            tokenResponse = (await res.json()) as TokenResponse;
          } catch (error) {
            logger.error(`[Integrations] Token fetch failed for ${toolId}`, {
              error: String(error),
            });
            return { error: "token_fetch_failed", message: String(error) };
          }

          if (tokenResponse.error === "authentication_required") {
            return {
              error: "authentication_required",
              integration: connector.name,
              connectUrl: tokenResponse.connectUrl,
              message:
                `User needs to authenticate with ${connector.display_name} to use this tool. ` +
                `Open this URL to connect: ${tokenResponse.connectUrl}`,
            };
          }

          if (tokenResponse.error === "refresh_failed") {
            return {
              error: "refresh_failed",
              message: tokenResponse.message ?? "Token refresh failed",
            };
          }

          if (!tokenResponse.accessToken) {
            return { error: "no_token", message: "No access token returned" };
          }

          // Execute the endpoint
          return executeEndpoint(endpoint, args, tokenResponse.accessToken, {
            integration: connector.name,
            toolId: connectorTool.id,
          });
        },
        mcp: { enabled: true },
      }),
    );
  }

  logger.debug(`[Integrations] Created ${tools.length} tools for ${connector.name}`);
  return tools;
}

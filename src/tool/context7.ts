import { getEnv } from "#veryfront/platform/compat/process.ts";
import { CONFIG_VALIDATION_ERROR } from "#veryfront/errors";
import { createRemoteMCPToolSource } from "./remote-mcp.ts";
import type { RemoteToolSource } from "./types.ts";

/** Configuration used by context7 tool source. */
export interface Context7ToolSourceConfig {
  /** Context7 API key. Falls back to CONTEXT7_API_KEY env var. */
  apiKey?: string;
  /** Override the default endpoint (useful for testing). */
  endpoint?: string;
}

const DEFAULT_ENDPOINT = "https://mcp.context7.com/mcp";

function resolveApiKey(config: Context7ToolSourceConfig): string {
  const key = config.apiKey ?? getEnv("CONTEXT7_API_KEY");
  if (typeof key !== "string" || key.trim().length === 0) {
    throw CONFIG_VALIDATION_ERROR.create({
      detail:
        "Context7 API key is required. Pass apiKey or set the CONTEXT7_API_KEY environment variable.",
    });
  }
  return key;
}

/** Create context7 tool source. */
export function createContext7ToolSource(
  config: Context7ToolSourceConfig = {},
): RemoteToolSource {
  return createRemoteMCPToolSource({
    id: "context7",
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    headers: () => ({
      CONTEXT7_API_KEY: resolveApiKey(config),
    }),
  });
}

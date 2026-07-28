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
const MAX_CONTEXT7_API_KEY_BYTES = 8 * 1024;
const UTF8_ENCODER = new TextEncoder();

function resolveApiKey(explicitApiKey: string | undefined): string {
  const key = explicitApiKey === undefined ? getEnv("CONTEXT7_API_KEY") : explicitApiKey;
  if (key === undefined || key === "") {
    throw CONFIG_VALIDATION_ERROR.create({
      detail:
        "Context7 API key is required. Pass apiKey or set the CONTEXT7_API_KEY environment variable.",
    });
  }
  if (
    typeof key !== "string" ||
    key !== key.trim() ||
    !/^[\x21-\x7e]+$/.test(key)
  ) {
    throw CONFIG_VALIDATION_ERROR.create({
      detail:
        "Context7 API key must be a non-empty visible ASCII string without surrounding whitespace. Pass apiKey or set CONTEXT7_API_KEY.",
    });
  }
  if (UTF8_ENCODER.encode(key).byteLength > MAX_CONTEXT7_API_KEY_BYTES) {
    throw CONFIG_VALIDATION_ERROR.create({
      detail: `Context7 API key must not exceed ${MAX_CONTEXT7_API_KEY_BYTES} bytes.`,
    });
  }
  return key;
}

/** Create context7 tool source. */
export function createContext7ToolSource(
  config: Context7ToolSourceConfig = {},
): RemoteToolSource {
  const apiKey = config.apiKey;
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  return createRemoteMCPToolSource({
    id: "context7",
    endpoint,
    headers: () => ({
      CONTEXT7_API_KEY: resolveApiKey(apiKey),
    }),
  });
}

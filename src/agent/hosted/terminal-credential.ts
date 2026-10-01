import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { type RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource } from "#veryfront/tool/types.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import {
  type AgentServiceMcpServerConfig,
  createProjectScopedMcpUrl,
} from "../service/mcp-server-config.ts";

export const RUN_TERMINAL_TOKEN_HEADER = "X-Veryfront-Run-Terminal-Token";
const NativeHeaders = Headers;
const headersSet = Headers.prototype.set;
const apply = Reflect.apply;
const credentials = createPrivateWeakStore<
  object,
  { token: string; projectId: string; runId: string }
>();

/** Keep terminal authority out of parsed request fields and executor-visible context. */
export function registerHostedTerminalCredential(
  request: ParsedHostedChatRequest,
  token: string | undefined,
): void {
  if (!token || token.length > 16384 || !request.projectId || !request.durableRootRun?.runId) {
    return;
  }
  credentials.set(request, {
    token,
    projectId: request.projectId,
    runId: request.durableRootRun.runId,
  });
}

/** The credential only reaches the bound platform endpoint through the trusted deployment transport. */
export function hostedTerminalToolSourceFactory(
  request: ParsedHostedChatRequest | undefined,
  apiMcpUrl: string,
  fallback: (config: RemoteMCPToolSourceConfig) => RemoteToolSource,
): (config: RemoteMCPToolSourceConfig, server?: AgentServiceMcpServerConfig) => RemoteToolSource {
  const authority = request ? credentials.get(request) : undefined;
  if (!authority) return fallback;
  const expectedEndpoint = createProjectScopedMcpUrl(apiMcpUrl, authority.projectId);
  return (config, server) => {
    if (server?.kind !== "veryfront-api") return fallback(config);
    const ordinary = fallback(config);
    const terminal = fallback({
      ...config,
      endpoint: expectedEndpoint,
      headers: async (context) => {
        const original = typeof config.headers === "function"
          ? await config.headers(context)
          : config.headers;
        const headers = new NativeHeaders(original);
        if (!context?.runId || context.runId === authority.runId) {
          apply(headersSet, headers, [RUN_TERMINAL_TOKEN_HEADER, authority.token]);
        }
        return headers;
      },
    });
    return {
      id: ordinary.id,
      listTools: (context) => ordinary.listTools(context),
      executeTool: (name, args, context) =>
        name === "finalized" || name === "veryfront__finalized"
          ? terminal.executeTool(name, args, context)
          : ordinary.executeTool(name, args, context),
    };
  };
}

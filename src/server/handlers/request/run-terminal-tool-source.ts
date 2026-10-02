import { isTerminalRunToolName } from "#veryfront/agent/runtime/terminal-run-control.ts";
import { createRemoteMCPToolSource, type RemoteMCPToolSourceConfig } from "#veryfront/tool";
import type { RemoteToolSource } from "#veryfront/tool";
import { INGRESS_RUN_TERMINAL_TOKEN_HEADER } from "#veryfront/security/http/ingress-credentials.ts";

/**
 * Builds the platform MCP source for one control-plane run. The API-minted
 * terminal credential is attached only to finalize calls whose context names
 * the dispatched run; discovery and every other tool use the ordinary source.
 * Inherited delegate contexts are rebound to that run (inbox#2496).
 */
export function createRunPlatformToolSource(
  config: RemoteMCPToolSourceConfig & { headers: Record<string, string> },
  terminal: { token: string; runId: string } | null,
): RemoteToolSource {
  const ordinary = createRemoteMCPToolSource(config);
  if (!terminal) return ordinary;
  const terminalSource = createRemoteMCPToolSource({
    ...config,
    headers: { ...config.headers, [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: terminal.token },
  });
  return {
    id: ordinary.id,
    listTools: (context) => ordinary.listTools(context),
    executeTool: (name, args, context) =>
      isTerminalRunToolName(name) && context?.runId === terminal.runId
        ? terminalSource.executeTool(name, args, context)
        : ordinary.executeTool(name, args, context),
  };
}

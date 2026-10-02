import { isTerminalRunToolName } from "#veryfront/agent/runtime/terminal-run-control.ts";
import { createRemoteMCPToolSource, type RemoteMCPToolSourceConfig } from "#veryfront/tool";
import type { RemoteToolSource } from "#veryfront/tool";
import { INGRESS_RUN_TERMINAL_TOKEN_HEADER } from "#veryfront/security/http/ingress-credentials.ts";

/**
 * Builds the platform MCP source for one control-plane run. Only that run's
 * finalize call carries the API-minted terminal credential; discovery, every
 * other tool and another run's finalize go through the ordinary source.
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

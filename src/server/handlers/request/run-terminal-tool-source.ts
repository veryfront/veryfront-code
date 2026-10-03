import {
  isTerminalRunToolName,
  RUN_TERMINAL_TOOL_CALL_ID_HEADER,
  terminalToolCallIdHeaderValue,
} from "#veryfront/agent/runtime/terminal-run-control.ts";
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
  createSource: (config: RemoteMCPToolSourceConfig) => RemoteToolSource = createRemoteMCPToolSource,
): RemoteToolSource {
  const ordinary = createSource(config);
  if (!terminal) return ordinary;
  const terminalHeaders = {
    ...config.headers,
    [INGRESS_RUN_TERMINAL_TOKEN_HEADER]: terminal.token,
  };
  const terminalSource = createSource({
    ...config,
    // The call id only names which call the API closes; the token is the authority.
    headers: (context) => {
      const toolCallId = terminalToolCallIdHeaderValue(context);
      return toolCallId
        ? { ...terminalHeaders, [RUN_TERMINAL_TOOL_CALL_ID_HEADER]: toolCallId }
        : terminalHeaders;
    },
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

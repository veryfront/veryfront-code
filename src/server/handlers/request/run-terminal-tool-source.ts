import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { terminalRoute } from "#veryfront/agent/conversation/terminal-route.ts";
import {
  bindTerminalRunResponseIdentity,
  hasCurrentTerminalRunCredentialAuthority,
  isTerminalRunToolName,
  RUN_TERMINAL_TOOL_CALL_ID_HEADER,
  terminalToolCallIdHeaderValue,
} from "#veryfront/agent/runtime/terminal-run-control.ts";
import { createRemoteMCPToolSource, type RemoteMCPToolSourceConfig } from "#veryfront/tool";
import type { RemoteToolSource } from "#veryfront/tool";
import { INGRESS_RUN_TERMINAL_TOKEN_HEADER } from "#veryfront/security/http/ingress-credentials.ts";

/**
 * Builds the platform MCP source for one control-plane run. The API-minted
 * terminal credential is attached only to finalize calls from the dispatched
 * run's own terminal control. Delegates retain ordinary run-bound authorization
 * without inheriting terminal authority.
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
    headers: async (context) => {
      const toolCallId = terminalToolCallIdHeaderValue(context);
      // The held credential and admitted call remain stable across a lost-response retry.
      const idempotencyKey = await computeHash(`${terminal.token}:${toolCallId ?? "finalize"}`);
      let canonicalRunId: string | undefined;
      try {
        canonicalRunId = terminalRoute(terminal.token, terminal.runId).id;
      } catch {
        // Malformed credentials cannot establish canonical response identity; the API rejects them.
      }
      if (canonicalRunId) bindTerminalRunResponseIdentity(context, canonicalRunId);
      return {
        ...terminalHeaders,
        "Idempotency-Key": idempotencyKey,
        ...(toolCallId ? { [RUN_TERMINAL_TOOL_CALL_ID_HEADER]: toolCallId } : {}),
      };
    },
  });
  return {
    id: ordinary.id,
    listTools: (context) => ordinary.listTools(context),
    executeTool: (name, args, context) =>
      isTerminalRunToolName(name) && context?.runId === terminal.runId &&
        hasCurrentTerminalRunCredentialAuthority(context)
        ? terminalSource.executeTool(name, args, context)
        : ordinary.executeTool(name, args, context),
  };
}

import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { canonicalPlatformHostTools } from "../platform-host-tools.ts";
import { markTrustedHostToolSet } from "#veryfront/tool/host-tool-provenance.ts";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { VERYFRONT_API_MCP_SOURCE_ID } from "../runtime/mcp-server-tool-sources.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  configureHostedPlatformDependencySource,
  type HostedPlatformDependencyOwner,
  registerHostedPlatformDependencyRequest,
  revokeHostedPlatformDependencies,
  runWithHostedPlatformDependencies,
} from "../hosted/platform-dependency-credential.ts";
import {
  bindHostedToolCallAdmissionWriter,
  type HostedRunEventWriterCapability,
} from "../hosted/child-run-event-writer-token.ts";
import { hostedTerminalToolSourceFactory } from "../hosted/terminal-credential.ts";
import { createConnectedLocalWriterVerifier } from "../service/auth.ts";
import { createLivePlatformMcpSource } from "../platform-mcp-tool-source.ts";
import {
  createRemoteMCPToolSourceFactoryWithTransport,
  type RemoteToolSource,
} from "#veryfront/tool";
import { runWithExactRuntimeRemoteToolSources } from "../runtime/remote-tool-source-context.ts";
import { runWithRecoveryToolExecutionPolicy } from "#veryfront/runtime/execution-ownership-guard.ts";
import {
  getCurrentToolCallOccurrenceIdentity,
  runWithToolCallOccurrences,
} from "#veryfront/runtime/tool-call-occurrence.ts";
import {
  type AdmitExecutorToolCall,
  bindToolCallAdmissionOwner,
  runWithToolCallAdmissionReceipt,
} from "#veryfront/runtime/tool-call-admission-dispatch.ts";
import type { AgentRunToolCallAdmissionReceipt } from "#veryfront/runtime/tool-call-admission-receipt.ts";

type Scope = { projectId: string; runId: string; agentId: string };
const execution = new AsyncLocalStorage<object>();

/** CLI-owned transport and signed grants; no project setting can install this boundary. */
export function createConnectedLocalPlatformTools(apiUrl: string, transport: typeof fetch) {
  const verify = createConnectedLocalWriterVerifier(apiUrl);
  const endpoint = `${apiUrl.replace(/\/$/, "")}/mcp`;
  const createSource = createRemoteMCPToolSourceFactoryWithTransport({
    trustedEndpoints: [endpoint],
    requestFetch: transport,
  });
  const sources = new WeakMap<object, RemoteToolSource>();
  const cleanups = new WeakMap<object, Array<() => Promise<void>>>();
  return {
    verify,
    async revoke(owner: HostedPlatformDependencyOwner) {
      revokeHostedPlatformDependencies(owner);
      await Promise.allSettled((cleanups.get(owner) ?? []).map((close) => close()));
      cleanups.delete(owner);
    },
    async register(
      owner: HostedPlatformDependencyOwner,
      scope: Scope,
      eventToken: string,
      authToken: string,
      currentAuthority?: () => { auth_token: string; run_event_token: string },
    ) {
      const verification = await verify({ ...scope, token: eventToken });
      if (!verification.verified) throw new Error("Connected local writer verification failed");
      registerHostedPlatformDependencyRequest(owner, verification, scope, verify, authToken);
      const cleanup: Array<() => Promise<void>> = [];
      cleanups.set(owner, cleanup);
      await configureHostedPlatformDependencySource(
        owner,
        async (childScope, token, childOwner) => {
          const factory = hostedTerminalToolSourceFactory(childOwner, endpoint, createSource);
          let source = createLivePlatformMcpSource(factory({
            id: VERYFRONT_API_MCP_SOURCE_ID,
            endpoint,
            headers: () => {
              const current = childScope.runId === scope.runId ? currentAuthority?.() : undefined;
              return {
                Authorization: `Bearer ${current?.auth_token ?? token}`,
                ...(childScope.runId === scope.runId
                  ? { "X-Veryfront-Run-Event-Token": current?.run_event_token ?? eventToken }
                  : {}),
              };
            },
          }, { id: VERYFRONT_API_MCP_SOURCE_ID, kind: "veryfront-api" }));
          // The API issues this scope only for this child's sealed sandbox selection.
          let allowSandbox = false;
          try {
            const claims = privateJsonParse(
              Buffer.from(token.split(".")[1]!, "base64url").toString(),
            );
            allowSandbox = Array.isArray(claims.scope) &&
              claims.scope.includes("sandboxes:write");
          } catch { /* A session credential without sandbox scope exposes no native tools. */ }
          if (allowSandbox) {
            const { createBashSandboxShellToolsProvider } = await importFirstPartyExtensionModule<{
              createBashSandboxShellToolsProvider: Parameters<
                typeof createAgentServiceSandboxTools
              >[0]["createBashTool"];
            }>("ext-sandbox-shell-tools", "@veryfront/ext-sandbox-shell-tools");
            const sandbox = await createAgentServiceSandboxTools({
              apiUrl,
              authToken: token,
              getProjectId: () => childScope.projectId,
              createBashTool: createBashSandboxShellToolsProvider,
            });
            cleanup.push(sandbox.closeSandbox);
            const native = canonicalPlatformHostTools(markTrustedHostToolSet(sandbox.tools));
            const mcp = source;
            source = markTrustedPlatformSource({
              id: mcp.id,
              listTools: async (context) => [
                ...await mcp.listTools(context),
                ...Object.entries(native).map(([name, tool]) => ({
                  name,
                  description: tool.description ?? name,
                  parameters: (tool.inputSchemaJson ?? tool.parameters ??
                    { type: "object", properties: {} }) as Record<string, unknown>,
                })),
              ],
              executeTool: async (name, input, context) => {
                const tool = native[name];
                if (!tool) return mcp.executeTool(name, input, context);
                if (!tool.execute) throw new Error("Sandbox tool cannot execute");
                return await tool.execute(input, context);
              },
            });
          }
          sources.set(childOwner, source);
          return source;
        },
      );
    },
    run<T>(input: {
      owner: HostedPlatformDependencyOwner;
      scope: Scope;
      writer: HostedRunEventWriterCapability;
      canonicalRunId: string;
      signal: AbortSignal;
      admit: (
        call: { occurrenceId: string; toolCallId: string },
        toolName: string,
        args: Record<string, unknown>,
      ) => Promise<AgentRunToolCallAdmissionReceipt>;
    }, operation: () => Promise<T>): Promise<T> {
      const identity = {};
      const assertActive = () => input.signal.throwIfAborted();
      const calls = new Map<string, { name: string; args: Record<string, unknown> }>();
      const admit: AdmitExecutorToolCall = (call) => {
        const tool = calls.get(call.occurrenceId);
        if (!tool) throw new Error("Missing connected tool dispatch");
        return input.admit(call, tool.name, tool.args);
      };
      bindHostedToolCallAdmissionWriter(admit, {
        capability: input.writer,
        expectedRunId: input.scope.runId,
        projectId: input.scope.projectId,
      });
      bindToolCallAdmissionOwner(admit, { ...input.scope, canonicalRunId: input.canonicalRunId });
      const source = sources.get(input.owner);
      if (!source) throw new Error("Connected local platform source is unavailable");
      return runWithHostedPlatformDependencies(
        input.owner,
        () =>
          runWithExactRuntimeRemoteToolSources(
            [source],
            () =>
              execution.run(identity, () =>
                runWithToolCallOccurrences(() =>
                  runWithRecoveryToolExecutionPolicy(async (tool, execute) => {
                    // A nested child owns its own receipt, never its parent's.
                    if (execution.getStore() !== identity) {
                      return execute();
                    }
                    assertActive();
                    const call = getCurrentToolCallOccurrenceIdentity();
                    if (!call) {
                      throw new Error("Connected tool has no private occurrence");
                    }
                    calls.set(call.occurrenceId, { name: tool.toolName, args: tool.input });
                    const receipt = await admit(call, input.signal);
                    calls.delete(call.occurrenceId);
                    return runWithToolCallAdmissionReceipt(receipt, assertActive, execute, admit);
                  }, operation)
                )),
          ),
      );
    },
  };
}

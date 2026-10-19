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
  return {
    verify,
    revoke: revokeHostedPlatformDependencies,
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
      await configureHostedPlatformDependencySource(
        owner,
        async (childScope, token, childOwner) => {
          const factory = hostedTerminalToolSourceFactory(childOwner, endpoint, createSource);
          const source = createLivePlatformMcpSource(factory({
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

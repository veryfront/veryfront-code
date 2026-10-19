import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { canonicalPlatformHostTools } from "../platform-host-tools.ts";
import { markTrustedHostToolSet } from "#veryfront/tool/host-tool-provenance.ts";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { VERYFRONT_API_MCP_SOURCE_ID } from "../runtime/mcp-server-tool-sources.ts";
import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import {
  forEachPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import { privateTextSplit } from "#veryfront/security/private-text.ts";
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
import { getRuntimeRequestContext } from "#veryfront/platform/runtime-request-context.ts";
import { runWithVerifiedSkillScriptExecutionCredential } from "#veryfront/skill/execution-credential.ts";

type Scope = { projectId: string; runId: string; agentId: string };
const execution = createPrivateAsyncLocalStorage<object>();
const apply = Reflect.apply;
const nativeBuffer = Buffer;
const nativePromise = Promise;
const bufferFrom = Buffer.from;
const bufferToString = Buffer.prototype.toString;
const isArray = Array.isArray;
const entries = Object.entries;
const replace = String.prototype.replace;
const allSettled = Promise.allSettled;
const throwIfAborted = AbortSignal.prototype.throwIfAborted;

/** CLI-owned transport and signed grants; no project setting can install this boundary. */
export function createConnectedLocalPlatformTools(
  apiUrl: string,
  transport: typeof fetch,
  dependencies: { createSandboxTools?: typeof createAgentServiceSandboxTools } = {},
) {
  const verify = createConnectedLocalWriterVerifier(apiUrl);
  const endpoint = `${apply(replace, apiUrl, [/\/$/, ""])}/mcp`;
  const createSource = createRemoteMCPToolSourceFactoryWithTransport({
    trustedEndpoints: [endpoint],
    requestFetch: transport,
  });
  const sources = createPrivateWeakStore<object, RemoteToolSource>();
  const credentials = createPrivateWeakStore<object, () => string>();
  const cleanups = createPrivateWeakStore<object, Array<() => Promise<void>>>();
  const revoke = async (owner: HostedPlatformDependencyOwner) => {
    revokeHostedPlatformDependencies(owner);
    const pending = cleanups.get(owner) ?? [];
    cleanups.set(owner, []);
    const results = await apply(allSettled, nativePromise, [
      mapPrivateArray(pending, async (close) => await close()),
    ]);
    const retry: Array<() => Promise<void>> = [];
    let failure: unknown;
    forEachPrivateArray(results, (result, index) => {
      if (result.status !== "rejected") return;
      const close = pending[index];
      if (close) pushPrivateArray(retry, close);
      failure ??= result.reason;
    });
    if (retry.length > 0) {
      const current = cleanups.get(owner) ?? [];
      forEachPrivateArray(retry, (close) => pushPrivateArray(current, close));
      cleanups.set(owner, current);
      throw failure;
    }
  };
  return {
    verify,
    revoke,
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
      try {
        await configureHostedPlatformDependencySource(
          owner,
          async (childScope, token, childOwner, parentOwner) => {
            let ownerCleanup = cleanups.get(childOwner);
            if (!ownerCleanup) {
              ownerCleanup = [];
              cleanups.set(childOwner, ownerCleanup);
              if (childOwner !== owner) {
                const parentCleanup = cleanups.get(parentOwner ?? owner);
                if (!parentCleanup) {
                  throw new Error("Connected platform sandbox parent is unavailable");
                }
                pushPrivateArray(parentCleanup, () => revoke(childOwner));
              }
            }
            try {
              const credential = () =>
                childScope.runId === scope.runId ? currentAuthority?.().auth_token ?? token : token;
              credentials.set(childOwner, credential);
              const factory = hostedTerminalToolSourceFactory(childOwner, endpoint, createSource);
              let source = createLivePlatformMcpSource(factory({
                id: VERYFRONT_API_MCP_SOURCE_ID,
                endpoint,
                headers: () => {
                  const current = childScope.runId === scope.runId
                    ? currentAuthority?.()
                    : undefined;
                  return {
                    Authorization: `Bearer ${credential()}`,
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
                  apply(
                    bufferToString,
                    apply(bufferFrom, nativeBuffer, [
                      privateTextSplit(token, ".")[1]!,
                      "base64url",
                    ]),
                    [],
                  ),
                );
                allowSandbox = isArray(claims.scope) &&
                  somePrivateArray(claims.scope, (scope) => scope === "sandboxes:write");
              } catch { /* A session credential without sandbox scope exposes no native tools. */ }
              if (allowSandbox) {
                const { createBashSandboxShellToolsProvider } =
                  await importFirstPartyExtensionModule<
                    {
                      createBashSandboxShellToolsProvider: Parameters<
                        typeof createAgentServiceSandboxTools
                      >[0]["createBashTool"];
                    }
                  >("ext-sandbox-shell-tools", "@veryfront/ext-sandbox-shell-tools");
                const sandbox =
                  await (dependencies.createSandboxTools ?? createAgentServiceSandboxTools)({
                    apiUrl,
                    authToken: token,
                    getAuthToken: credential,
                    getProjectId: () => childScope.projectId,
                    createBashTool: createBashSandboxShellToolsProvider,
                  });
                if (cleanups.get(childOwner) !== ownerCleanup) {
                  await sandbox.closeSandbox();
                  throw new Error("Connected platform sandbox owner is no longer active");
                }
                pushPrivateArray(ownerCleanup, sandbox.closeSandbox);
                const native = canonicalPlatformHostTools(markTrustedHostToolSet(sandbox.tools));
                const mcp = source;
                source = markTrustedPlatformSource({
                  id: mcp.id,
                  listTools: async (context) => [
                    ...await mcp.listTools(context),
                    ...mapPrivateArray(entries(native), ([name, tool]) => ({
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
            } catch (error) {
              await revoke(childOwner);
              throw error;
            }
          },
        );
      } catch (error) {
        await revoke(owner);
        throw error;
      }
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
      const assertActive = () => apply(throwIfAborted, input.signal, []);
      const calls = createPrivateMap<string, { name: string; args: Record<string, unknown> }>();
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
      const credential = credentials.get(input.owner);
      if (!credential) throw new Error("Connected run credential is unavailable");
      const requestContext = getRuntimeRequestContext();
      const projectContext = requestContext?.projectId === input.scope.projectId
        ? requestContext
        : undefined;
      // Legacy writers have no delegated dependency runner, but still retain their
      // directly authenticated first-party platform source.
      return runWithHostedPlatformDependencies(
        input.owner,
        () =>
          runWithVerifiedSkillScriptExecutionCredential(
            {
              assertActive,
              read: () => ({
                apiUrl,
                authToken: credential(),
                projectId: input.scope.projectId,
                ...(projectContext?.projectSlug ? { projectSlug: projectContext.projectSlug } : {}),
                ...(projectContext ? { branch: projectContext.branch } : {}),
                runId: input.scope.runId,
                agentId: input.scope.agentId,
              }),
            },
            () =>
              runWithExactRuntimeRemoteToolSources(
                source ? [source] : [],
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
                        return runWithToolCallAdmissionReceipt(
                          receipt,
                          assertActive,
                          execute,
                          admit,
                        );
                      }, operation)
                    )),
              ),
          ),
      );
    },
  };
}

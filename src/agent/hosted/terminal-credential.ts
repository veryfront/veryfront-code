import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { createHostedRunEventWriterCapability } from "./child-run-event-writer-token.ts";
import type {
  BoundConversationAgentRunFinalizer,
  ConversationRunProjection,
  createConversationAgentRun,
} from "../conversation/durable.ts";
import { terminalRoute, terminalRoutingRunId } from "../conversation/terminal-route.ts";
import {
  finalizeConversationAgentRun,
  getCanonicalRunStatus,
  instrumentConversationRunFetch,
} from "../conversation/durable.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  hasCurrentTerminalRunCredentialAuthority,
  RUN_TERMINAL_TOOL_CALL_ID_HEADER,
  terminalToolCallIdHeaderValue,
} from "../runtime/terminal-run-control.ts";
import { type RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource } from "#veryfront/tool/types.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import { createProjectScopedMcpUrl } from "../service/project-scoped-mcp-url.ts";

export const RUN_TERMINAL_TOKEN_HEADER = "X-Veryfront-Run-Terminal-Token";
export { RUN_TERMINAL_TOOL_CALL_ID_HEADER };
const hostFetch = globalThis.fetch;
const NativeHeaders = Headers;
const headersSet = Headers.prototype.set;
const apply = Reflect.apply;
type HostedTerminalDescriptor =
  | Pick<ConversationRunProjection, "runId">
  | { readonly childRunId: string };

const credentials = createPrivateWeakStore<
  object,
  {
    token: string;
    renewalToken?: string;
    eventToken?: string;
    leaseExpiresAt?: number;
    projectId: string;
    runId: string;
    authToken?: string;
    apiUrl?: string;
    fetch?: typeof globalThis.fetch;
  }
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
    authToken: request.authToken,
  });
}

/** Canonical routing identity from the existing private terminal capability. */
export function hostedTerminalCanonicalRunId(request: ParsedHostedChatRequest): string | undefined {
  const authority = credentials.get(request);
  if (!authority) return undefined;
  try {
    return terminalRoute(authority.token, authority.runId).id;
  } catch {
    return undefined;
  }
}

/** Transfer the verified request capability to its private durable run descriptor. */
export function bindHostedTerminalRun(
  request: ParsedHostedChatRequest,
  run: { runId: string } | null,
  transport: { apiUrl: string; fetch?: typeof globalThis.fetch },
): void {
  const authority = credentials.get(request);
  if (authority && run?.runId === authority.runId) {
    credentials.set(run, {
      ...authority,
      apiUrl: transport.apiUrl,
      fetch: instrumentConversationRunFetch(transport.fetch ?? hostFetch),
    });
  }
}

/** Build a bound finalizer without exposing its terminal credential to runtime inputs. */
export function hostedTerminalRunFinalizer(
  run: { runId: string } | null,
): BoundConversationAgentRunFinalizer | undefined {
  const authority = run ? credentials.get(run) : undefined;
  if (!authority?.apiUrl) return undefined;
  const apiUrl = authority.apiUrl;
  return (input) => {
    if (input.runId !== authority.runId) {
      throw new Error("Current run terminal authority is required");
    }
    return finalizeConversationAgentRun({
      ...input,
      apiUrl,
      authToken: authority.authToken ?? input.authToken,
      fetch: authority.fetch,
      terminalAuthToken: authority.token,
    });
  };
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
        if (
          context?.runId === authority.runId && hasCurrentTerminalRunCredentialAuthority(context)
        ) {
          apply(headersSet, headers, [RUN_TERMINAL_TOKEN_HEADER, authority.token]);
          const toolCallId = terminalToolCallIdHeaderValue(context);
          if (toolCallId) {
            apply(headersSet, headers, [RUN_TERMINAL_TOOL_CALL_ID_HEADER, toolCallId]);
          }
        }
        return headers;
      },
    });
    return {
      id: ordinary.id,
      listTools: (context) => ordinary.listTools(context),
      executeTool: (name, args, context) =>
        name === "finalize" || name === "veryfront__finalize"
          ? terminal.executeTool(name, args, context)
          : ordinary.executeTool(name, args, context),
    };
  };
}

/** Build an inherited admission transport bound to an authentic parent capability. */
export function hostedInheritedRunAdmitter(
  request: ParsedHostedChatRequest | HostedTerminalDescriptor,
  transport: { apiUrl: string; fetch?: typeof globalThis.fetch },
):
  | ((
    toolCallId: string,
    prompt: string,
  ) => (
    input: Omit<Parameters<typeof createConversationAgentRun>[0], "conversationId"> & {
      conversationId?: string;
    },
  ) => Promise<ConversationRunProjection>)
  | undefined {
  const parent = credentials.get(request);
  if (!parent?.authToken) return undefined;
  const parentId = terminalRoute(parent.token, parent.runId).id;
  const send = transport.fetch ?? hostFetch;
  return (toolCallId, prompt) => async (input) => {
    if (input.parentRunId !== parent.runId) {
      throw new Error("Inherited child parent binding mismatch");
    }
    const response = await send(`${transport.apiUrl}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${parent.authToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `inherited:${await computeHash(`${parentId}:${toolCallId}`)}`,
        "X-Veryfront-Run-Execution-Mode": "inherited",
        [RUN_TERMINAL_TOKEN_HEADER]: parent.token,
      },
      body: JSON.stringify({
        project_id: input.projectId ?? parent.projectId,
        target: { type: "agent", id: input.agentId },
        parent_run_id: parentId,
        tool_call_id: toolCallId,
        ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
        input: { prompt },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Inherited child admission failed (${response.status})`);
    if (!response.headers.get("Cache-Control")?.includes("no-store")) {
      throw new Error("Inherited child credentials require no-store");
    }
    const row = await response.json();
    const token = response.headers.get(RUN_TERMINAL_TOKEN_HEADER);
    const authToken = response.headers.get("X-Veryfront-Run-Invocation-Token");
    const renewalToken = response.headers.get("X-Veryfront-Run-Renewal-Token");
    const eventToken = response.headers.get("X-Veryfront-Run-Event-Token");
    if (!token || !authToken || !renewalToken || !eventToken) {
      throw new Error("Inherited child authority is missing");
    }
    const runId = terminalRoutingRunId(token);
    const canonical = terminalRoute(token, runId);
    const eventCursor = Number(response.headers.get("X-Veryfront-Run-Event-Sequence"));
    const externalCursor = Number(response.headers.get("X-Veryfront-Run-External-Event-Sequence"));
    if (
      canonical.id !== row.id ||
      (input.conversationId !== undefined && row.conversation_id !== input.conversationId) ||
      typeof row.conversation_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        row.conversation_id,
      ) ||
      typeof row.output_message_id !== "string" ||
      !response.headers.has("X-Veryfront-Run-Event-Sequence") ||
      !response.headers.has("X-Veryfront-Run-External-Event-Sequence") ||
      !Number.isSafeInteger(eventCursor) || eventCursor < 0 ||
      !Number.isSafeInteger(externalCursor) || externalCursor < 0
    ) throw new Error("Inherited child resource binding mismatch");
    const run = {
      runId,
      canonicalRunId: row.id as string,
      conversationId: row.conversation_id as string,
      messageId: row.output_message_id as string,
      latestEventId: eventCursor,
      latestExternalEventSequence: externalCursor,
      waitingToolCallId: null,
      waitingToolName: null,
      status: row.status === "waiting" ? "waiting_for_tool" as const : row.status,
      streamProtocolVersion: 2 as const,
    };
    credentials.set(run, {
      token,
      authToken,
      renewalToken,
      eventToken,
      leaseExpiresAt: Date.parse(response.headers.get("X-Veryfront-Run-Lease-Expires-At") ?? ""),
      runId: run.runId,
      projectId: parent.projectId,
      apiUrl: transport.apiUrl,
      fetch: send,
    });
    return run;
  };
}

/** Preserve exact private authority when a trusted adapter projects its descriptor. */
export function transferHostedTerminalAuthority(
  source: HostedTerminalDescriptor,
  target: HostedTerminalDescriptor,
): void {
  const authority = credentials.get(source);
  if (authority) credentials.set(target, authority);
}

/** Keep an inherited local execution leased while its callback is running. */
export async function withHostedInheritedLease<T>(
  descriptor: HostedTerminalDescriptor,
  operation: (abortSignal?: AbortSignal) => Promise<T> | T,
  parentSignal?: AbortSignal,
): Promise<T> {
  parentSignal?.throwIfAborted();
  const authority = credentials.get(descriptor);
  if (!authority?.renewalToken || !authority.apiUrl) return await operation(parentSignal);
  const canonicalId = terminalRoute(authority.token, authority.runId).id;
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;
  let leaseExpiresAt = authority.leaseExpiresAt;
  if (!Number.isFinite(leaseExpiresAt)) throw new Error("Inherited child lease expiry is required");
  if (leaseExpiresAt! <= Date.now()) {
    throw new Error("Inherited child lease expired before local execution");
  }
  let expiryTimer: ReturnType<typeof setTimeout>;
  let rejectExpired: (reason: Error) => void;
  const expired = new Promise<never>((_resolve, reject) => {
    rejectExpired = reject;
  });
  const onParentAbort = () => {
    rejectExpired(parentSignal?.reason ?? new Error("Parent execution cancelled"));
    controller.abort(parentSignal?.reason);
  };
  parentSignal?.addEventListener("abort", onParentAbort, { once: true });
  const armExpiry = () => {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(
      () => rejectExpired(new Error("Inherited child lease expired before renewal completed")),
      Math.max(0, leaseExpiresAt! - Date.now()),
    );
  };
  armExpiry();
  const renewal = (async () => {
    while (!controller.signal.aborted) {
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(
          () => {
            controller.signal.removeEventListener("abort", onAbort);
            resolve();
          },
          Number.isFinite(leaseExpiresAt)
            ? Math.min(20000, Math.max(1, (leaseExpiresAt! - Date.now()) / 2))
            : 20000,
        );
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      if (controller.signal.aborted) return await new Promise<never>(() => {});
      let response: Response;
      try {
        response = await (authority.fetch ?? hostFetch)(
          `${authority.apiUrl}/runs/${canonicalId}/heartbeats`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authority.renewalToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ lease_duration_seconds: 60 }),
            signal: controller.signal,
          },
        );
      } catch (error) {
        if (controller.signal.aborted) throw error;
        continue;
      }
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          await response.body?.cancel().catch(() => {});
          continue;
        }
        throw new Error(`Inherited child lease renewal failed (${response.status})`);
      }
      const receipt = await response.json();
      leaseExpiresAt = Date.parse(receipt.expires_at);
      if (
        receipt.run_id !== canonicalId || !Number.isFinite(leaseExpiresAt) ||
        leaseExpiresAt <= Date.now()
      ) {
        throw new Error("Inherited child lease response binding mismatch");
      }
      armExpiry();
    }
    return await new Promise<never>(() => {});
  })();
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation(signal);
      }),
      renewal,
      expired,
    ]);
    parentSignal?.throwIfAborted();
    return result;
  } finally {
    parentSignal?.removeEventListener("abort", onParentAbort);
    clearTimeout(expiryTimer!);
    controller.abort();
  }
}

/** Read only the run bound to the privately issued child invocation credential. */
export function hostedBoundRunStatus(descriptor: HostedTerminalDescriptor, expectedRunId: string) {
  const authority = credentials.get(descriptor);
  if (!authority?.apiUrl || authority.runId !== expectedRunId || !authority.authToken) {
    return undefined;
  }
  const apiUrl = authority.apiUrl;
  const authToken = authority.authToken;
  return (abortSignal?: AbortSignal) =>
    getCanonicalRunStatus({
      apiUrl,
      authToken,
      runId: authority.runId,
      canonicalRunId: terminalRoute(authority.token, authority.runId).id,
      abortSignal,
      fetch: authority.fetch,
    });
}

/** Reconstitute only the exact child writer issued by inherited admission. */
export function hostedInheritedEventWriter(descriptor: HostedTerminalDescriptor) {
  const authority = credentials.get(descriptor);
  if (!authority?.eventToken || !authority.apiUrl) return undefined;
  return createHostedRunEventWriterCapability({
    inheritedExecution: true,
    apiUrl: authority.apiUrl,
    runId: authority.runId,
    canonicalRunId: terminalRoute(authority.token, authority.runId).id,
    runEventAppendToken: authority.eventToken,
    fetch: authority.fetch,
    inheritedAdmitter: hostedInheritedRunAdmitter(descriptor, {
      apiUrl: authority.apiUrl,
      fetch: authority.fetch,
    }),
  });
}

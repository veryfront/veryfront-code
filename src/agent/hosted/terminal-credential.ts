import { registerHostedToolRunAuthorization } from "./tool-run-authorization.ts";
import { MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES } from "../conversation/run-event-limits.ts";
import { snapshotOwnDataRecords } from "#veryfront/security/own-data-record.ts";
import { getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import {
  appendPrivateArray,
  forEachPrivateArray,
  mapPrivateArray,
} from "#veryfront/security/private-array.ts";
import { createVeryfrontApiRequestUrlResolver } from "#veryfront/platform/adapters/veryfront-api-url.ts";
import { authorizeHostedTaskInput } from "./task-input.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import type { HostedAcceptedChildEvidence } from "./accepted-child-evidence.ts";
import {
  encodeHostedTaskInput,
  type HostedTaskInput,
  resolveHostedTaskInput,
} from "./task-input.ts";
import type {
  ParsedHostedChatRequest,
  ParseHostedChatRequestOptions,
} from "./chat-request-parser.ts";
import {
  createHostedRunEventWriterCapability,
  getActiveHostedRunEventWriterCapability,
  type HostedAcceptedTaskInputReceipt,
  hostedAcceptedTaskInputReference,
  type HostedRunEventWriterCapability,
  refreshHostedRunEventWriterCapability,
  waitForHostedParentToolStart,
} from "./child-run-event-writer-token.ts";
import {
  type HostedPlatformDependencyOwner,
  registerHostedChildPlatformDependencies,
  rotateHostedPlatformDependencyCredential,
  transferHostedPlatformDependencies,
} from "./platform-dependency-credential.ts";
import { isCanonicalFileMutationTool } from "#veryfront/tool/platform-tool-policy.ts";
import { INGRESS_RUN_EVENT_TOKEN_HEADER } from "#veryfront/security/http/ingress-credentials.ts";
import { createVeryfrontCloudInferenceModelResolver } from "./inference-credential.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
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
  bindTerminalRunResponseIdentity,
  hasCurrentTerminalRunCredentialAuthority,
  isTerminalRunToolName,
  RUN_TERMINAL_TOOL_CALL_ID_HEADER,
  terminalToolCallIdHeaderValue,
} from "../runtime/terminal-run-control.ts";
import { type RemoteMCPToolSourceConfig } from "#veryfront/tool/remote-mcp.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import { copyNativeHeaders } from "#veryfront/platform/compat/http/native-request-init.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import { createProjectScopedMcpUrl } from "../service/project-scoped-mcp-url.ts";

function inheritedInvocationIdentity(parentId: string, toolCallId: string): string {
  return `${parentId}:${toolCallId}`;
}

export const RUN_TERMINAL_TOKEN_HEADER = "X-Veryfront-Run-Terminal-Token";
export { RUN_TERMINAL_TOOL_CALL_ID_HEADER };
const evidenceDecode = atob;
const evidenceSplit = String.prototype.split;
const evidenceReplaceAll = String.prototype.replaceAll;
const evidenceResponseOk = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;
const evidenceResponseStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const evidenceResponseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const evidenceFreeze = Object.freeze;
const evidenceIsArray = Array.isArray;
const evidenceSafeInteger = Number.isSafeInteger;
const evidenceEncodeURIComponent = encodeURIComponent;
const evidenceRegExpExec = RegExp.prototype.exec;
const hostFetch = globalThis.fetch;
const NativeHeaders = Headers;
const headersSet = Headers.prototype.set;
const headersDelete = Headers.prototype.delete;
const apply = Reflect.apply;
type HostedTerminalDescriptor =
  | Pick<ConversationRunProjection, "runId">
  | { readonly childRunId: string };

const credentials = createPrivateWeakStore<
  object,
  {
    token: string;
    verifyRunEventAppendToken?: ParseHostedChatRequestOptions["verifyRunEventAppendToken"];
    verifyRunTerminalToken?: ParseHostedChatRequestOptions["verifyRunTerminalToken"];
    taskInput?: HostedTaskInput;
    rootRunId?: string;
    renewalToken?: string;
    eventToken?: string;
    inferenceToken?: string;
    leaseExpiresAt?: number;
    projectId: string;
    runId: string;
    agentId?: string;
    authToken?: string;
    apiUrl?: string;
    fetch?: typeof globalThis.fetch;
    eventWriters?: HostedRunEventWriterCapability[];
  }
>();

type InheritedTerminalReceipt = {
  status: "completed" | "failed" | "cancelled";
  output: unknown;
  outputFormat?: "text-data-v1";
  error?: { code: string; message: string };
};
const terminalReceipts = createPrivateWeakStore<object, InheritedTerminalReceipt>();
const inheritedOutputFormats = createPrivateWeakStore<Response, "text-data-v1">();

/** Read the original terminal outcome returned by authenticated child admission. */
export function hostedInheritedTerminalReceipt(
  descriptor: HostedTerminalDescriptor,
): InheritedTerminalReceipt | undefined {
  return terminalReceipts.get(descriptor);
}

/** Keep terminal authority out of parsed request fields and executor-visible context. */
export function registerHostedTerminalCredential(
  request: ParsedHostedChatRequest,
  token: string | undefined,
  eventToken?: string,
  verifyRunEventAppendToken?: ParseHostedChatRequestOptions["verifyRunEventAppendToken"],
  verifyRunTerminalToken?: ParseHostedChatRequestOptions["verifyRunTerminalToken"],
): void {
  if (!token || token.length > 16384 || !request.projectId || !request.durableRootRun?.runId) {
    return;
  }
  credentials.set(request, {
    verifyRunEventAppendToken,
    verifyRunTerminalToken,
    token,
    projectId: request.projectId,
    agentId: request.agentId,
    runId: request.durableRootRun.runId,
    authToken: request.authToken,
    ...(eventToken ? { eventToken } : {}),
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

/** Bind tool context only to the privately admitted project and current run. */
export function bindHostedToolRunAuthorization(
  target: { projectId?: string | null; runId?: string },
  request: ParsedHostedChatRequest,
): void {
  const authority = credentials.get(request);
  if (
    !authority?.projectId || authority.projectId !== target.projectId ||
    authority.runId !== target.runId || !hostedTerminalCanonicalRunId(request)
  ) return;
  registerHostedToolRunAuthorization(target, {
    projectId: authority.projectId,
    runId: authority.runId,
  });
}

/** Transfer the verified request capability to its private durable run descriptor. */
export function bindHostedTerminalRun(
  request: ParsedHostedChatRequest,
  run: { runId: string } | null,
  transport: { apiUrl: string; fetch?: typeof globalThis.fetch },
): void {
  const authority = credentials.get(request);
  if (!authority) return;
  if (run?.runId === authority.runId) {
    credentials.set(run, {
      ...authority,
      apiUrl: transport.apiUrl,
      fetch: instrumentConversationRunFetch(transport.fetch ?? hostFetch),
    });
    transferHostedPlatformDependencies(request, run);
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
  request: HostedPlatformDependencyOwner | undefined,
  apiMcpUrl: string,
  fallback: (config: RemoteMCPToolSourceConfig) => RemoteToolSource,
  getAuthToken?: () => string | undefined,
): (config: RemoteMCPToolSourceConfig, server?: AgentServiceMcpServerConfig) => RemoteToolSource {
  const authority = request ? credentials.get(request) : undefined;
  if (!authority) return fallback;
  const expectedEndpoint = createProjectScopedMcpUrl(apiMcpUrl, authority.projectId);
  const parentEventWriter = getActiveHostedRunEventWriterCapability();
  return (config, server) => {
    if (server?.kind !== "veryfront-api") return fallback(config);
    const liveHeaders: NonNullable<RemoteMCPToolSourceConfig["headers"]> = async (context) => {
      const original = typeof config.headers === "function"
        ? await config.headers(context)
        : config.headers;
      const headers = new NativeHeaders(original);
      // Run event authority comes only from the private run credential, never configured headers.
      apply(headersDelete, headers, [INGRESS_RUN_EVENT_TOKEN_HEADER]);
      if (getAuthToken) {
        const token = getAuthToken();
        if (!token) throw new Error("Hosted MCP credential authority is unavailable");
        apply(headersSet, headers, ["Authorization", `Bearer ${token}`]);
      }
      return headers;
    };
    const ordinary = fallback({ ...config, headers: liveHeaders });
    // Project mutations by the verified current run need its exact-run event authority.
    const isCurrentRunProjectCall = (name: string, context: ToolExecutionContext | undefined) =>
      !!authority.eventToken && context?.projectId === authority.projectId &&
      context.runId === authority.runId && hasCurrentTerminalRunCredentialAuthority(context) &&
      name !== "create_run" && name !== "veryfront__create_run";
    const mutation = authority.eventToken
      ? fallback({
        ...config,
        endpoint: expectedEndpoint,
        headers: async (context) => {
          const headers = copyNativeHeaders(await liveHeaders(context));
          if (context?.projectId === authority.projectId && context.runId === authority.runId) {
            apply(headersSet, headers, [INGRESS_RUN_EVENT_TOKEN_HEADER, authority.eventToken!]);
          }
          return headers;
        },
      })
      : ordinary;
    const terminal = fallback({
      ...config,
      endpoint: expectedEndpoint,
      headers: async (context) => {
        const headers = new NativeHeaders(await liveHeaders(context));
        if (
          context?.runId === authority.runId && hasCurrentTerminalRunCredentialAuthority(context)
        ) {
          apply(headersSet, headers, [RUN_TERMINAL_TOKEN_HEADER, authority.token]);
          const toolCallId = terminalToolCallIdHeaderValue(context);
          apply(headersSet, headers, [
            "Idempotency-Key",
            await computeHash(`${authority.token}:${toolCallId ?? "finalize"}`),
          ]);
          let canonicalRunId: string | undefined;
          try {
            canonicalRunId = terminalRoute(authority.token, authority.runId).id;
          } catch {
            // Invalid capability hints never establish a canonical response identity.
          }
          if (canonicalRunId) bindTerminalRunResponseIdentity(context, canonicalRunId);
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
      executeTool: async (name, args, context) => {
        if (isTerminalRunToolName(name)) return terminal.executeTool(name, args, context);
        if (
          (name === "create_run" || name === "veryfront__create_run") &&
          context?.runId === authority.runId && hasCurrentTerminalRunCredentialAuthority(context) &&
          terminalToolCallIdHeaderValue(context) &&
          typeof args === "object" && args !== null && !Array.isArray(args) && "input" in args &&
          typeof args.input === "object" && args.input !== null && !Array.isArray(args.input) &&
          "target" in args.input
        ) {
          // Runtime-owned invocation identity reaches ordinary admission; the API
          // still verifies the authenticated parent and its recorded tool start.
          await waitForHostedParentToolStart(
            parentEventWriter,
            authority.runId,
            terminalToolCallIdHeaderValue(context)!,
          );
          const parentRunId = terminalRoute(authority.token, authority.runId).id;
          const input = args.input as Record<string, unknown>;
          return ordinary.executeTool(name, {
            ...args,
            input: {
              ...input,
              ...(input.parent_run_id === undefined ? { parent_run_id: parentRunId } : {}),
              ...(input.tool_call_id === undefined
                ? { tool_call_id: terminalToolCallIdHeaderValue(context) }
                : {}),
            },
          }, context);
        }
        return isCanonicalFileMutationTool(name) || isCurrentRunProjectCall(name, context)
          ? mutation.executeTool(name, args, context)
          : ordinary.executeTool(name, args, context);
      },
    };
  };
}

type HostedInheritedRunAdmitter<Result> = (toolCallId: string, prompt: string) => (
  input: Omit<Parameters<typeof createConversationAgentRun>[0], "conversationId"> & {
    conversationId?: string;
    acceptedTaskInputReceipt?: HostedAcceptedTaskInputReceipt;
  },
) => Promise<Result>;
type InheritedAdmissionTransport = { apiUrl: string; fetch?: typeof globalThis.fetch };

/** Build an inherited admission transport bound to an authentic parent capability. */
export function hostedInheritedRunAdmitter(
  request: ParsedHostedChatRequest | HostedTerminalDescriptor,
  transport: InheritedAdmissionTransport,
  terminalReplay: true,
): HostedInheritedRunAdmitter<ConversationRunProjection | InheritedRunResult> | undefined;
export function hostedInheritedRunAdmitter(
  request: ParsedHostedChatRequest | HostedTerminalDescriptor,
  transport: InheritedAdmissionTransport,
  terminalReplay?: false,
): HostedInheritedRunAdmitter<ConversationRunProjection> | undefined;
export function hostedInheritedRunAdmitter(
  request: ParsedHostedChatRequest | HostedTerminalDescriptor,
  transport: InheritedAdmissionTransport,
  terminalReplay = false,
): HostedInheritedRunAdmitter<ConversationRunProjection | InheritedRunResult> | undefined {
  const parent = credentials.get(request);
  if (!parent?.authToken) return undefined;
  const parentId = terminalRoute(parent.token, parent.runId).id;
  const send = transport.fetch ?? hostFetch;
  return (toolCallId, prompt) => async (input) => {
    if (input.parentRunId !== parent.runId) {
      throw new Error("Inherited child parent binding mismatch");
    }
    const acceptedReference = hostedAcceptedTaskInputReference(
      input.acceptedTaskInputReceipt,
      parent.runId,
      input.agentId,
    );
    const childProjectId = input.projectId ?? parent.projectId;
    const response = await send(`${transport.apiUrl}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${parent.authToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `inherited:${await computeHash(
          inheritedInvocationIdentity(parentId, toolCallId),
        )}`,
        "X-Veryfront-Run-Execution-Mode": "inherited",
        Accept: "application/vnd.veryfront.inherited-run+json",
        [RUN_TERMINAL_TOKEN_HEADER]: parent.token,
      },
      body: JSON.stringify({
        project_id: childProjectId,
        target: { type: "agent", id: input.agentId },
        parent_run_id: parentId,
        tool_call_id: toolCallId,
        ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
        input: {
          text: prompt,
          ...(acceptedReference ? { accepted_task_input: acceptedReference } : {}),
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const decode = terminalReplay
      ? acceptWorkflowInheritedRunAdmission
      : acceptInheritedRunAdmission;
    return decode(response, {
      projectId: childProjectId,
      conversationId: input.conversationId,
      parentRunId: parentId,
      agentId: input.agentId,
      apiUrl: transport.apiUrl,
      fetch: send,
      verifyRunEventAppendToken: parent.verifyRunEventAppendToken,
      verifyRunTerminalToken: parent.verifyRunTerminalToken,
    }, request);
  };
}

/** Private execution transport does not grant ordinary child resource reads. */
const admittedInputs = createPrivateWeakStore<Response, HostedTaskInput>();

async function normalizeInheritedExecutionResponse(
  response: Response,
  binding: { projectId: string; parentRunId?: string; agentId?: string; conversationId?: string },
): Promise<Response> {
  if (
    response.headers.get("Content-Type")?.split(";")[0]?.trim() !==
      "application/vnd.veryfront.inherited-run+json"
  ) return response;
  const mismatch = () => new Error("Inherited child resource binding mismatch");
  let value;
  let route: { id: string; generation: string };
  try {
    value = await response.clone().json();
    const token = response.headers.get(RUN_TERMINAL_TOKEN_HEADER) ?? "";
    route = terminalRoute(token, terminalRoutingRunId(token));
  } catch {
    throw mismatch();
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const terminal = ["completed", "failed", "cancelled"].includes(value?.status);
  if (
    value?.version !== 1 || !response.ok ||
    !response.headers.get("Cache-Control")?.includes("no-store") ||
    !binding.parentRunId || !binding.agentId || value.parentRunId !== binding.parentRunId ||
    value.projectId !== binding.projectId || value.agentId !== binding.agentId ||
    value.canonicalRunId !== route.id || value.dispatchNonce !== route.generation ||
    ![value.canonicalRunId, value.parentRunId, value.conversationId, value.outputMessageId].every((
      id,
    ) => typeof id === "string" && uuid.test(id)) ||
    (binding.conversationId !== undefined && value.conversationId !== binding.conversationId) ||
    !["pending", "running", "waiting", "completed", "failed", "cancelled"].includes(value.status) ||
    (terminal && !Object.hasOwn(value, "output")) ||
    (value.outputFormat !== undefined &&
      (value.status !== "completed" || value.outputFormat !== "text-data-v1")) ||
    (value.error != null &&
      (typeof value.error?.code !== "string" || typeof value.error?.message !== "string"))
  ) throw mismatch();
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  const normalized = new Response(
    JSON.stringify({
      id: value.canonicalRunId,
      parent_run_id: value.parentRunId,
      project_id: value.projectId,
      target: { type: "agent", id: value.agentId },
      status: value.status,
      conversation_id: value.conversationId,
      output_message_id: value.outputMessageId,
      ...(terminal ? { output: value.output, ...(value.error ? { error: value.error } : {}) } : {}),
    }),
    { status: response.status, headers },
  );
  if (value.outputFormat === "text-data-v1") {
    inheritedOutputFormats.set(normalized, value.outputFormat);
  }
  if (value.taskInput !== undefined) {
    const taskInput = resolveHostedTaskInput(value.taskInput, {
      projectId: binding.projectId,
      runId: terminalRoutingRunId(response.headers.get(RUN_TERMINAL_TOKEN_HEADER) ?? ""),
      rootRunId: value.taskInput?.rootRunId,
    });
    if (!taskInput) throw mismatch();
    admittedInputs.set(normalized, taskInput);
  }
  return normalized;
}

export type InheritedRunResult = { readonly terminalReceipt: InheritedTerminalReceipt };

async function verifyInheritedTaskInputBinding(
  response: Response,
  binding: {
    projectId: string;
    agentId?: string;
    verifyRunEventAppendToken?: ParseHostedChatRequestOptions["verifyRunEventAppendToken"];
  },
  eventToken: string | null,
  runId: string,
) {
  const taskInput = admittedInputs.get(response);
  const verification = eventToken
    ? await binding.verifyRunEventAppendToken?.({
      token: eventToken,
      projectId: binding.projectId,
      runId,
      ...(binding.agentId ? { agentId: binding.agentId } : {}),
    })
    : undefined;
  if (
    taskInput ||
    (verification && typeof verification === "object" &&
      (verification.taskInputSha256 !== undefined || verification.taskInputRootRunId !== undefined))
  ) {
    if (
      !taskInput || !verification || typeof verification !== "object" ||
      verification.verified !== true || verification.taskInputRootRunId !== taskInput.rootRunId ||
      (verification.rootRunId !== undefined && verification.rootRunId !== taskInput.rootRunId) ||
      verification.taskInputSha256 !== await computeHash(encodeHostedTaskInput(taskInput))
    ) throw new Error("Inherited task input signed binding mismatch");
  }
  return verification;
}

/** Read a terminal workflow child without restoring an earlier execution capability. */
export async function acceptWorkflowInheritedRunAdmission(
  response: Response,
  binding: {
    projectId: string;
    parentRunId: string;
    agentId: string;
    apiUrl: string;
    fetch: typeof globalThis.fetch;
    verifyRunEventAppendToken?: ParseHostedChatRequestOptions["verifyRunEventAppendToken"];
    verifyRunTerminalToken?: ParseHostedChatRequestOptions["verifyRunTerminalToken"];
  },
  dependencyParent?: HostedPlatformDependencyOwner,
): Promise<ConversationRunProjection | InheritedRunResult> {
  response = await normalizeInheritedExecutionResponse(response, binding);
  const row = await response.clone().json();
  if (row?.status !== "completed" && row?.status !== "failed" && row?.status !== "cancelled") {
    return await acceptInheritedRunAdmission(response, binding, dependencyParent);
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !response.ok || !response.headers.get("Cache-Control")?.includes("no-store") ||
    row.project_id !== binding.projectId || row.parent_run_id !== binding.parentRunId ||
    row.target?.type !== "agent" || row.target.id !== binding.agentId ||
    ![row.id, row.conversation_id, row.output_message_id].every((id) =>
      typeof id === "string" && uuid.test(id)
    ) ||
    !Object.hasOwn(row, "output") ||
    (row.error !== undefined &&
      (typeof row.error?.code !== "string" || typeof row.error?.message !== "string"))
  ) throw new Error("Inherited child resource binding mismatch");
  const eventToken = response.headers.get("X-Veryfront-Run-Event-Token");
  const terminalToken = response.headers.get(RUN_TERMINAL_TOKEN_HEADER);
  const taskInput = admittedInputs.get(response);
  if (taskInput && !terminalToken) throw new Error("Inherited task input signed binding mismatch");
  await verifyInheritedTaskInputBinding(
    response,
    binding,
    eventToken,
    terminalToken ? terminalRoutingRunId(terminalToken) : row.id,
  );
  const outputFormat = inheritedOutputFormats.get(response);
  return {
    terminalReceipt: {
      status: row.status,
      output: row.output,
      ...(outputFormat ? { outputFormat } : {}),
      ...(row.error ? { error: { code: row.error.code, message: row.error.message } } : {}),
    },
  };
}

function assertInheritedChildResourceBinding(
  response: Response,
  binding: { conversationId?: string },
  row: Record<string, unknown>,
  canonicalId: string,
  eventCursor: number,
  externalCursor: number,
): void {
  if (
    canonicalId !== row.id ||
    (binding.conversationId !== undefined && row.conversation_id !== binding.conversationId) ||
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
}

function recordInheritedTerminalReceipt(
  run: Pick<ConversationRunProjection, "runId">,
  row: {
    status: string;
    output?: unknown;
    error?: { code?: unknown; message?: unknown };
  },
  outputFormat: "text-data-v1" | undefined,
): void {
  if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
    terminalReceipts.set(run, {
      status: row.status,
      output: row.output ?? null,
      ...(outputFormat ? { outputFormat } : {}),
      ...(typeof row.error?.code === "string" && typeof row.error?.message === "string"
        ? { error: { code: row.error.code, message: row.error.message } }
        : {}),
    });
  }
}

function assertInheritedLeaseReceipt(
  receipt: { run_id?: unknown },
  canonicalId: string,
  leaseExpiresAt: number,
): void {
  if (
    receipt.run_id !== canonicalId || !Number.isFinite(leaseExpiresAt) ||
    leaseExpiresAt <= Date.now()
  ) {
    throw new Error("Inherited child lease response binding mismatch");
  }
}

/** Bind an inherited admission response to private exact-child authority for trusted runtime adapters. */
export async function acceptInheritedRunAdmission(
  response: Response,
  binding: {
    projectId: string;
    conversationId?: string;
    parentRunId?: string;
    agentId?: string;
    apiUrl: string;
    fetch: typeof globalThis.fetch;
    verifyRunEventAppendToken?: ParseHostedChatRequestOptions["verifyRunEventAppendToken"];
    verifyRunTerminalToken?: ParseHostedChatRequestOptions["verifyRunTerminalToken"];
  },
  dependencyParent?: HostedPlatformDependencyOwner,
): Promise<ConversationRunProjection> {
  response = await normalizeInheritedExecutionResponse(response, binding);
  if (!response.ok) throw new Error(`Inherited child admission failed (${response.status})`);
  if (!response.headers.get("Cache-Control")?.includes("no-store")) {
    throw new Error("Inherited child credentials require no-store");
  }
  const row = await response.json();
  const token = response.headers.get(RUN_TERMINAL_TOKEN_HEADER);
  const authToken = response.headers.get("X-Veryfront-Run-Invocation-Token");
  const inferenceToken = response.headers.get("X-Veryfront-Inference-Token");
  const renewalToken = response.headers.get("X-Veryfront-Run-Renewal-Token");
  const eventToken = response.headers.get("X-Veryfront-Run-Event-Token");
  if (!token || !authToken || !renewalToken || !eventToken) {
    throw new Error("Inherited child authority is missing");
  }
  const runId = terminalRoutingRunId(token);
  const canonical = terminalRoute(token, runId);
  const eventCursor = Number(response.headers.get("X-Veryfront-Run-Event-Sequence"));
  const externalCursor = Number(response.headers.get("X-Veryfront-Run-External-Event-Sequence"));
  assertInheritedChildResourceBinding(
    response,
    binding,
    row,
    canonical.id,
    eventCursor,
    externalCursor,
  );
  const taskInput = admittedInputs.get(response);
  const verification = await verifyInheritedTaskInputBinding(response, binding, eventToken, runId);
  if (taskInput) authorizeHostedTaskInput(taskInput);
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
  const outputFormat = inheritedOutputFormats.get(response);
  recordInheritedTerminalReceipt(run, row, outputFormat);
  credentials.set(run, {
    token,
    agentId: binding.agentId,
    verifyRunEventAppendToken: binding.verifyRunEventAppendToken,
    verifyRunTerminalToken: binding.verifyRunTerminalToken,
    ...(verification && typeof verification === "object" && verification.verified === true &&
        typeof verification.rootRunId === "string"
      ? { rootRunId: verification.rootRunId }
      : {}),
    ...(taskInput ? { taskInput } : {}),
    authToken,
    renewalToken,
    eventToken,
    ...(inferenceToken ? { inferenceToken } : {}),
    leaseExpiresAt: Date.parse(response.headers.get("X-Veryfront-Run-Lease-Expires-At") ?? ""),
    runId: run.runId,
    projectId: binding.projectId,
    apiUrl: binding.apiUrl,
    fetch: binding.fetch,
  });
  if (dependencyParent && binding.agentId) {
    await registerHostedChildPlatformDependencies(
      dependencyParent,
      run,
      { projectId: binding.projectId, runId, agentId: binding.agentId },
      eventToken,
      authToken,
    );
  }
  return run;
}

/** Read invocation authority only from this exact child's private admission descriptor. */
export function hostedInheritedInvocationCredentialReader(
  descriptor: HostedTerminalDescriptor,
): (() => string) | undefined {
  if (!credentials.get(descriptor)) return undefined;
  return () => {
    const current = credentials.get(descriptor);
    if (!current?.authToken) throw new Error("Inherited child invocation authority is required");
    return current.authToken;
  };
}

/** Create inference transport only from this inherited child's private admission authority. */
export function hostedInheritedInferenceModelResolver(
  descriptor: HostedTerminalDescriptor,
  options: { projectModels?: boolean; signal?: AbortSignal } = {},
) {
  const authority = credentials.get(descriptor);
  if (!authority) return undefined;
  if (!authority.inferenceToken || !authority.apiUrl) {
    throw new Error("Inherited child inference authority is required");
  }
  const resolver = createVeryfrontCloudInferenceModelResolver(() => {
    const current = credentials.get(descriptor);
    if (!current?.inferenceToken) {
      throw new Error("Inherited child inference authority is required");
    }
    return current.inferenceToken;
  }, {
    apiBaseUrl: authority.apiUrl,
    assertParentActive: () => options.signal?.throwIfAborted(),
  });
  return options.projectModels
    ? (model: string) =>
      resolver(model.startsWith("veryfront-cloud/") ? model : `veryfront-cloud/${model}`)
    : resolver;
}

type RenewedInheritedAuthority = Readonly<{
  invocation: string;
  inference: string;
  terminal: string;
  renewal: string;
  events: string;
}>;

const RUN_CREDENTIAL_ROTATION_HEADER = "X-Veryfront-Run-Credential-Rotation";
const RUN_CREDENTIAL_ROTATION_VERSION = "v2";
const RENEWED_INHERITED_AUTHORITY_HEADERS = [
  "X-Veryfront-Run-Invocation-Token",
  "X-Veryfront-Inference-Token",
  RUN_TERMINAL_TOKEN_HEADER,
  "X-Veryfront-Run-Renewal-Token",
  "X-Veryfront-Run-Event-Token",
] as const;

function acknowledgesInheritedAuthorityRotation(response: Response): boolean {
  // Mixed-version rollout contract: an old API returns neither the acknowledgement
  // nor credentials, while a v2 API acknowledges and returns the complete bundle.
  // Any partial or unrecognised response fails closed instead of mixing generations.
  const acknowledgement = response.headers.get(RUN_CREDENTIAL_ROTATION_HEADER);
  if (acknowledgement === RUN_CREDENTIAL_ROTATION_VERSION) return true;
  let hasCredentialHeader = false;
  forEachPrivateArray(RENEWED_INHERITED_AUTHORITY_HEADERS, (header) => {
    if (response.headers.has(header)) hasCredentialHeader = true;
  });
  if (acknowledgement !== null || hasCredentialHeader) {
    throw new Error("Inherited child lease credential rotation acknowledgement mismatch");
  }
  return false;
}

function readRenewedInheritedAuthority(
  response: Response,
  runId: string,
  canonicalRunId: string,
): RenewedInheritedAuthority {
  if (!response.headers.get("Cache-Control")?.includes("no-store")) {
    throw new Error("Inherited child lease credentials require no-store");
  }
  const authority = {
    invocation: response.headers.get("X-Veryfront-Run-Invocation-Token"),
    inference: response.headers.get("X-Veryfront-Inference-Token"),
    terminal: response.headers.get(RUN_TERMINAL_TOKEN_HEADER),
    renewal: response.headers.get("X-Veryfront-Run-Renewal-Token"),
    events: response.headers.get("X-Veryfront-Run-Event-Token"),
  };
  if (
    !authority.invocation || authority.invocation.length > 16384 ||
    !authority.inference || authority.inference.length > 16384 ||
    !authority.terminal || authority.terminal.length > 16384 ||
    !authority.renewal || authority.renewal.length > 16384 ||
    !authority.events || authority.events.length > MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES ||
    terminalRoutingRunId(authority.terminal) !== runId ||
    terminalRoute(authority.terminal, runId).id !== canonicalRunId
  ) {
    throw new Error("Inherited child lease authority binding mismatch");
  }
  return authority as RenewedInheritedAuthority;
}

function rotateInheritedChildAuthority(
  descriptor: HostedTerminalDescriptor,
  response: Response,
): void {
  const authority = credentials.get(descriptor);
  if (!authority) throw new Error("Inherited child authority is required");
  const renewed = readRenewedInheritedAuthority(
    response,
    authority.runId,
    terminalRoute(authority.token, authority.runId).id,
  );
  rotateHostedPlatformDependencyCredential(descriptor, renewed.invocation);
  forEachPrivateArray(authority.eventWriters ?? [], (writer) => {
    refreshHostedRunEventWriterCapability(writer, {
      runId: authority.runId,
      runEventAppendToken: renewed.events,
    });
  });
  authority.authToken = renewed.invocation;
  authority.inferenceToken = renewed.inference;
  authority.token = renewed.terminal;
  authority.renewalToken = renewed.renewal;
  authority.eventToken = renewed.events;
}

/** Preserve exact private authority when a trusted adapter projects its descriptor. */
export function transferHostedTerminalAuthority(
  source: HostedTerminalDescriptor,
  target: HostedTerminalDescriptor,
): void {
  const authority = credentials.get(source);
  if (authority) {
    credentials.set(target, authority);
    transferHostedPlatformDependencies(source, target);
  }
  const receipt = terminalReceipts.get(source);
  if (receipt) terminalReceipts.set(target, receipt);
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
              [RUN_CREDENTIAL_ROTATION_HEADER]: RUN_CREDENTIAL_ROTATION_VERSION,
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
      assertInheritedLeaseReceipt(receipt, canonicalId, leaseExpiresAt);
      if (acknowledgesInheritedAuthorityRotation(response)) {
        rotateInheritedChildAuthority(descriptor, response);
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
  return (abortSignal?: AbortSignal) => {
    const current = credentials.get(descriptor);
    if (!current?.authToken || current.runId !== expectedRunId) {
      throw new Error("Inherited child authority is required");
    }
    return getCanonicalRunStatus({
      apiUrl,
      authToken: current.authToken,
      runId: current.runId,
      canonicalRunId: terminalRoute(current.token, current.runId).id,
      abortSignal,
      fetch: current.fetch,
    });
  };
}

/** Reconstitute only the exact child writer issued by inherited admission. */
export function hostedInheritedEventWriter(descriptor: HostedTerminalDescriptor) {
  const authority = credentials.get(descriptor);
  if (!authority?.eventToken || !authority.apiUrl) return undefined;
  const writer = createHostedRunEventWriterCapability({
    inheritedExecution: true,
    projectId: authority.projectId,
    apiUrl: authority.apiUrl,
    runId: authority.runId,
    canonicalRunId: terminalRoute(authority.token, authority.runId).id,
    runEventAppendToken: authority.eventToken,
    fetch: authority.fetch,
    acceptedChildEvidence: (projectId, signal) =>
      hostedAcceptedChildEvidence(descriptor, projectId, signal),
    inheritedAdmitter: hostedInheritedRunAdmitter(descriptor, {
      apiUrl: authority.apiUrl,
      fetch: authority.fetch,
    }),
  });
  authority.eventWriters ??= [];
  appendPrivateArray(authority.eventWriters, [writer]);
  return writer;
}

/** Restore child input only from verified private native admission, never caller context. */
export function hostedInheritedTaskInput(
  descriptor: HostedTerminalDescriptor,
  projectId: string,
): HostedTaskInput | undefined {
  const authority = credentials.get(descriptor);
  if (!authority) return undefined;
  if (authority.projectId !== projectId) {
    throw new Error("Inherited task input project mismatch");
  }
  return authority.taskInput
    ? resolveHostedTaskInput(authority.taskInput, {
      projectId,
      runId: authority.runId,
      rootRunId: authority.taskInput.rootRunId,
    })
    : undefined;
}

/** Canonical root from the child writer verifier, retained outside caller context. */
export function hostedInheritedRootRunId(
  descriptor: HostedTerminalDescriptor,
  projectId: string,
): string | undefined {
  const authority = credentials.get(descriptor);
  if (!authority) return undefined;
  if (authority.projectId !== projectId) throw new Error("Inherited root project mismatch");
  return authority.rootRunId;
}

/** Read authenticated API evidence using the verified writer parent and its project. */
export function hostedAcceptedChildEvidence(
  descriptor: HostedTerminalDescriptor | ParsedHostedChatRequest,
  projectId: string,
  signal?: AbortSignal,
  transport?: { apiUrl: string; fetch?: typeof globalThis.fetch },
): HostedAcceptedChildEvidence {
  const authority = credentials.get(descriptor);
  if (
    !authority?.authToken || !(transport?.apiUrl ?? authority.apiUrl) ||
    !(transport?.fetch ?? authority.fetch ?? hostFetch) || authority.projectId !== projectId
  ) throw new Error("Accepted receipt readers require exact parent authority");
  async function verifiedParentId(): Promise<string> {
    const writer = authority!.eventToken;
    const verification = writer && await authority!.verifyRunEventAppendToken?.({
      token: writer,
      projectId,
      runId: authority!.runId,
      ...(authority!.agentId ? { agentId: authority!.agentId } : {}),
    });
    if (
      !writer || !(verification === true ||
        (verification && typeof verification === "object" && verification.verified === true))
    ) {
      throw new Error("Accepted receipt readers require verified parent authority");
    }
    // Decode only the unchanged writer that the host just authenticated. Terminal
    // payloads are routing hints and cannot authorize reads with the parent bearer.
    const encoded = apply(evidenceSplit, writer, ["."])[1];
    const claims = snapshotOwnDataRecords(privateJsonParse(
      evidenceDecode(
        apply(evidenceReplaceAll, apply(evidenceReplaceAll, encoded, ["-", "+"]), ["_", "/"]),
      ),
    )) as {
      projectId?: unknown;
      runId?: unknown;
      workerGeneration?: { projectId?: unknown; runId?: unknown; canonicalRunId?: unknown };
      projectExecutionAttempt?: { canonicalRunId?: unknown };
    };
    const worker = claims.workerGeneration;
    let canonical = worker?.canonicalRunId ?? claims.projectExecutionAttempt?.canonicalRunId;
    if (
      canonical === undefined && await authority!.verifyRunTerminalToken?.({
          token: authority!.token,
          projectId,
          runId: authority!.runId,
        }) === true
    ) {
      canonical = terminalRoute(authority!.token, authority!.runId).id;
    }
    if (
      claims.projectId !== projectId || claims.runId !== authority!.runId ||
      (worker && (worker.projectId !== projectId || worker.runId !== authority!.runId)) ||
      typeof canonical !== "string" ||
      !apply(
        evidenceRegExpExec,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        [canonical],
      )
    ) {
      throw new Error("Accepted receipt readers require verified parent identity");
    }
    return canonical;
  }
  const send = transport?.fetch ?? authority.fetch ?? hostFetch,
    resolveApiUrl = createVeryfrontApiRequestUrlResolver(transport?.apiUrl ?? authority.apiUrl!);
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  async function read(path: string): Promise<unknown> {
    const currentToken = credentials.get(descriptor)?.authToken;
    if (!currentToken) throw new Error("Accepted receipt reader authority is required");
    const response = await send(resolveApiUrl(path), {
      headers: { Authorization: `Bearer ${currentToken}`, Accept: "application/json" },
      redirect: "error",
      signal: requestSignal,
    });
    if (!apply(evidenceResponseOk, response, [])) {
      throw new Error(
        `Accepted receipt read failed (${apply(evidenceResponseStatus, response, [])})`,
      );
    }
    const stream = apply(evidenceResponseBody, response, []) as ReadableStream<Uint8Array> | null;
    const body = await readResponseTextPrefix(
      {
        body: stream ? { getReader: () => getPrivateStreamReader(stream) } : null,
      },
      3_000_000,
      requestSignal,
    );
    if (body.truncated) throw new Error("Accepted receipt read exceeds byte budget");
    return privateJsonParse(body.text);
  }
  return evidenceFreeze({
    async readParentToolResults() {
      const canonical = await verifiedParentId();
      const page = await read(
        `/runs/${
          evidenceEncodeURIComponent(canonical)
        }/events?event_type=TOOL_CALL_RESULT&limit=100&sort_order=desc&include_descendants=false`,
      ) as { data?: unknown; page_info?: { next?: unknown } };
      if (!evidenceIsArray(page.data) || page.data.length > 100 || page.page_info?.next !== null) {
        throw new Error("Parent receipt evidence is incomplete");
      }
      forEachPrivateArray(page.data, (row) => {
        if (
          !row || typeof row !== "object" || row.run_id !== canonical ||
          row.event_type !== "TOOL_CALL_RESULT" || !evidenceSafeInteger(row.event_id) ||
          row.event_id <= 0
        ) throw new Error("Parent receipt evidence has wrong scope");
      });
      return evidenceFreeze(mapPrivateArray(page.data, (row) => evidenceFreeze(row)));
    },
    async readCommittedVersion(path: string, versionId: string) {
      await verifiedParentId();
      if (
        typeof path !== "string" || !path || path.length > 512 || typeof versionId !== "string" ||
        !apply(
          evidenceRegExpExec,
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          [versionId],
        )
      ) throw new Error("Invalid accepted artifact reference");
      const value = await read(
        `/projects/${evidenceEncodeURIComponent(projectId)}/files/${
          evidenceEncodeURIComponent(path)
        }/versions/${evidenceEncodeURIComponent(versionId)}`,
      ) as { path?: unknown; id?: unknown; content?: unknown };
      if (value.path !== path || value.id !== versionId || typeof value.content !== "string") {
        throw new Error("Historical artifact identity mismatch");
      }
      return { path, versionId, content: value.content };
    },
  });
}

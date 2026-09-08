import type { JsonValue } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  createApplicationRequest,
  isInfrastructureOnlyRequestHeader,
} from "#veryfront/security/http/application-request.ts";
import {
  buildParsedHostedAgUiRequest,
  createHostedAgUiValidationErrorResponse,
  type ParsedHostedAgUiRequest,
} from "../hosted/ag-ui-chat-request.ts";
import {
  createHostedRunEventWriterCapabilityForRequest,
  type HostedRunEventWriterCapability,
} from "../hosted/child-run-event-writer-token.ts";
import {
  type ParsedHostedChatRequest,
  parseHostedChatRequestFromRequest,
  type ParseHostedChatRequestOptions,
} from "../hosted/chat-request-parser.ts";
import { createHostedInferenceModelResolver } from "../hosted/inference-credential.ts";
import type { AgentModelRuntimeResolver } from "../runtime/model-transport.ts";
import { parseAgUiRuntimeRequestOrError } from "../runtime/ag-ui-contract.ts";
import { isResponseLike } from "./response-like.ts";

export type ManagedAgentIngressKind = "durable" | "ag-ui";

export interface ManagedRunEventWriterCapabilityOptions {
  apiUrl: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Private parsed request and credentials available only to trusted broker preparation. */
export interface ManagedAgentBrokerIngressAuthority<
  TRequest extends ParsedHostedChatRequest = ParsedHostedChatRequest,
> {
  getParsedRequest(): TRequest;
  createInferenceModelResolver(options?: { apiBaseUrl?: string }):
    | AgentModelRuntimeResolver
    | undefined;
  createRunEventWriterCapability(
    options: ManagedRunEventWriterCapabilityOptions,
  ): HostedRunEventWriterCapability | undefined;
}

export type ManagedAgentExecutorAgUiState = Readonly<{
  threadId: string;
  runId: string;
  parentRunId: string | null;
  tools: JsonValue;
  context: JsonValue;
  state?: JsonValue;
}>;

/** Detached bounded application data, without HTTP objects or broker credentials. */
export type ManagedAgentExecutorRequest = Readonly<{
  protocolVersion: 1;
  kind: ManagedAgentIngressKind;
  agentId: string | null;
  userId: string;
  messages: JsonValue;
  context: JsonValue;
  projectId: string | null;
  projectSlug: string | null;
  conversationId: string | null;
  parentRunId: string | null;
  upstreamParentConversationId: string | null;
  upstreamParentRunId: string | null;
  spawnedFromToolCallId: string | null;
  model: string | null;
  allowDelegation: boolean | null;
  forwardedProps: JsonValue;
  runtimeOverrides: JsonValue;
  durableRootRun: JsonValue;
  persistLatestUserMessageBeforeDurableRun: boolean;
  serverEnvelopeVerified: boolean;
  serverResolvedIntegrationToolNames: JsonValue;
  serverResolvedProviderReplayCheckpoints?: JsonValue;
  agUi?: ManagedAgentExecutorAgUiState;
}>;

export type ManagedDurableAgentIngressResult = Readonly<{
  kind: "durable";
  broker: ManagedAgentBrokerIngressAuthority<ParsedHostedChatRequest>;
  executor: ManagedAgentExecutorRequest & { kind: "durable" };
}>;

export type ManagedAgUiAgentIngressResult = Readonly<{
  kind: "ag-ui";
  broker: ManagedAgentBrokerIngressAuthority<ParsedHostedAgUiRequest>;
  executor: ManagedAgentExecutorRequest & {
    kind: "ag-ui";
    agUi: ManagedAgentExecutorAgUiState;
  };
}>;

/** Preserve the distinct durable and direct AG-UI ingress contracts. */
export type ManagedAgentIngressResult =
  | ManagedDurableAgentIngressResult
  | ManagedAgUiAgentIngressResult;

export type ParseManagedAgUiAgentIngressOptions =
  & Pick<
    ParseHostedChatRequestOptions,
    "authenticate" | "verifyProjectAccess"
  >
  & { forwardedConfigNamespace?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeForwardedProps(value: unknown): unknown {
  if (!isRecord(value)) return null;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key.startsWith("serverResolved")) sanitized[key] = entry;
  }
  const runtimeOverrides = sanitized.runtimeOverrides;
  if (
    isRecord(runtimeOverrides) && Object.hasOwn(runtimeOverrides, "serverResolvedIntegrationTools")
  ) {
    const sanitizedRuntimeOverrides = Object.fromEntries(
      Object.entries(runtimeOverrides).filter(([key]) => key !== "serverResolvedIntegrationTools"),
    );
    if (Object.keys(sanitizedRuntimeOverrides).length > 0) {
      sanitized.runtimeOverrides = sanitizedRuntimeOverrides;
    } else {
      delete sanitized.runtimeOverrides;
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

/** Bun retains source headers when Request init supplies a replacement list. */
function removeRetainedInfrastructureHeaders(request: Request): Request {
  const headers = request.headers;
  for (const name of [...headers.keys()]) {
    if (isInfrastructureOnlyRequestHeader(name)) headers.delete(name);
  }
  return request;
}

function boundedExecutorRequest(value: unknown): ManagedAgentExecutorRequest {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) {
    throw new TypeError("Managed agent executor request must contain bounded JSON data");
  }
  return snapshot.value as ManagedAgentExecutorRequest;
}

function createBrokerAuthority<TRequest extends ParsedHostedChatRequest>(
  parsedRequest: TRequest,
): ManagedAgentBrokerIngressAuthority<TRequest> {
  const authority = Object.create(null) as ManagedAgentBrokerIngressAuthority<TRequest>;
  Object.defineProperties(authority, {
    getParsedRequest: {
      enumerable: false,
      value: () => parsedRequest,
    },
    createInferenceModelResolver: {
      enumerable: false,
      value: (options?: { apiBaseUrl?: string }) =>
        createHostedInferenceModelResolver(parsedRequest, options),
    },
    createRunEventWriterCapability: {
      enumerable: false,
      value: (options: ManagedRunEventWriterCapabilityOptions) => {
        const runId = parsedRequest.durableRootRun?.runId;
        return runId
          ? createHostedRunEventWriterCapabilityForRequest(parsedRequest, {
            ...options,
            runId,
          })
          : undefined;
      },
    },
  });
  return Object.freeze(authority);
}

function createExecutorRequest(
  kind: ManagedAgentIngressKind,
  parsedRequest: ParsedHostedChatRequest,
  agUiInput?: ParsedHostedAgUiRequest["agUiInput"],
): ManagedAgentExecutorRequest {
  const request = {
    protocolVersion: 1,
    kind,
    agentId: parsedRequest.agentId ?? null,
    userId: parsedRequest.userId,
    messages: parsedRequest.messages,
    context: parsedRequest.validatedContext,
    projectId: parsedRequest.projectId,
    projectSlug: parsedRequest.projectSlug ?? null,
    conversationId: parsedRequest.conversationId ?? null,
    parentRunId: parsedRequest.parentRunId ?? null,
    upstreamParentConversationId: parsedRequest.upstreamParentConversationId ?? null,
    upstreamParentRunId: parsedRequest.upstreamParentRunId ?? null,
    spawnedFromToolCallId: parsedRequest.spawnedFromToolCallId ?? null,
    model: parsedRequest.model ?? null,
    allowDelegation: parsedRequest.allowDelegation ?? null,
    forwardedProps: sanitizeForwardedProps(parsedRequest.forwardedProps),
    runtimeOverrides: parsedRequest.runtimeOverrides ?? null,
    durableRootRun: parsedRequest.durableRootRun ?? null,
    persistLatestUserMessageBeforeDurableRun:
      parsedRequest.persistLatestUserMessageBeforeDurableRun,
    serverEnvelopeVerified: parsedRequest.serverEnvelopeVerified === true,
    serverResolvedIntegrationToolNames: parsedRequest.serverResolvedIntegrationToolNames ?? [],
    ...(parsedRequest.serverEnvelopeVerified === true &&
        Object.hasOwn(parsedRequest, "serverResolvedProviderReplayCheckpoints")
      ? {
        serverResolvedProviderReplayCheckpoints:
          parsedRequest.serverResolvedProviderReplayCheckpoints,
      }
      : {}),
    ...(agUiInput
      ? {
        agUi: {
          threadId: agUiInput.threadId,
          runId: agUiInput.runId,
          parentRunId: agUiInput.parentRunId ?? null,
          tools: agUiInput.tools,
          context: agUiInput.context,
          ...(Object.hasOwn(agUiInput, "state") && agUiInput.state !== undefined
            ? { state: agUiInput.state }
            : {}),
        },
      }
      : {}),
  };
  return boundedExecutorRequest(request);
}

/** Parse the trusted broker's direct canonical durable-run ingress. */
export async function parseManagedDurableAgentIngress(
  request: Request,
  options: ParseHostedChatRequestOptions,
): Promise<ManagedDurableAgentIngressResult | Response> {
  const parsedRequest = await parseHostedChatRequestFromRequest(request, options);
  if (isResponseLike(parsedRequest)) return parsedRequest;
  return Object.freeze({
    kind: "durable" as const,
    broker: createBrokerAuthority(parsedRequest),
    executor: createExecutorRequest("durable", parsedRequest) as
      & ManagedAgentExecutorRequest
      & { kind: "durable" },
  });
}

/** Parse the trusted broker's direct request-owned AG-UI ingress. */
export async function parseManagedAgUiAgentIngress(
  request: Request,
  options: ParseManagedAgUiAgentIngressOptions,
): Promise<ManagedAgUiAgentIngressResult | Response> {
  const applicationRequest = removeRetainedInfrastructureHeaders(
    createApplicationRequest(request),
  );
  const principal = await options.authenticate(applicationRequest);
  if (isResponseLike(principal)) return principal;

  const agUiInput = await parseAgUiRuntimeRequestOrError(applicationRequest);
  if (isResponseLike(agUiInput)) {
    return await createHostedAgUiValidationErrorResponse(agUiInput);
  }

  const parsedRequest = await buildParsedHostedAgUiRequest({
    agUiInput,
    authToken: principal.authToken,
    userId: principal.userId,
    forwardedConfigNamespace: options.forwardedConfigNamespace,
    verifyProjectAccess: options.verifyProjectAccess,
  });
  if (isResponseLike(parsedRequest)) return parsedRequest;

  return Object.freeze({
    kind: "ag-ui" as const,
    broker: createBrokerAuthority(parsedRequest),
    executor: createExecutorRequest("ag-ui", parsedRequest, agUiInput) as
      & ManagedAgentExecutorRequest
      & { kind: "ag-ui"; agUi: ManagedAgentExecutorAgUiState },
  });
}

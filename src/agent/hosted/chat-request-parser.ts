import type {
  ChatRequestContext,
  ChatRuntimeOverrides,
  ChatToolPartState,
  ChatUiMessage,
  ChatUiMessagePart,
  ChatUiMessageRole,
  DurableRootRunDescriptor,
} from "#veryfront/chat/types.ts";
import { stringifyUnknown } from "#veryfront/chat/conversation.ts";
import {
  buildHostedChatRequestInputFromRuntimeAgentInvocation,
  type HostedChatRequest,
  hostedChatRequestSchema,
} from "./chat-request.ts";
import {
  type RuntimeAgentSourceContext,
  safeParseRuntimeAgentRunInvocationValue,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import {
  type HostedRuntimeSourceBindingError,
  type HostedRuntimeSourceIdentity,
  verifyHostedRuntimeSourceBinding,
} from "./runtime-source-binding.ts";
import { getHostedChatUiToolIdentity } from "./chat-request-tool-part.ts";
import { registerHostedRunEventWriterToken } from "./child-run-event-writer-token.ts";
import { registerHostedInferenceCredential } from "./inference-credential.ts";
import {
  MAX_GRANTED_INTEGRATION_TOOL_NAMES,
  MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH,
} from "../../integrations/limits.ts";
import { parseIntegrationToolIdentity } from "../../integrations/source-policy.ts";
import {
  type HostedServiceRunEventAppendTokenVerification as RunEventAppendTokenVerification,
  toRunEventAppendTokenResult,
} from "../service/auth.ts";

const IntrinsicReflectApply = Reflect.apply;
const JsonParse = JSON.parse;

/** Internal control-plane credential for exact-run durable event appends. */
export const RUN_EVENT_APPEND_TOKEN_HEADER = "X-Veryfront-Run-Event-Token";
/** Internal control-plane credential for managed inference on legacy chat dispatches. */
export const INFERENCE_TOKEN_HEADER = "X-Veryfront-Inference-Token";

/** Public API contract for hosted chat request principal. */
export type HostedChatRequestPrincipal = {
  userId: string;
  authToken: string;
};

/** Error shape for hosted chat project access. */
export type HostedChatProjectAccessError = {
  errorCode: string;
  message: string;
  statusCode: number;
};

/** Result returned from hosted chat project access. */
export type HostedChatProjectAccessResult =
  | { success: true; projectSlug?: string }
  | { success: false; error: HostedChatProjectAccessError };

/**
 * Request payload for parsed hosted chat.
 *
 * Verified run-event credentials remain in process-private ingress state and
 * are never exposed on this application-facing request value.
 */
export type ParsedHostedChatRequest = {
  agentId: string | undefined;
  userId: string;
  authToken: string;
  /** True only after a server envelope credential is verified and bound to this run. */
  serverEnvelopeVerified?: true;
  /**
   * Provider-native replay state resolved by the server outside forwardedProps
   * so large opaque provider blocks do not consume the public forwardedProps budget.
   * Ignored unless `serverEnvelopeVerified` is true.
   */
  serverResolvedProviderReplayCheckpoints?: unknown;
  /**
   * Integration tools the control plane resolved for this run, taken from the
   * verified run-event token rather than the request body. Absent unless a
   * token verified, so a forged body can never introduce it.
   */
  serverResolvedIntegrationToolNames?: readonly string[];
  messages: ChatUiMessage[];
  validatedContext: ChatRequestContext;
  projectId: string | null;
  projectSlug?: string;
  conversationId: string | undefined;
  parentRunId: string | undefined;
  upstreamParentConversationId: string | undefined;
  upstreamParentRunId: string | undefined;
  spawnedFromToolCallId: string | undefined;
  /** Durable task identity supplied only by a signed runtime invocation. */
  taskId?: string;
  model: string | undefined;
  allowDelegation: boolean | undefined;
  forwardedProps: HostedChatRequest["forwardedProps"];
  runtimeOverrides: ChatRuntimeOverrides | undefined;
  durableRootRun: DurableRootRunDescriptor | undefined;
  persistLatestUserMessageBeforeDurableRun: boolean;
  agentConfig?: RuntimeAgentMarkdownDefinition;
};

/** Options accepted by parse hosted chat request. */
export type ParseHostedChatRequestOptions = {
  authenticate: (request: Request) => Promise<HostedChatRequestPrincipal | Response>;
  verifyProjectAccess?: (input: {
    projectId: string;
    authToken: string;
  }) => Promise<HostedChatProjectAccessResult>;
  verifyRunEventAppendToken?: (input: {
    token: string;
    projectId: string;
    runId: string;
  }) => Promise<RunEventAppendTokenVerification>;
};

/** Options accepted when parsing a signed control-plane runtime invocation. */
export type ParseRuntimeAgentRunInvocationHostedChatRequestOptions =
  & ParseHostedChatRequestOptions
  & {
    runtimeSource: HostedRuntimeSourceIdentity | undefined;
    /**
     * Service-owned policy for adapters that resolve an immutable or branch
     * source per invocation instead of serving one process-wide snapshot.
     */
    verifyRuntimeSourceBinding?: (
      requestedSource: RuntimeAgentSourceContext,
    ) =>
      | HostedRuntimeSourceBindingError
      | undefined
      | Promise<HostedRuntimeSourceBindingError | undefined>;
  };

async function parseRequestJson(
  request: Request,
  maxBodySizeBytes: number,
): Promise<unknown | Response> {
  let body: string;
  try {
    body = await readBodyWithLimit(request, maxBodySizeBytes);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return Response.json(
        {
          errorCode: "REQUEST_TOO_LARGE",
          message: `Request body exceeds ${maxBodySizeBytes} bytes`,
        },
        { status: 413 },
      );
    }
    return null;
  }
  try {
    return IntrinsicReflectApply(JsonParse, JSON, [body]);
  } catch {
    return null;
  }
}

function createValidationErrorResponse(input: {
  messagePrefix: string;
  validationMessage: string;
}): Response {
  return Response.json(
    {
      errorCode: "VALIDATION_ERROR",
      message: `${input.messagePrefix}: ${input.validationMessage}`,
    },
    { status: 400 },
  );
}

async function withVerifiedRunEventAppendToken(
  request: Request,
  parsedRequest: ParsedHostedChatRequest,
  verifyRunEventAppendToken: ParseHostedChatRequestOptions["verifyRunEventAppendToken"],
  trustServerEnvelope: boolean,
  verifiedContext?: Pick<
    ChatRequestContext,
    "runtimeTargetKind" | "runtimeTargetEnvironmentId"
  >,
  inferenceAuthToken?: string,
): Promise<ParsedHostedChatRequest | Response> {
  const token = request.headers.get(RUN_EVENT_APPEND_TOKEN_HEADER)?.trim();
  if (!token) {
    const hasLegacyReplayState = isRecord(parsedRequest.forwardedProps) &&
      Object.hasOwn(
        parsedRequest.forwardedProps,
        "serverResolvedProviderReplayCheckpoints",
      );
    if (
      trustServerEnvelope &&
      (Object.hasOwn(parsedRequest, "serverResolvedProviderReplayCheckpoints") ||
        hasLegacyReplayState)
    ) {
      return Response.json(
        { errorCode: "INVALID_RUN_EVENT_APPEND_TOKEN" },
        { status: 403 },
      );
    }
    return {
      ...stripUnverifiedServerResolvedRequestState(parsedRequest),
      forwardedProps: stripUnverifiedServerResolvedForwardedProps(
        parsedRequest.forwardedProps,
      ),
    };
  }

  const projectId = parsedRequest.projectId;
  const runId = parsedRequest.durableRootRun?.runId;
  const verification = projectId && runId && verifyRunEventAppendToken
    ? toRunEventAppendTokenResult(
      await verifyRunEventAppendToken({ token, projectId, runId }),
    )
    : { verified: false };
  if (!projectId || !runId || !verification.verified) {
    return Response.json(
      { errorCode: "INVALID_RUN_EVENT_APPEND_TOKEN" },
      { status: 403 },
    );
  }

  // The grant rides on the verified token, so it is trusted on every path that
  // presents one — including the durable-chat path, whose body stays untrusted.
  const grantedIntegrationToolNames = sanitizeGrantedIntegrationToolNames(
    verification.integrationTools,
  );

  const verifiedRequest: ParsedHostedChatRequest = {
    ...(trustServerEnvelope
      ? parsedRequest
      : stripUnverifiedServerResolvedRequestState(parsedRequest)),
    ...(trustServerEnvelope ? { serverEnvelopeVerified: true as const } : {}),
    ...(verifiedContext
      ? { validatedContext: { ...parsedRequest.validatedContext, ...verifiedContext } }
      : {}),
    ...(grantedIntegrationToolNames.length > 0
      ? { serverResolvedIntegrationToolNames: grantedIntegrationToolNames }
      : {}),
    forwardedProps: trustServerEnvelope
      ? parsedRequest.forwardedProps
      : stripUnverifiedServerResolvedForwardedProps(parsedRequest.forwardedProps),
  };
  registerHostedRunEventWriterToken(
    verifiedRequest,
    {
      token,
      projectId,
      runId,
    },
  );
  registerHostedInferenceCredential(verifiedRequest, inferenceAuthToken);
  return verifiedRequest;
}

function stripUnverifiedServerResolvedRequestState(
  parsedRequest: ParsedHostedChatRequest,
): ParsedHostedChatRequest {
  const {
    serverResolvedProviderReplayCheckpoints: _serverResolvedProviderReplayCheckpoints,
    ...publicParsedRequest
  } = parsedRequest;
  return publicParsedRequest;
}

/**
 * Keep only names that are canonical integration tool ids, deduplicated and
 * capped. The grant is signed, so this guards against a control-plane bug
 * rather than an attacker; one malformed name is dropped on its own instead of
 * discarding the whole grant.
 */
function sanitizeGrantedIntegrationToolNames(
  toolNames: readonly string[] | undefined,
): string[] {
  if (!Array.isArray(toolNames)) return [];
  const sanitized: string[] = [];
  const seen = new Set<string>();
  for (const toolName of toolNames) {
    if (
      typeof toolName !== "string" ||
      toolName.length === 0 ||
      toolName.length > MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH ||
      toolName.trim() !== toolName ||
      parseIntegrationToolIdentity(toolName) === null ||
      seen.has(toolName)
    ) {
      continue;
    }
    seen.add(toolName);
    sanitized.push(toolName);
    if (sanitized.length >= MAX_GRANTED_INTEGRATION_TOOL_NAMES) break;
  }
  return sanitized;
}

function stripUnverifiedServerResolvedForwardedProps(
  forwardedProps: ParsedHostedChatRequest["forwardedProps"],
): ParsedHostedChatRequest["forwardedProps"] {
  if (!forwardedProps) return undefined;
  const sanitized = Object.fromEntries(
    Object.entries(forwardedProps).filter(([key]) => !key.startsWith("serverResolved")),
  );

  // The integration grant is nested one level down, so the top-level filter
  // above does not reach it. Leaving a caller-supplied copy in place would let
  // any future reader mistake it for server-resolved state.
  const runtimeOverrides = sanitized.runtimeOverrides;
  if (
    isRecord(runtimeOverrides) &&
    Object.hasOwn(runtimeOverrides, "serverResolvedIntegrationTools")
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

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function getValidationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "validation failed";
}

function normalizeProjectSlug(projectSlug: string | undefined): string | undefined {
  const normalized = projectSlug?.trim();
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mapRawToolCallState(state: string): ChatToolPartState {
  switch (state) {
    case "streaming":
      return "input-streaming";
    case "pending":
      return "pending";
    case "error":
      return "completed";
    default:
      return "completed";
  }
}

function normalizeHostedChatRequestMessages(
  messages: HostedChatRequest["messages"],
): ChatUiMessage[] {
  const knownToolNames = new Map<string, string>();
  const knownToolInputs = new Map<string, Record<string, unknown>>();

  return messages.map((message) => {
    const parts: ChatUiMessagePart[] = [];
    const partIndexByToolCallId = new Map<string, number>();

    for (const part of message.parts) {
      const uiToolIdentity = getHostedChatUiToolIdentity(part);
      if (uiToolIdentity) {
        knownToolNames.set(uiToolIdentity.toolCallId, uiToolIdentity.toolName);
        const input = isRecord(part as unknown)
          ? (part as Record<string, unknown>)["input"]
          : undefined;
        if (isRecord(input)) {
          knownToolInputs.set(uiToolIdentity.toolCallId, input);
        }
        partIndexByToolCallId.set(uiToolIdentity.toolCallId, parts.length);
      }

      if (isRecord(part) && part.type === "tool_call" && "id" in part && "name" in part) {
        const rawPart: Record<string, unknown> = part;
        const rawId = rawPart["id"];
        const rawName = rawPart["name"];
        const toolCallId = typeof rawId === "string" ? rawId : "";
        const toolName = typeof rawName === "string" ? rawName : "";
        const state = typeof part.state === "string" ? part.state : "completed";
        if (!toolCallId || !toolName) continue;

        const input = isRecord(part.input) ? part.input : {};
        knownToolNames.set(toolCallId, toolName);
        knownToolInputs.set(toolCallId, input);
        partIndexByToolCallId.set(toolCallId, parts.length);
        parts.push({
          type: "tool_call",
          toolCallId,
          toolName,
          input,
          state: mapRawToolCallState(state),
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
        });
        continue;
      }

      if (isRecord(part) && part.type === "tool_result") {
        const toolCallId = typeof part.tool_call_id === "string" ? part.tool_call_id : "";
        const explicitToolName = typeof part.tool_name === "string" ? part.tool_name : "";
        const toolName = explicitToolName || knownToolNames.get(toolCallId);
        if (!toolCallId || !toolName) continue;

        const resultPart: ChatUiMessagePart = {
          type: "tool_call",
          toolCallId,
          toolName,
          input: knownToolInputs.get(toolCallId) ?? {},
          state: part.is_error === true ? "output-error" : "output-available",
          output: part.output,
          ...(part.is_error === true
            ? { errorText: stringifyUnknown(part.output ?? "Tool error") }
            : {}),
          ...(part.providerExecuted === true ? { providerExecuted: true } : {}),
        };

        const existingIndex = partIndexByToolCallId.get(toolCallId);
        if (existingIndex !== undefined) {
          const existingPart = parts[existingIndex];
          if (existingPart && isRecord(existingPart)) {
            parts[existingIndex] = {
              ...existingPart,
              state: resultPart.state,
              output: resultPart.output,
              ...(resultPart.errorText ? { errorText: resultPart.errorText } : {}),
            } as ChatUiMessagePart;
          }
        } else {
          parts.push(resultPart);
        }
        continue;
      }

      parts.push(part as ChatUiMessagePart);
    }

    return {
      ...message,
      role: message.role as ChatUiMessageRole,
      parts,
    };
  });
}

function isBlankProjectSlug(projectSlug: string | undefined): boolean {
  return projectSlug !== undefined && !normalizeProjectSlug(projectSlug);
}

async function verifyHostedChatProjectAccess(input: {
  projectId: string | null;
  authToken: string;
  requestedProjectSlug?: string;
  verifyProjectAccess?: ParseHostedChatRequestOptions["verifyProjectAccess"];
}): Promise<{ projectSlug?: string } | Response> {
  if (!input.projectId || !input.verifyProjectAccess) {
    return { projectSlug: normalizeProjectSlug(input.requestedProjectSlug) };
  }

  const access = await input.verifyProjectAccess({
    projectId: input.projectId,
    authToken: input.authToken,
  });
  if (access.success) {
    const requestedProjectSlug = normalizeProjectSlug(input.requestedProjectSlug);
    const verifiedProjectSlug = normalizeProjectSlug(access.projectSlug);
    if (
      requestedProjectSlug &&
      verifiedProjectSlug &&
      requestedProjectSlug !== verifiedProjectSlug
    ) {
      return Response.json(
        {
          errorCode: "FORBIDDEN",
          message: "Project slug does not match verified project access",
        },
        { status: 403 },
      );
    }
    return { projectSlug: verifiedProjectSlug };
  }

  return Response.json(
    { errorCode: access.error.errorCode, message: access.error.message },
    { status: access.error.statusCode === 404 ? 404 : 403 },
  );
}

/** Request payload for build parsed hosted chat. */
type BuildParsedHostedChatRequestInput = {
  chatRequest: HostedChatRequest;
  agentId?: string;
  agentConfig?: RuntimeAgentMarkdownDefinition;
  authToken: string;
  userId: string;
  verifyProjectAccess?: ParseHostedChatRequestOptions["verifyProjectAccess"];
};

async function buildParsedHostedChatRequestInternal(
  input: BuildParsedHostedChatRequestInput,
): Promise<ParsedHostedChatRequest | Response> {
  const {
    messages,
    context: chatContext,
    model,
    allowDelegation,
    forwardedProps,
    serverResolvedProviderReplayCheckpoints,
    runtimeOverrides,
    durableRootRun,
  } = input.chatRequest;
  const projectId = chatContext.projectId;
  const projectSlug = chatContext.projectSlug;
  const conversationId = chatContext.conversationId;

  if (isBlankProjectSlug(projectSlug)) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid request",
      validationMessage: "context.projectSlug cannot be blank",
    });
  }

  if (input.verifyProjectAccess && !projectId && normalizeProjectSlug(projectSlug)) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid request",
      validationMessage: "context.projectSlug requires verified context.projectId",
    });
  }

  if (input.agentConfig && input.agentId && input.agentConfig.id !== input.agentId) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid runtime agent invocation",
      validationMessage: "agentConfig.id must match the requested agent id",
    });
  }

  const access = await verifyHostedChatProjectAccess({
    projectId,
    authToken: input.authToken,
    requestedProjectSlug: projectSlug,
    verifyProjectAccess: input.verifyProjectAccess,
  });
  if (access instanceof Response) {
    return access;
  }
  const verifiedProjectSlug = access.projectSlug;
  const {
    runtimeTargetKind: _runtimeTargetKind,
    runtimeTargetEnvironmentId: _runtimeTargetEnvironmentId,
    ...publicChatContext
  } = chatContext;
  const validatedContext: ChatRequestContext = {
    ...publicChatContext,
    projectSlug: verifiedProjectSlug,
  };

  return {
    agentId: input.agentId,
    userId: input.userId,
    authToken: input.authToken,
    messages: normalizeHostedChatRequestMessages(messages),
    validatedContext,
    projectId,
    projectSlug: verifiedProjectSlug,
    conversationId,
    parentRunId: durableRootRun?.runId,
    upstreamParentConversationId: durableRootRun?.parentConversationId,
    upstreamParentRunId: durableRootRun?.parentRunId,
    spawnedFromToolCallId: durableRootRun?.spawnedFromToolCallId,
    model,
    allowDelegation,
    forwardedProps,
    ...(Object.hasOwn(input.chatRequest, "serverResolvedProviderReplayCheckpoints")
      ? { serverResolvedProviderReplayCheckpoints }
      : {}),
    runtimeOverrides,
    durableRootRun,
    persistLatestUserMessageBeforeDurableRun: false,
    ...(input.agentConfig ? { agentConfig: input.agentConfig } : {}),
  };
}

/** Builds a public hosted chat request without trusting client-supplied runtime targets. */
export function buildParsedHostedChatRequest(
  input: BuildParsedHostedChatRequestInput,
): Promise<ParsedHostedChatRequest | Response> {
  return buildParsedHostedChatRequestInternal(input);
}

/** Request payload for parse hosted chat request from. */
export async function parseHostedChatRequestFromRequest(
  request: Request,
  options: ParseHostedChatRequestOptions,
): Promise<ParsedHostedChatRequest | Response> {
  const authenticatedRequest = await options.authenticate(request);
  if (authenticatedRequest instanceof Response) {
    return authenticatedRequest;
  }

  const requestBody = await parseRequestJson(request, DEFAULT_MAX_BODY_SIZE_BYTES);
  if (requestBody instanceof Response) return requestBody;

  const parsed = hostedChatRequestSchema.safeParse(requestBody);
  if (!parsed.success) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid request",
      validationMessage: getValidationErrorMessage(parsed.error),
    });
  }

  const parsedRequest = await buildParsedHostedChatRequest({
    authToken: authenticatedRequest.authToken,
    userId: authenticatedRequest.userId,
    chatRequest: parsed.data,
    verifyProjectAccess: options.verifyProjectAccess,
  });
  if (parsedRequest instanceof Response) {
    return parsedRequest;
  }

  return await withVerifiedRunEventAppendToken(
    request,
    parsedRequest,
    options.verifyRunEventAppendToken,
    false,
    undefined,
    request.headers.get(INFERENCE_TOKEN_HEADER)?.trim() || undefined,
  );
}

/** Request payload for parse runtime agent run invocation hosted chat request from. */
export async function parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
  request: Request,
  options: ParseRuntimeAgentRunInvocationHostedChatRequestOptions,
): Promise<ParsedHostedChatRequest | Response> {
  const authenticatedRequest = await options.authenticate(request);
  if (authenticatedRequest instanceof Response) {
    return authenticatedRequest;
  }

  const requestBody = await parseRequestJson(request, DEFAULT_MAX_BODY_SIZE_BYTES);
  if (requestBody instanceof Response) return requestBody;

  const invocation = safeParseRuntimeAgentRunInvocationValue(requestBody);
  if (!invocation.success) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid runtime agent invocation",
      validationMessage: getValidationErrorMessage(invocation.error),
    });
  }

  const chatRequest = hostedChatRequestSchema.safeParse(
    buildHostedChatRequestInputFromRuntimeAgentInvocation(invocation.data),
  );
  if (!chatRequest.success) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid runtime agent invocation",
      validationMessage: getValidationErrorMessage(chatRequest.error),
    });
  }

  const parsedRequest = await buildParsedHostedChatRequestInternal({
    authToken: authenticatedRequest.authToken,
    userId: invocation.data.run.requestedByUserId,
    chatRequest: chatRequest.data,
    agentId: invocation.data.run.agentId,
    agentConfig: invocation.data.agentConfig,
    verifyProjectAccess: options.verifyProjectAccess,
  });
  if (parsedRequest instanceof Response) {
    return parsedRequest;
  }

  const sourceBindingError = options.verifyRuntimeSourceBinding
    ? await options.verifyRuntimeSourceBinding(invocation.data.agentSource)
    : verifyHostedRuntimeSourceBinding(options.runtimeSource, invocation.data.agentSource);
  if (sourceBindingError) {
    return Response.json(
      { errorCode: sourceBindingError.errorCode },
      { status: sourceBindingError.status },
    );
  }

  const verifiedRequest = await withVerifiedRunEventAppendToken(
    request,
    parsedRequest,
    options.verifyRunEventAppendToken,
    true,
    {
      runtimeTargetKind: chatRequest.data.context.runtimeTargetKind,
      runtimeTargetEnvironmentId: chatRequest.data.context.runtimeTargetEnvironmentId,
    },
  );
  if (verifiedRequest instanceof Response) {
    return verifiedRequest;
  }

  // Request-scoped agent definitions may only come from the trusted control plane.
  if (verifiedRequest.agentConfig && verifiedRequest.serverEnvelopeVerified !== true) {
    return Response.json(
      { errorCode: "CONTROL_PLANE_AUTH_REQUIRED" },
      { status: 403 },
    );
  }
  if (verifiedRequest.serverEnvelopeVerified === true && invocation.data.taskId) {
    verifiedRequest.taskId = invocation.data.taskId;
  }
  registerHostedInferenceCredential(
    verifiedRequest,
    verifiedRequest.serverEnvelopeVerified === true
      ? invocation.data.credentials?.inferenceAuthToken
      : undefined,
  );
  return verifiedRequest;
}

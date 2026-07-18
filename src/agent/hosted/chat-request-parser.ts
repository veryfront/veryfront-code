import type {
  ChatRequestContext,
  ChatRuntimeOverrides,
  ChatUiMessage,
  DurableRootRunDescriptor,
} from "#veryfront/chat/types.ts";
import {
  buildHostedChatRequestInputFromRuntimeAgentInvocation,
  type HostedChatRequest,
  hostedChatRequestSchema,
} from "./chat-request.ts";
import { RuntimeAgentRunInvocationSchema } from "../runtime/agent-invocation-contract.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

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
  | { success: true }
  | { success: false; error: HostedChatProjectAccessError };

/** Request payload for parsed hosted chat. */
export type ParsedHostedChatRequest = {
  agentId: string | undefined;
  userId: string;
  authToken: string;
  messages: ChatUiMessage[];
  validatedContext: ChatRequestContext;
  projectId: string | null;
  projectSlug?: string;
  conversationId: string | undefined;
  parentRunId: string | undefined;
  upstreamParentConversationId: string | undefined;
  upstreamParentRunId: string | undefined;
  spawnedFromToolCallId: string | undefined;
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
};

async function parseRequestJson(request: Request): Promise<unknown | Response> {
  try {
    return JSON.parse(await readBodyWithLimit(request, DEFAULT_MAX_BODY_SIZE_BYTES));
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      return Response.json(
        {
          errorCode: "REQUEST_TOO_LARGE",
          message: `Request body exceeds ${DEFAULT_MAX_BODY_SIZE_BYTES} bytes`,
        },
        { status: 413 },
      );
    }
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

function getValidationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "validation failed";
}

async function verifyHostedChatProjectAccess(input: {
  projectId: string | null;
  authToken: string;
  verifyProjectAccess?: ParseHostedChatRequestOptions["verifyProjectAccess"];
}): Promise<Response | undefined> {
  if (!input.projectId || !input.verifyProjectAccess) {
    return undefined;
  }

  const access = await input.verifyProjectAccess({
    projectId: input.projectId,
    authToken: input.authToken,
  });
  if (access.success) {
    return undefined;
  }

  return Response.json(
    { errorCode: access.error.errorCode, message: access.error.message },
    { status: access.error.statusCode === 404 ? 404 : 403 },
  );
}

/** Request payload for build parsed hosted chat. */
export async function buildParsedHostedChatRequest(input: {
  chatRequest: HostedChatRequest;
  agentId?: string;
  agentConfig?: RuntimeAgentMarkdownDefinition;
  authToken: string;
  userId: string;
  verifyProjectAccess?: ParseHostedChatRequestOptions["verifyProjectAccess"];
}): Promise<ParsedHostedChatRequest | Response> {
  const {
    messages,
    context: chatContext,
    model,
    allowDelegation,
    forwardedProps,
    runtimeOverrides,
    durableRootRun,
  } = input.chatRequest;
  const projectId = chatContext.projectId;
  const projectSlug = chatContext.projectSlug;
  const conversationId = chatContext.conversationId;

  if (input.agentConfig && input.agentId && input.agentConfig.id !== input.agentId) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid runtime agent invocation",
      validationMessage: "agentConfig.id must match the requested agent id",
    });
  }

  const accessError = await verifyHostedChatProjectAccess({
    projectId,
    authToken: input.authToken,
    verifyProjectAccess: input.verifyProjectAccess,
  });
  if (accessError) {
    return accessError;
  }

  return {
    agentId: input.agentId,
    userId: input.userId,
    authToken: input.authToken,
    messages: messages as ChatUiMessage[],
    validatedContext: chatContext,
    projectId,
    projectSlug,
    conversationId,
    parentRunId: durableRootRun?.runId,
    upstreamParentConversationId: durableRootRun?.parentConversationId,
    upstreamParentRunId: durableRootRun?.parentRunId,
    spawnedFromToolCallId: durableRootRun?.spawnedFromToolCallId,
    model,
    allowDelegation,
    forwardedProps,
    runtimeOverrides,
    durableRootRun,
    persistLatestUserMessageBeforeDurableRun: false,
    ...(input.agentConfig ? { agentConfig: input.agentConfig } : {}),
  };
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

  const requestBody = await parseRequestJson(request);
  if (requestBody instanceof Response) return requestBody;

  const parsed = hostedChatRequestSchema.safeParse(requestBody);
  if (!parsed.success) {
    return createValidationErrorResponse({
      messagePrefix: "Invalid request",
      validationMessage: getValidationErrorMessage(parsed.error),
    });
  }

  return await buildParsedHostedChatRequest({
    authToken: authenticatedRequest.authToken,
    userId: authenticatedRequest.userId,
    chatRequest: parsed.data,
    verifyProjectAccess: options.verifyProjectAccess,
  });
}

/** Request payload for parse runtime agent run invocation hosted chat request from. */
export async function parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
  request: Request,
  options: ParseHostedChatRequestOptions,
): Promise<ParsedHostedChatRequest | Response> {
  const authenticatedRequest = await options.authenticate(request);
  if (authenticatedRequest instanceof Response) {
    return authenticatedRequest;
  }

  const requestBody = await parseRequestJson(request);
  if (requestBody instanceof Response) return requestBody;

  const invocation = RuntimeAgentRunInvocationSchema.safeParse(requestBody);
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

  return await buildParsedHostedChatRequest({
    authToken: authenticatedRequest.authToken,
    userId: invocation.data.run.requestedByUserId,
    chatRequest: chatRequest.data,
    agentId: invocation.data.run.agentId,
    agentConfig: invocation.data.agentConfig,
    verifyProjectAccess: options.verifyProjectAccess,
  });
}

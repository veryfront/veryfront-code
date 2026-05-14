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

export type HostedChatRequestPrincipal = {
  userId: string;
  authToken: string;
};

export type HostedChatProjectAccessError = {
  errorCode: string;
  message: string;
  statusCode: number;
};

export type HostedChatProjectAccessResult =
  | { success: true }
  | { success: false; error: HostedChatProjectAccessError };

export type ParsedHostedChatRequest = {
  agentId: string | undefined;
  userId: string;
  authToken: string;
  messages: ChatUiMessage[];
  validatedContext: ChatRequestContext;
  projectId: string | null;
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
};

export type ParseHostedChatRequestOptions = {
  authenticate: (request: Request) => Promise<HostedChatRequestPrincipal | Response>;
  verifyProjectAccess?: (input: {
    projectId: string;
    authToken: string;
  }) => Promise<HostedChatProjectAccessResult>;
};

async function parseRequestJson(request: Request): Promise<unknown> {
  return await request.json().catch((): null => null);
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

export async function buildParsedHostedChatRequest(input: {
  chatRequest: HostedChatRequest;
  agentId?: string;
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
  const conversationId = chatContext.conversationId;

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
  };
}

export async function parseHostedChatRequestFromRequest(
  request: Request,
  options: ParseHostedChatRequestOptions,
): Promise<ParsedHostedChatRequest | Response> {
  const authenticatedRequest = await options.authenticate(request);
  if (authenticatedRequest instanceof Response) {
    return authenticatedRequest;
  }

  const parsed = hostedChatRequestSchema.safeParse(await parseRequestJson(request));
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

export async function parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(
  request: Request,
  options: ParseHostedChatRequestOptions,
): Promise<ParsedHostedChatRequest | Response> {
  const authenticatedRequest = await options.authenticate(request);
  if (authenticatedRequest instanceof Response) {
    return authenticatedRequest;
  }

  const invocation = RuntimeAgentRunInvocationSchema.safeParse(await parseRequestJson(request));
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
    userId: authenticatedRequest.userId,
    chatRequest: chatRequest.data,
    agentId: invocation.data.run.agentId,
    verifyProjectAccess: options.verifyProjectAccess,
  });
}

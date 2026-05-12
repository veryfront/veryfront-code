import { mapAgUiRuntimeMessagesToChatUiMessages } from "#veryfront/chat/ag-ui.ts";
import type { ChatRequestContext, ChatRuntimeOverrides } from "#veryfront/chat/types.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  createAgUiRuntimeContextMap,
  deriveAgUiForwardedConfig,
  parseAgUiContextBoolean,
  parseAgUiContextNullableString,
  parseAgUiContextSchema,
  parseAgUiContextString,
} from "./ag-ui-forwarded-context.ts";
import type { AgUiRuntimeRequest } from "./runtime-ag-ui-contract.ts";
import { hostedChatRuntimeOverridesSchema } from "./hosted-chat-request.ts";
import type {
  HostedChatProjectAccessResult,
  ParsedHostedChatRequest,
  ParseHostedChatRequestOptions,
} from "./hosted-chat-request-parser.ts";

export const getHostedAgUiChatForwardedConfigSchema = defineSchema((v) =>
  v.object({
    projectId: v.string().nullable().optional(),
    branchId: v.string().nullable().optional(),
    conversationId: v.string().optional(),
    environmentContext: v.string().optional(),
    model: v.string().optional(),
    allowDelegation: v.boolean().optional(),
    runtimeOverrides: hostedChatRuntimeOverridesSchema.optional(),
  })
    .strict()
);

/** @deprecated Use getHostedAgUiChatForwardedConfigSchema() */
export const hostedAgUiChatForwardedConfigSchema = getHostedAgUiChatForwardedConfigSchema();

export type HostedAgUiChatForwardedConfig = InferSchema<
  ReturnType<typeof getHostedAgUiChatForwardedConfigSchema>
>;

export type DerivedHostedAgUiChatContext = {
  validatedContext: ChatRequestContext;
  projectId: string | null;
  conversationId: string | undefined;
  model: string | undefined;
  allowDelegation: boolean | undefined;
  runtimeOverrides: ChatRuntimeOverrides | undefined;
};

export type ParsedHostedAgUiRequest = ParsedHostedChatRequest & {
  agUiInput: AgUiRuntimeRequest;
};

export type BuildParsedHostedAgUiRequestOptions = {
  agUiInput: AgUiRuntimeRequest;
  authToken: string;
  userId: string;
  forwardedConfigNamespace?: string;
  verifyProjectAccess?: ParseHostedChatRequestOptions["verifyProjectAccess"];
};

const getHostedValidationErrorBodySchema = defineSchema((v) =>
  v.object({
    error: v.string().optional(),
    details: v.array(v.object({ message: v.string().optional() }).passthrough()).optional(),
  })
    .passthrough()
);

const hostedValidationErrorBodySchema = getHostedValidationErrorBodySchema();

async function verifyHostedAgUiProjectAccess(input: {
  projectId: string | null;
  authToken: string;
  verifyProjectAccess?: (
    input: { projectId: string; authToken: string },
  ) => Promise<HostedChatProjectAccessResult>;
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

export function deriveHostedAgUiChatContext(
  agUiInput: AgUiRuntimeRequest,
  options: { forwardedConfigNamespace?: string } = {},
): DerivedHostedAgUiChatContext {
  const contextMap = createAgUiRuntimeContextMap(agUiInput);
  const contextNamespace = options.forwardedConfigNamespace ?? "veryfront";
  const forwardedConfig = deriveAgUiForwardedConfig(agUiInput, {
    schema: hostedAgUiChatForwardedConfigSchema,
    namespace: options.forwardedConfigNamespace,
  });

  const projectId = forwardedConfig?.projectId ??
    parseAgUiContextNullableString(contextMap.get(`${contextNamespace}.projectId`)) ?? null;
  const branchId = forwardedConfig?.branchId ??
    parseAgUiContextNullableString(contextMap.get(`${contextNamespace}.branchId`)) ?? null;
  const environmentContext = forwardedConfig?.environmentContext ??
    parseAgUiContextString(contextMap.get(`${contextNamespace}.environmentContext`));
  const conversationId = forwardedConfig?.conversationId ??
    parseAgUiContextString(contextMap.get(`${contextNamespace}.conversationId`));

  const validatedContext: ChatRequestContext = {
    projectId,
    branchId,
    ...(conversationId ? { conversationId } : {}),
    ...(environmentContext ? { environmentContext } : {}),
  };

  return {
    validatedContext,
    projectId,
    conversationId,
    model: forwardedConfig?.model ??
      parseAgUiContextString(contextMap.get(`${contextNamespace}.model`)),
    allowDelegation: forwardedConfig?.allowDelegation ??
      parseAgUiContextBoolean(contextMap.get(`${contextNamespace}.allowDelegation`)),
    runtimeOverrides: forwardedConfig?.runtimeOverrides ??
      parseAgUiContextSchema(
        contextMap.get(`${contextNamespace}.runtimeOverrides`),
        hostedChatRuntimeOverridesSchema,
      ),
  };
}

export async function createHostedAgUiValidationErrorResponse(
  response: Response,
): Promise<Response> {
  const bodyResult = hostedValidationErrorBodySchema.safeParse(
    await response.json().catch((): null => null),
  );
  const body = bodyResult.success ? bodyResult.data : null;

  const detailMessage = body?.details
    ?.map((detail) => detail.message)
    .filter((message): message is string => typeof message === "string")
    .join(", ") ||
    body?.error ||
    "Invalid AG-UI request";

  return Response.json(
    { errorCode: "VALIDATION_ERROR", message: `Invalid AG-UI request: ${detailMessage}` },
    { status: 400 },
  );
}

export async function buildParsedHostedAgUiRequest(
  input: BuildParsedHostedAgUiRequestOptions,
): Promise<ParsedHostedAgUiRequest | Response> {
  const chatContext = deriveHostedAgUiChatContext(input.agUiInput, {
    forwardedConfigNamespace: input.forwardedConfigNamespace,
  });

  const accessError = await verifyHostedAgUiProjectAccess({
    projectId: chatContext.projectId,
    authToken: input.authToken,
    verifyProjectAccess: input.verifyProjectAccess,
  });
  if (accessError) {
    return accessError;
  }

  return {
    agentId: undefined,
    agUiInput: input.agUiInput,
    userId: input.userId,
    authToken: input.authToken,
    messages: mapAgUiRuntimeMessagesToChatUiMessages(input.agUiInput.messages),
    validatedContext: chatContext.validatedContext,
    projectId: chatContext.projectId,
    conversationId: chatContext.conversationId,
    parentRunId: input.agUiInput.parentRunId,
    upstreamParentConversationId: undefined,
    upstreamParentRunId: undefined,
    spawnedFromToolCallId: undefined,
    model: chatContext.model,
    allowDelegation: chatContext.allowDelegation,
    forwardedProps: input.agUiInput.forwardedProps,
    runtimeOverrides: chatContext.runtimeOverrides,
    durableRootRun: undefined,
    persistLatestUserMessageBeforeDurableRun: true,
  };
}

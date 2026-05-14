import {
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelThinking,
} from "#veryfront/provider";
import type { HostedChatRuntimeCreationResult } from "./hosted/chat-runtime-contract.ts";
import {
  type HostedChatExecutionPreparationInput,
  type HostedChatExecutionPreparationResult,
  type HostedChatExecutionPreparationRootRunOptions,
  prepareHostedChatExecution,
} from "./hosted/chat-preparation.ts";
import type { RuntimeAgentThinkingConfig } from "./runtime/agent-definition.ts";

const DEFAULT_PERSIST_LATEST_USER_MESSAGE_OPERATION = "Persist durable root user message";
const DEFAULT_MISSING_USER_MESSAGE_ERROR_MESSAGE = "DURABLE_CHAT_ROOT_REQUIRES_USER_MESSAGE";
const DEFAULT_PERSIST_LATEST_USER_MESSAGE_FAILURE_MESSAGE =
  "Failed to persist user message before durable run setup";

export type VeryfrontCloudHostedChatExecutionPreparationLogger = {
  error: (message: string, metadata?: unknown) => void;
};

export type PrepareVeryfrontCloudHostedChatExecutionInput<
  TRuntimeAgentDefinition extends {
    id: string;
    model?: string;
    thinking?: RuntimeAgentThinkingConfig;
    maxSteps?: number;
  },
  TRuntimeResult extends HostedChatRuntimeCreationResult,
> =
  & Omit<
    HostedChatExecutionPreparationInput<TRuntimeAgentDefinition, TRuntimeResult>,
    "resolveModelId" | "resolveModelThinking" | "rootRun"
  >
  & {
    rootRun?: Partial<HostedChatExecutionPreparationRootRunOptions>;
    logger?: VeryfrontCloudHostedChatExecutionPreparationLogger;
  };

export function createVeryfrontCloudHostedChatExecutionRootRunOptions(input: {
  rootRun?: Partial<HostedChatExecutionPreparationRootRunOptions>;
  logger?: VeryfrontCloudHostedChatExecutionPreparationLogger;
}): HostedChatExecutionPreparationRootRunOptions {
  const rootRun: HostedChatExecutionPreparationRootRunOptions = {
    persistLatestUserMessageOperation: input.rootRun?.persistLatestUserMessageOperation ??
      DEFAULT_PERSIST_LATEST_USER_MESSAGE_OPERATION,
    missingUserMessageErrorMessage: input.rootRun?.missingUserMessageErrorMessage ??
      DEFAULT_MISSING_USER_MESSAGE_ERROR_MESSAGE,
  };

  if (input.rootRun?.implementationKind !== undefined) {
    rootRun.implementationKind = input.rootRun.implementationKind;
  }

  if (input.rootRun?.instrumentation) {
    rootRun.instrumentation = input.rootRun.instrumentation;
  }

  if (input.rootRun?.onPersistLatestUserMessageFailure) {
    rootRun.onPersistLatestUserMessageFailure = input.rootRun.onPersistLatestUserMessageFailure;
  } else if (input.logger) {
    rootRun.onPersistLatestUserMessageFailure = (failure) => {
      input.logger?.error(DEFAULT_PERSIST_LATEST_USER_MESSAGE_FAILURE_MESSAGE, failure);
    };
  }

  return rootRun;
}

export async function prepareVeryfrontCloudHostedChatExecution<
  TRuntimeAgentDefinition extends {
    id: string;
    model?: string;
    thinking?: RuntimeAgentThinkingConfig;
    maxSteps?: number;
  },
  TRuntimeResult extends HostedChatRuntimeCreationResult,
>(
  input: PrepareVeryfrontCloudHostedChatExecutionInput<
    TRuntimeAgentDefinition,
    TRuntimeResult
  >,
): Promise<
  HostedChatExecutionPreparationResult<TRuntimeAgentDefinition, TRuntimeResult>
> {
  const { logger, rootRun, ...preparationInput } = input;

  return await prepareHostedChatExecution({
    ...preparationInput,
    rootRun: createVeryfrontCloudHostedChatExecutionRootRunOptions({
      rootRun,
      logger,
    }),
    resolveModelId: resolveVeryfrontCloudGatewayModelId,
    resolveModelThinking: resolveVeryfrontCloudModelThinking,
  });
}

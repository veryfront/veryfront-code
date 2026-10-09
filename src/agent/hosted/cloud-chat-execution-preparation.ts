import { hasTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { type Tool, toolRegistry } from "#veryfront/tool";
import {
  readOwnDataProperty,
  snapshotOwnDataPropertyArray,
} from "#veryfront/agent/runtime/data-property-descriptor.ts";
import { somePrivateArray } from "#veryfront/security/private-array.ts";
import type { ParsedHostedChatRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";
const getScopedTools = toolRegistry.getAll;
const mapForEach = Map.prototype.forEach;
const apply = Reflect.apply;

import { resolveVeryfrontCloudModelThinking } from "#veryfront/provider";
import {
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudContextAsync,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { loadVeryfrontCloudModelCatalog } from "#veryfront/provider/veryfront-cloud/shared.ts";

/** Longest preparation waits for the served catalog before resolving the model. */
const CATALOG_MAX_WAIT_MS = 3_000;
import { resolveRuntimeModel } from "../runtime/model-resolution.ts";
import type { HostedChatRuntimeCreationResult } from "./chat-runtime-contract.ts";
import {
  type HostedChatExecutionPreparationInput,
  type HostedChatExecutionPreparationResult,
  type HostedChatExecutionPreparationRootRunOptions,
  prepareHostedChatExecution,
} from "./chat-preparation.ts";
import type { RuntimeAgentThinkingConfig } from "../runtime/agent-definition.ts";

const DEFAULT_PERSIST_LATEST_USER_MESSAGE_OPERATION = "Persist durable root user message";
const DEFAULT_MISSING_USER_MESSAGE_ERROR_MESSAGE = "DURABLE_CHAT_ROOT_REQUIRES_USER_MESSAGE";
const DEFAULT_PERSIST_LATEST_USER_MESSAGE_FAILURE_MESSAGE =
  "Failed to persist user message before durable run setup";

/** Public API contract for Veryfront Cloud hosted chat execution preparation logger. */
export type VeryfrontCloudHostedChatExecutionPreparationLogger = {
  error: (message: string, metadata?: unknown) => void;
};

/** Input payload for prepare Veryfront Cloud hosted chat execution. */
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

/** Options accepted by create Veryfront Cloud hosted chat execution root run. */
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

function allowsVerifiedLegacySkillReplay(
  request: ParsedHostedChatRequest,
  agentId: string,
): boolean {
  try {
    if (readOwnDataProperty(request, "serverEnvelopeVerified", "Hosted request", false) !== true) {
      return false;
    }
    const ids = snapshotOwnDataPropertyArray(
      readOwnDataProperty(
        request,
        "serverResolvedTrustedHostedHistoryMessageIds",
        "Hosted request",
        false,
      ),
      { label: "Trusted history IDs", maximumEntries: 10_000, mapValue: (id) => id },
    );
    if (!somePrivateArray(ids, (id) => typeof id === "string" && id.length > 0)) return false;
    let collision = false;
    apply(mapForEach, apply(getScopedTools, toolRegistry, []), [(definition: Tool, id: string) => {
      if (hasTrustedHostToolProvenance(definition)) return;
      const owner = readOwnDataProperty(definition, "ownerAgentId", "Project tool", false);
      if (owner !== undefined && owner !== agentId) return;
      const shortName = readOwnDataProperty(definition, "shortName", "Project tool", false);
      if (id === "load_skill" || id === `${agentId}--load_skill` || shortName === "load_skill") {
        collision = true;
      }
    }]);
    return !collision;
  } catch {
    return false;
  }
}

/** Prepare Veryfront Cloud hosted chat execution. */
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
  const cloudContext = {
    apiBaseUrl: String(input.apiUrl),
    apiToken: input.request.authToken,
    projectSlug: input.request.projectSlug,
    serviceLayer: "cloud" as const,
  };
  // Model ids and thinking defaults resolve against the served catalog, loaded
  // and read under the request's own credentials and project.
  await runWithVeryfrontCloudContextAsync(
    cloudContext,
    () => loadVeryfrontCloudModelCatalog({ maxWaitMs: CATALOG_MAX_WAIT_MS }),
  );
  const resolveModelId = (modelId: string | undefined): string | undefined =>
    runWithVeryfrontCloudContext(
      cloudContext,
      () => modelId === undefined ? undefined : resolveRuntimeModel(modelId),
    );
  const resolveModelThinking: typeof resolveVeryfrontCloudModelThinking = (modelId) =>
    runWithVeryfrontCloudContext(cloudContext, () => resolveVeryfrontCloudModelThinking(modelId));

  return await prepareHostedChatExecution({
    ...preparationInput,
    legacyLoadSkillReplayAllowed: input.legacyLoadSkillReplayAllowed !== false &&
      allowsVerifiedLegacySkillReplay(input.request, input.agentConfig.id),
    rootRun: createVeryfrontCloudHostedChatExecutionRootRunOptions({
      rootRun,
      logger,
    }),
    resolveModelId,
    resolveModelThinking,
  });
}

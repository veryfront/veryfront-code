import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { compactForStep, estimateOverhead } from "../../chat/message-prep.ts";
import { AGENT_ERROR } from "#veryfront/errors";
import type { AgentSystem } from "#veryfront/agent/types.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type { ProviderModelMessage } from "../../chat/types.ts";
import {
  type AgentRuntimeMessagePart,
  convertAgentRuntimeMessagesToProviderMessages,
  convertProviderMessagesToAgentRuntimeMessages,
  getAgentRuntimeReasoningPart,
  getAgentRuntimeTextPart,
  getAgentRuntimeToolCallPart,
  getAgentRuntimeToolResultPart,
} from "../runtime/message-adapter.ts";
import { flattenSystemInstructions } from "../runtime/tool-inventory.ts";
import { cloneRuntimeStateMutableData } from "../runtime/index.ts";
import { canIdentifyProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type { Message as AgentMessage, MessagePart } from "../schemas/index.ts";
import { isToolResultPart } from "../runtime/tool-result-part.ts";
import {
  extractSkillId,
  getSkillActivationResult,
  hasTrustedPlatformPolicyToolResultPart,
  inheritTrustedPlatformPolicyToolResultPart,
  snapshotTrustedSkillLoadResults,
} from "../runtime/skill-policy-enforcement.ts";
import { withProviderModelMessageSourceId } from "#veryfront/chat/conversation.ts";
import { validateRuntimeSkillBootstrapResult } from "../runtime/skill-bootstrap.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

/** Public API contract for hosted child fork runtime step system resolver. */
export type HostedChildForkRuntimeStepSystemResolver = (input: {
  /** Flattened system text retained for compatibility with existing resolvers. */
  system: string;
  /** Structured system messages when provider metadata is available. */
  structuredSystem?: readonly ChatSystemMessage[];
  compactedMessages: readonly ProviderModelMessage[];
}) => AgentSystem | null | undefined;

/** Input payload for prepare hosted child fork runtime step messages. */
export type PrepareHostedChildForkRuntimeStepMessagesInput = {
  messages: AgentMessage[];
  buildInstructions: () => AgentSystem;
  forkToolNames: readonly string[];
  /** Canonical target startup skill whose trusted bounded root must remain intact. */
  bootstrapSkill?: string;
  /** Provider-options key used by the child model runtime. */
  providerOptionKey?: string;
  resolveSystem?: HostedChildForkRuntimeStepSystemResolver;
  /**
   * Tool names that are always present. Required when `getActivatedToolNames`
   * is supplied.
   *
   * @deprecated No framework path supplies this. Retained because
   * `PrepareHostedChildForkRuntimeStepMessagesInput` is public API.
   */
  pinnedToolNames?: readonly string[];
  /**
   * Returns the currently activated tool names. The result is merged with
   * `pinnedToolNames` and returned as `forkToolNames`, letting a caller refresh
   * the exposed tool set per step without mutating its own fixed array.
   *
   * @deprecated Use `tool_search` deferred loading. See
   * `docs/architecture/28-model-driven-tool-discovery.md`.
   */
  getActivatedToolNames?: () => readonly string[];
};

/** Public API contract for hosted child fork runtime step messages. */
export type HostedChildForkRuntimeStepMessages = {
  messages: AgentMessage[];
  system: AgentSystem;
  /**
   * The live `pinned + activated` set for this step. Present only when
   * `getActivatedToolNames` was supplied; callers otherwise keep their own
   * fixed `forkToolNames`.
   */
  forkToolNames?: readonly string[];
};

/** Clone structured child instructions before exposing them to a resolver. */
export function cloneHostedChildForkRuntimeStepSystem(
  system: ChatSystemMessage[],
  providerOptionKey: string | undefined,
  proxyDetectionAvailable = canIdentifyProxyWithoutHooks,
): ChatSystemMessage[] {
  return cloneRuntimeStateMutableData(system, proxyDetectionAvailable, providerOptionKey);
}

function convertAgentRuntimePartToChildForkMessagePart(
  part: AgentRuntimeMessagePart,
): MessagePart {
  const textPart = getAgentRuntimeTextPart(part);
  if (textPart) {
    return textPart;
  }

  const reasoningPart = getAgentRuntimeReasoningPart(part);
  if (reasoningPart) {
    return reasoningPart;
  }

  const toolResultPart = getAgentRuntimeToolResultPart(part);
  if (toolResultPart) {
    // This adapter consumes one provider-owned output envelope. Its value may
    // itself be an ordinary user object with a similarly shaped type/value.
    let result = toolResultPart.output;
    if (typeof result === "object" && result !== null && "type" in result && "value" in result) {
      if (result.type === "json" || result.type === "text") {
        result = result.value;
      } else if (result.type === "error-text") {
        result = { error: result.value };
      }
    }
    return {
      type: "tool-result",
      toolCallId: toolResultPart.toolCallId,
      toolName: toolResultPart.toolName,
      result,
    };
  }

  const toolCallPart = getAgentRuntimeToolCallPart(part);
  if (toolCallPart) {
    return {
      type: `tool-${toolCallPart.toolName}`,
      toolCallId: toolCallPart.toolCallId,
      toolName: toolCallPart.toolName,
      args: toolCallPart.input,
    };
  }

  if (
    (part.type === "image" || part.type === "file") &&
    "mediaType" in part &&
    typeof part.mediaType === "string"
  ) {
    // Image/file parts have no equivalent in the child-fork AgentMessage schema.
    return { type: "text", text: `[file: ${part.mediaType}]` };
  }

  throw AGENT_ERROR.create({
    detail: `Unhandled AgentRuntimeMessagePart type: ${String(part.type)}`,
  });
}

/** Convert compacted provider messages to child fork runtime messages. */
export function convertCompactedProviderMessagesToChildForkRuntimeMessages(
  compactedMessages: readonly ProviderModelMessage[],
): AgentMessage[] {
  return convertProviderMessagesToAgentRuntimeMessages(compactedMessages).map((message) => ({
    id: message.id,
    role: message.role,
    parts: message.parts.map(convertAgentRuntimePartToChildForkMessagePart),
    timestamp: message.timestamp,
  }));
}

function getStartupCalls(messages: readonly AgentMessage[], toolCallId: string) {
  return messages.flatMap((message) =>
    message.role !== "assistant" ? [] : message.parts.flatMap((part) => {
      if (isToolResultPart(part)) return [];
      const call = getAgentRuntimeToolCallPart(part);
      return call && call.toolCallId === toolCallId ? [call] : [];
    })
  );
}

/** Snapshot only the original authenticated, bounded startup call/result. */
function snapshotHostedChildStartupHistory(
  messages: readonly AgentMessage[],
  bootstrapSkill?: string,
) {
  const trustedLoads = snapshotTrustedSkillLoadResults(messages);
  const bootstrap = bootstrapSkill === undefined
    ? undefined
    : trustedLoads.find((result) => extractSkillId(result.result) === bootstrapSkill);
  if (bootstrap && bootstrapSkill !== undefined) {
    validateRuntimeSkillBootstrapResult(getSkillActivationResult(bootstrap.result), bootstrapSkill);
  }
  const originalCalls = bootstrap ? getStartupCalls(messages, bootstrap.toolCallId) : [];
  if (
    bootstrap && (originalCalls.length !== 1 || originalCalls[0]?.toolName !== bootstrap.toolName)
  ) {
    throw AGENT_ERROR.create({ detail: "Startup skill requires its unique original load call" });
  }
  return {
    trustedLoads,
    bootstrap,
    originalCalls,
    preservedId: bootstrap ? `startup:${bootstrap.toolCallId}` : undefined,
  };
}

/** Preserve provenance only on matching clones and reject a damaged startup pair. */
function retainHostedChildSkillHistory(
  startup: ReturnType<typeof snapshotHostedChildStartupHistory>,
  sourceMessages: readonly AgentMessage[],
  messages: AgentMessage[],
): void {
  const { bootstrap } = startup;
  const trustedResultIds = new Set(
    startup.trustedLoads.map((result) => result.toolCallId),
  );
  const sources = new Map(
    sourceMessages.flatMap((message) =>
      message.parts.flatMap((part) =>
        isToolResultPart(part) && trustedResultIds.has(part.toolCallId)
          ? [[part.toolCallId, part] as const]
          : []
      )
    ),
  );
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolResultPart(part)) continue;
      const source = sources.get(part.toolCallId);
      if (source) inheritTrustedPlatformPolicyToolResultPart(source, part);
    }
  }
  if (
    bootstrap &&
    (privateJsonStringify(getStartupCalls(messages, bootstrap.toolCallId)) !==
        privateJsonStringify(startup.originalCalls) ||
      !messages.some((message) =>
        message.parts.some((part) =>
          isToolResultPart(part) && part.toolCallId === bootstrap.toolCallId &&
          hasTrustedPlatformPolicyToolResultPart(part)
        )
      ))
  ) {
    throw AGENT_ERROR.create({ detail: "Startup skill exceeds the prepared context budget" });
  }
}

/** Prepare hosted child fork runtime step messages. */
export function prepareHostedChildForkRuntimeStepMessages(
  input: PrepareHostedChildForkRuntimeStepMessagesInput,
): HostedChildForkRuntimeStepMessages {
  const currentInstructions = input.buildInstructions();
  const flattenedInstructions = typeof currentInstructions === "string"
    ? currentInstructions
    : flattenSystemInstructions(currentInstructions);
  // `convertAgentRuntimeMessagesToProviderMessages` reads each part defensively
  // (via `"result" in part` / accessor helpers), so an AgentMessage is a valid
  // runtime input. The only gap is a schema-inference nuance: the `tool-result`
  // part's `result` is inferred optional from `v.unknown()`, while the
  // converter's parameter type declares it required. Narrow to the converter's
  // own parameter element type rather than `any` to keep the call type-checked.
  type ConvertibleMessage = Parameters<
    typeof convertAgentRuntimeMessagesToProviderMessages
  >[0][number];
  const startup = snapshotHostedChildStartupHistory(input.messages, input.bootstrapSkill);
  const { bootstrap, preservedId } = startup;
  const providerMessages = convertAgentRuntimeMessagesToProviderMessages(
    input.messages as readonly ConvertibleMessage[],
  ).map((message) =>
    preservedId && bootstrap && Array.isArray(message.content) &&
      message.content.some((part) =>
        "toolCallId" in part && part.toolCallId === bootstrap.toolCallId
      )
      ? withProviderModelMessageSourceId(message, preservedId)
      : message
  );
  let compactedMessages = compactForStep(
    providerMessages,
    estimateOverhead(flattenedInstructions, input.forkToolNames.length),
    {
      historicalToolInputRetention: { preserveSourceMessageIds: preservedId ? [preservedId] : [] },
      requireBudgetFit: input.bootstrapSkill !== undefined,
    },
  );
  const resolvedSystem = input.resolveSystem?.({
    system: flattenedInstructions,
    ...(typeof currentInstructions === "string" ? {} : {
      structuredSystem: cloneHostedChildForkRuntimeStepSystem(
        currentInstructions,
        input.providerOptionKey,
      ),
    }),
    compactedMessages,
  });

  const finalSystem = resolvedSystem ?? currentInstructions;
  if (resolvedSystem != null && input.bootstrapSkill !== undefined) {
    compactedMessages = compactForStep(
      compactedMessages,
      estimateOverhead(
        typeof finalSystem === "string" ? finalSystem : flattenSystemInstructions(finalSystem),
        input.forkToolNames.length,
      ),
      {
        historicalToolInputRetention: {
          preserveSourceMessageIds: preservedId ? [preservedId] : [],
        },
        requireBudgetFit: true,
      },
    );
  }
  const liveForkToolNames = input.getActivatedToolNames
    ? [
      ...new Set([
        ...(input.pinnedToolNames ?? []),
        ...input.getActivatedToolNames(),
      ]),
    ].sort(compareStrings)
    : undefined;

  const messages = convertCompactedProviderMessagesToChildForkRuntimeMessages(compactedMessages);
  retainHostedChildSkillHistory(startup, input.messages, messages);
  return {
    messages,
    system: finalSystem,
    ...(liveForkToolNames !== undefined ? { forkToolNames: liveForkToolNames } : {}),
  };
}

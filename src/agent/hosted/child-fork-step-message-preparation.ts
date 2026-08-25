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
    return {
      type: "tool-result",
      toolCallId: toolResultPart.toolCallId,
      toolName: toolResultPart.toolName,
      result: toolResultPart.output,
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
  const compactedMessages = compactForStep(
    convertAgentRuntimeMessagesToProviderMessages(
      input.messages as readonly ConvertibleMessage[],
    ),
    estimateOverhead(flattenedInstructions, input.forkToolNames.length),
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

  const liveForkToolNames = input.getActivatedToolNames
    ? [
      ...new Set([
        ...(input.pinnedToolNames ?? []),
        ...input.getActivatedToolNames(),
      ]),
    ].sort()
    : undefined;

  return {
    messages: convertCompactedProviderMessagesToChildForkRuntimeMessages(compactedMessages),
    system: resolvedSystem ?? currentInstructions,
    ...(liveForkToolNames !== undefined ? { forkToolNames: liveForkToolNames } : {}),
  };
}

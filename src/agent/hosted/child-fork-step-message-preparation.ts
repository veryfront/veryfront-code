import { compactForStep, estimateOverhead } from "../../chat/message-prep.ts";
import { AGENT_ERROR } from "#veryfront/errors";
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
import type { Message as AgentMessage, MessagePart } from "../schemas/index.ts";

/** Public API contract for hosted child fork runtime step system resolver. */
export type HostedChildForkRuntimeStepSystemResolver = (input: {
  system: string;
  compactedMessages: readonly ProviderModelMessage[];
}) => string | null | undefined;

/** Input payload for prepare hosted child fork runtime step messages. */
export type PrepareHostedChildForkRuntimeStepMessagesInput = {
  messages: AgentMessage[];
  buildInstructions: () => string;
  forkToolNames: readonly string[];
  resolveSystem?: HostedChildForkRuntimeStepSystemResolver;
};

/** Public API contract for hosted child fork runtime step messages. */
export type HostedChildForkRuntimeStepMessages = {
  messages: AgentMessage[];
  system: string;
};

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

  throw AGENT_ERROR.create({ detail: `Unhandled AgentRuntimeMessagePart type: ${String(part.type)}` });
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
    estimateOverhead(currentInstructions, input.forkToolNames.length),
  );
  const resolvedSystem = input.resolveSystem?.({
    system: currentInstructions,
    compactedMessages,
  });

  return {
    messages: convertCompactedProviderMessagesToChildForkRuntimeMessages(compactedMessages),
    system: typeof resolvedSystem === "string" ? resolvedSystem : currentInstructions,
  };
}

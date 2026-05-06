import { compactForStep, estimateOverhead } from "../chat/message-prep.ts";
import type { ProviderModelMessage } from "../chat/types.ts";
import {
  type AgentRuntimeMessagePart,
  convertAgentRuntimeMessagesToProviderMessages,
  convertProviderMessagesToAgentRuntimeMessages,
} from "./agent-runtime-message-adapter.ts";
import type { Message as AgentMessage, MessagePart } from "./schemas/index.ts";

export type HostedChildForkRuntimeStepSystemResolver = (input: {
  system: string;
  compactedMessages: readonly ProviderModelMessage[];
}) => string | null | undefined;

export type PrepareHostedChildForkRuntimeStepMessagesInput = {
  messages: AgentMessage[];
  buildInstructions: () => string;
  forkToolNames: readonly string[];
  resolveSystem?: HostedChildForkRuntimeStepSystemResolver;
};

export type HostedChildForkRuntimeStepMessages = {
  messages: AgentMessage[];
  system: string;
};

function convertAgentRuntimePartToChildForkMessagePart(
  part: AgentRuntimeMessagePart,
): MessagePart {
  if ("text" in part) {
    return {
      type: "text",
      text: part.text,
    };
  }

  if ("result" in part) {
    return {
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      result: part.result,
    };
  }

  return {
    type: `tool-${part.toolName}`,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    args: part.args,
  };
}

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

export function prepareHostedChildForkRuntimeStepMessages(
  input: PrepareHostedChildForkRuntimeStepMessagesInput,
): HostedChildForkRuntimeStepMessages {
  const currentInstructions = input.buildInstructions();
  const compactedMessages = compactForStep(
    convertAgentRuntimeMessagesToProviderMessages(input.messages),
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

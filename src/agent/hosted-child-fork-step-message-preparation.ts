import { compactForStep, estimateOverhead } from "../chat/message-prep.ts";
import type { ProviderModelMessage } from "../chat/types.ts";
import {
  type AgentRuntimeMessage,
  convertAgentRuntimeMessagesToProviderMessages,
  convertProviderMessagesToAgentRuntimeMessages,
} from "./agent-runtime-message-adapter.ts";

export type HostedChildForkRuntimeStepSystemResolver = (input: {
  system: string;
  compactedMessages: readonly ProviderModelMessage[];
}) => string | null | undefined;

export type PrepareHostedChildForkRuntimeStepMessagesInput = {
  messages: AgentRuntimeMessage[];
  buildInstructions: () => string;
  forkToolNames: readonly string[];
  resolveSystem?: HostedChildForkRuntimeStepSystemResolver;
};

export type HostedChildForkRuntimeStepMessages = {
  messages: AgentRuntimeMessage[];
  system: string;
};

export function convertCompactedProviderMessagesToChildForkRuntimeMessages(
  compactedMessages: readonly ProviderModelMessage[],
): AgentRuntimeMessage[] {
  return convertProviderMessagesToAgentRuntimeMessages(compactedMessages).map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "tool-call") {
        return part;
      }

      return {
        ...part,
        type: `tool-${part.toolName}`,
      };
    }),
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

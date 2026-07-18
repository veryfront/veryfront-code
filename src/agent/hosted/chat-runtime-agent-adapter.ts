import type { ToolExecutionDataEvent } from "#veryfront/tool/types.ts";
import { AGENT_ERROR } from "#veryfront/errors";
import { createChatUiMessageStreamFromDataStream } from "../streaming/chat-ui-message-stream.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeStreamResult,
} from "./chat-runtime-contract.ts";
import { createToolExecutionDataEventBridgeStream } from "../streaming/tool-execution-data-event-bridge.ts";
import type { Agent } from "../types.ts";

/** Public API contract for hosted chat runtime agent adapter runner. */
export type HostedChatRuntimeAgentAdapterRunner = <TResult>(
  operation: () => Promise<TResult>,
) => Promise<TResult>;

/** Public API contract for hosted chat runtime agent adapter warning. */
export type HostedChatRuntimeAgentAdapterWarning = {
  toolCallId: string;
  inputPreview: string;
};

/** Input payload for hosted chat runtime agent adapter. */
export type HostedChatRuntimeAgentAdapterInput = {
  runtimeAgent: Pick<Agent, "stream">;
  runId?: string;
  agentId?: string;
  authToken?: string;
  runStream?: HostedChatRuntimeAgentAdapterRunner;
  warnOrphanedToolInput?: (
    message: string,
    metadata: HostedChatRuntimeAgentAdapterWarning,
  ) => void;
};

function previewToolInput(inputText: string): string {
  return inputText.length > 500 ? `${inputText.slice(0, 500)}...` : inputText;
}

/** Create hosted chat runtime agent adapter. */
export function createHostedChatRuntimeAgentAdapter(
  input: HostedChatRuntimeAgentAdapterInput,
): HostedChatRuntimeAgent {
  const runStream = input.runStream ?? ((operation) => operation());

  return {
    stream: async (streamInput): Promise<HostedChatRuntimeStreamResult> => {
      let publishDataEvent = (_event: ToolExecutionDataEvent) => {};
      const response = await runStream(() =>
        input.runtimeAgent.stream({
          messages: streamInput.messages,
          context: {
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.agentId ? { agentId: input.agentId } : {}),
            ...(input.authToken ? { authToken: input.authToken } : {}),
            abortSignal: streamInput.abortSignal,
            publishDataEvent: (event: ToolExecutionDataEvent) => publishDataEvent(event),
          },
        })
      );

      const streamResponse = response.toDataStreamResponse();
      if (!streamResponse.body) {
        throw AGENT_ERROR.create({ detail: "Agent runtime returned an empty stream body" });
      }

      const stream = createToolExecutionDataEventBridgeStream({
        baseStream: streamResponse.body,
        installPublisher: (nextPublishDataEvent) => {
          publishDataEvent = nextPublishDataEvent;
        },
      });

      return {
        steps: Promise.resolve([]),
        toUIMessageStream(options = {}) {
          return createChatUiMessageStreamFromDataStream(
            { stream },
            {
              generateMessageId: options.generateMessageId,
              sendReasoning: options.sendReasoning,
              onError: options.onError,
              messageMetadata: options.messageMetadata,
              onFinish: options.onFinish,
              onOrphanedToolInput: ({ toolCallId, inputText }) => {
                input.warnOrphanedToolInput?.(
                  "Dropping orphan AG-UI runtime tool-input-delta stream without a matching lifecycle",
                  {
                    toolCallId,
                    inputPreview: previewToolInput(inputText),
                  },
                );
              },
            },
          );
        },
      };
    },
  };
}

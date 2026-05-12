import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeFinishPart,
  HostedChatRuntimeOnFinishEvent,
  HostedChatRuntimeStreamInput,
  HostedChatRuntimeStreamResult,
  HostedChatRuntimeToUiMessageStreamOptions,
} from "./hosted-chat-runtime-contract.ts";

Deno.test("HostedChatRuntimeAgent describes a streamable hosted chat runtime", async () => {
  let streamInput: HostedChatRuntimeStreamInput | undefined;
  let streamOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;
  const streamResult: HostedChatRuntimeStreamResult = {
    steps: Promise.resolve([]),
    toUIMessageStream: (options) => {
      streamOptions = options;
      return (async function* streamChunks() {})();
    },
  };
  const agent: HostedChatRuntimeAgent = {
    stream: (input) => {
      streamInput = input;
      return Promise.resolve(streamResult);
    },
  };
  const abortController = new AbortController();

  const result = await agent.stream({
    messages: [
      { id: "msg-1", role: "user", parts: [{ type: "text", text: "Hello" }], timestamp: 1 },
    ],
    abortSignal: abortController.signal,
  });
  const chunks = result.toUIMessageStream({ sendReasoning: true });

  assertEquals(streamInput?.messages[0]?.id, "msg-1");
  assertEquals(streamInput?.abortSignal, abortController.signal);
  assertEquals(streamOptions?.sendReasoning, true);
  const receivedChunks = [];
  for await (const chunk of chunks) {
    receivedChunks.push(chunk);
  }
  assertEquals(receivedChunks, []);
});

Deno.test("HostedChatRuntimeToUiMessageStreamOptions accepts finish metadata callbacks", () => {
  const finishPart: HostedChatRuntimeFinishPart = {
    type: "finish",
    finishReason: "stop",
    rawFinishReason: "provider-stop",
    totalUsage: {
      inputTokens: 3,
      outputTokens: 5,
      totalTokens: 8,
      reasoningTokens: 1,
      cachedInputTokens: 2,
      inputTokenDetails: { cacheReadTokens: 2 },
      outputTokenDetails: { reasoningTokens: 1 },
    },
  };
  let finishEvent: HostedChatRuntimeOnFinishEvent<{ finishReason: string }> | undefined;
  const options: HostedChatRuntimeToUiMessageStreamOptions<{ finishReason: string }> = {
    messageMetadata: ({ part }) => ({ finishReason: part.finishReason }),
    onFinish: (event) => {
      finishEvent = event;
    },
  };

  const metadata = options.messageMetadata?.({ part: finishPart });
  options.onFinish?.({
    messages: [],
    isContinuation: false,
    responseMessage: { id: "response", role: "assistant", parts: [] },
    isAborted: false,
    finishReason: "stop",
  });

  assertEquals(metadata, { finishReason: "stop" });
  assertEquals(finishEvent?.responseMessage.id, "response");
});

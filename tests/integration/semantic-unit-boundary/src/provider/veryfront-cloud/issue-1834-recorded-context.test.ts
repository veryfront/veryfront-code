import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, it } from "#veryfront/testing/bdd.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { deleteEnv, setEnv } from "#veryfront/compat/process.ts";
import { clearModelProviders } from "#veryfront/provider";
import { createVeryfrontCloudModel } from "../../../../../../src/provider/veryfront-cloud/provider.ts";
import {
  issue1834CapturedEmptyVertexSse,
  issue1834RecordedMessages,
  issue1834RecordedRequest,
  issue1834RecordedTools,
} from "./issue-1834-recorded-context.fixture.ts";

async function drain(stream: ReadableStream<unknown>): Promise<unknown[]> {
  return await Array.fromAsync(stream);
}

afterEach(() => {
  restoreMockFetch();
  clearModelProviders();
  deleteEnv("VERYFRONT_API_TOKEN");
  deleteEnv("VERYFRONT_PROJECT_SLUG");
});

it("converts the sanitized issue 1834 context into a valid Mistral gateway ingress request", async () => {
  setEnv("VERYFRONT_API_TOKEN", "vf_test_issue_1834");
  setEnv("VERYFRONT_PROJECT_SLUG", "issue-1834-project");
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  installMockFetch(async (input, init) => {
    const request = new Request(input, init);
    capturedUrl = request.url;
    capturedBody = await request.json();
    return new Response(
      issue1834CapturedEmptyVertexSse,
      { headers: { "content-type": "text/event-stream" } },
    );
  });

  const model = createVeryfrontCloudModel("mistral/mistral-small-2503");
  const result = await model.doStream({
    prompt: issue1834RecordedMessages,
    tools: issue1834RecordedTools,
    ...issue1834RecordedRequest,
  });
  const parts = await drain(result.stream);

  assertEquals(
    capturedUrl,
    "https://api.veryfront.com/ai/gateway/mistral/v1/chat/completions",
  );
  assertEquals(capturedBody.model, "mistral-small-2503");
  assertEquals(capturedBody.temperature, 0);
  assertEquals(capturedBody.max_tokens, 16_384);
  assertEquals(capturedBody.max_completion_tokens, undefined);
  assertEquals(capturedBody.stream, true);
  // This is the framework-to-gateway contract. Production routes this model
  // through Google Vertex partner Mistral, where the gateway preserves the
  // Mistral body but removes stream_options before streamRawPredict.
  assertEquals(capturedBody.stream_options, { include_usage: true });

  const messages = capturedBody.messages as Array<Record<string, unknown>>;
  assertEquals(messages.map((message) => message.role), [
    "system",
    "system",
    "system",
    "system",
    "user",
    "assistant",
    "tool",
    "tool",
    "assistant",
    "user",
    "assistant",
    "tool",
  ]);
  const assistantCalls = messages.flatMap((message) =>
    (message.tool_calls as Array<{ id: string; function: { name: string } }> | undefined) ?? []
  );
  const toolResultIds = messages.flatMap((message) =>
    message.role === "tool" ? [String(message.tool_call_id)] : []
  );
  assertEquals(assistantCalls.map((call) => [call.id, call.function.name]), [
    ["search001", "tool_search"],
    ["read00001", "get_file"],
    ["search002", "tool_search"],
  ]);
  assertEquals(toolResultIds, ["search001", "read00001", "search002"]);
  const omittedReadResult = messages.find((message) =>
    message.role === "tool" && message.tool_call_id === "read00001"
  );
  assertEquals(JSON.parse(String(omittedReadResult?.content)), {
    type: "text",
    value: "[File read: src/example.ts - content omitted (6400 chars)]",
  });

  const tools = capturedBody.tools as Array<{ function: { name: string }; type: string }>;
  assertEquals(
    tools,
    issue1834RecordedTools.map((entry) => ({
      type: "function",
      function: {
        name: entry.name,
        description: entry.description,
        parameters: entry.inputSchema,
      },
    })),
  );
  assertEquals(tools.some((entry) => entry.function.name === "get_file"), false);
  assertEquals(parts.some((part) => (part as { type?: unknown }).type === "text-delta"), false);
  assertEquals(parts.at(-1), {
    type: "finish",
    finishReason: "stop",
    usage: { inputTokens: 6505, outputTokens: 0, totalTokens: 6505 },
  });
});

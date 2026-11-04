import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { loadRemoteToolsFromSource } from "#veryfront/tool";
import { agent } from "../factory.ts";

function createToolCallingModel(toolNames: string[]): ModelRuntime<ModelRuntimeCallOptions> {
  let call = 0;
  return {
    provider: "test",
    modelId: "test/remote-dynamic",
    executionMode: "remote",
    doGenerate() {
      throw new Error("not used");
    },
    doStream() {
      call++;
      const parts: unknown[] = call === 1
        ? [
          ...toolNames.map((toolName, index) => ({
            type: "tool-call",
            toolCallId: `call-${index}`,
            toolName,
            input: {},
          })),
          {
            type: "finish",
            finishReason: "tool-calls",
            totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ]
        : [
          { type: "text-delta", text: "Done." },
          {
            type: "finish",
            finishReason: "stop",
            totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ];
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      });
    },
  };
}

describe("remote-source tools in agent streams", () => {
  it("flags integration-named remote tools as dynamic like other remote tools", async () => {
    const remoteTools = await loadRemoteToolsFromSource({
      id: "local-outlook-dynamic",
      listTools: () =>
        Promise.resolve([
          { name: "outlook__list_emails", description: "List emails", parameters: {} },
          { name: "remote_dynamic_search_docs", description: "Search docs", parameters: {} },
        ]),
      executeTool: () => Promise.resolve({ ok: true }),
    });
    const toolNames = ["outlook__list_emails", "remote_dynamic_search_docs"];
    const assistant = agent({
      id: "remote-source-dynamic-flag",
      system: "Test.",
      tools: remoteTools,
      maxSteps: 2,
      resolveModelTransport: () => Promise.resolve({ model: createToolCallingModel(toolNames) }),
    });

    const result = await assistant.stream({ input: "List my emails." });
    const body = await result.toDataStreamResponse().text();
    const toolEvents = body.split("\n")
      .filter((line) => line.startsWith("data: {"))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>)
      .filter((event) =>
        typeof event.type === "string" && event.type.startsWith("tool-") &&
        typeof event.toolCallId === "string"
      );

    for (const [index, toolName] of toolNames.entries()) {
      const events = toolEvents.filter((event) => event.toolCallId === `call-${index}`);
      assertEquals(
        events.map((event) => event.type).includes("tool-output-available"),
        true,
        toolName,
      );
      assertEquals(
        events.map((event) => [event.type, event.dynamic]),
        events.map((event) => [
          event.type,
          true,
        ]),
      );
    }
  });
});

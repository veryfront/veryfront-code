import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Agent } from "#veryfront/agent";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

describe("internal-agents/run-stream", () => {
  it("filters unavailable boolean source tool declarations before constructing the runtime", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedToolNames: string[] = [];

    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          cancel_job: true,
          create_file: true,
          web_search: true,
          gmail__list_emails: true,
        },
      },
    } as unknown as Agent;

    const input = {
      agentId: "test",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [
        {
          name: "web_search",
          description: "Search the web",
          parameters: { type: "object", properties: {} },
        },
      ],
      context: [],
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["create_file", "gmail__list_emails"],
          integrationToolDefinitions: [
            {
              name: "gmail__list_emails",
              description: "List emails",
              parameters: { type: "object", properties: {} },
            },
          ],
        },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: (_agent, mergedTools) => {
          capturedToolNames = Object.keys(mergedTools ?? {}).sort();
          return {
            stream: async () =>
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              }),
          };
        },
      },
    );

    assertEquals(capturedToolNames, ["gmail__list_emails", "web_search"]);
  });
});

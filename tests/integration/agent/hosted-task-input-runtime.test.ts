import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { clearModelProviders, registerModelProvider } from "#veryfront/provider";
import type { ToolExecutionContext } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/define.ts";
import { createDefaultHostedChatRuntime } from "#veryfront/agent/hosted/default-chat-runtime.ts";

it("delivers immutable host task input to an actual hosted tool across reconstruction", async () => {
  const scope = { projectId: "project-a", rootRunId: "root-a", runId: "child-a" };
  const binding = { version: 1 as const, ...scope, payload: { intakeId: "intake-a" } };
  await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
    for (const taskInput of [binding, JSON.parse(JSON.stringify(binding)), undefined]) {
      let steps = 0;
      clearModelProviders();
      registerModelProvider("test", () => ({
        provider: "test",
        modelId: "test/binding",
        runtimeCapabilities: { toolCalling: true },
        doGenerate: () => Promise.reject(new Error("Unexpected generation")),
        doStream: () => {
          steps++;
          return Promise.resolve({
            stream: new ReadableStream({
              start(c) {
                if (steps === 1) {
                  c.enqueue({ type: "tool-input-start", id: "probe", toolName: "inspect_binding" });
                  c.enqueue({ type: "tool-input-delta", id: "probe", delta: "{}" });
                  c.enqueue({
                    type: "tool-call",
                    toolCallId: "probe",
                    toolName: "inspect_binding",
                    input: "{}",
                  });
                  c.enqueue({
                    type: "finish",
                    finishReason: "tool-calls",
                    usage: { inputTokens: 1, outputTokens: 1 },
                  });
                } else {
                  c.enqueue({ type: "text-delta", text: "done" });
                  c.enqueue({
                    type: "finish",
                    finishReason: "stop",
                    usage: { inputTokens: 1, outputTokens: 1 },
                  });
                }
                c.close();
              },
            }),
          });
        },
      }));
      const runtime = await createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
        options: {
          ...scope,
          taskInput,
          authToken: "host-token",
          agentId: "child-agent",
          instructions: "Synthetic control",
          model: "test/binding",
          maxSteps: 2,
          allowedTools: ["inspect_binding"],
        },
        config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
        buildLocalTools: () => ({
          inspect_binding: {
            id: "inspect_binding",
            type: "function",
            description: "Inspect host task binding",
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: (_args: unknown, context: ToolExecutionContext = {}) => ({
              taskInput: context.taskInput ?? null,
              frozen: taskInput === undefined || Object.isFrozen(context.taskInput),
              projectId: context.projectId,
              runId: context.runId,
            }),
          },
        }),
        createRemoteToolSource: (config) => ({
          id: config.id ?? "probe",
          listTools: () => Promise.resolve([]),
          executeTool: () => Promise.reject(new Error("Unexpected remote tool")),
        }),
        preloadLatestConversationUserText: false,
      });
      try {
        const stream = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        let output;
        for await (const chunk of stream.toUIMessageStream()) {
          if (chunk.type === "tool-output-available") output = chunk.output;
        }
        assertExists(output);
        assertEquals(output, {
          taskInput: taskInput ?? null,
          frozen: true,
          projectId: scope.projectId,
          runId: scope.runId,
        });
        assertEquals(steps, 2);
      } finally {
        await runtime.cleanup();
      }
    }
  });
  clearModelProviders();
});

it("rejects malformed and cross-run hosted task input before discovery or tool setup", async () => {
  const scope = { projectId: "project-a", rootRunId: "root-a", runId: "child-a" };
  let calls = 0;
  await withMockFetch(() => {
    calls++;
    throw new Error("Unexpected outbound request");
  }, async () => {
    for (
      const taskInput of [null, {}, { version: 1, ...scope, runId: "other", payload: {} }, {
        version: 1,
        ...scope,
        rootRunId: "other",
        payload: {},
      }]
    ) {
      let failed = false;
      try {
        await createDefaultHostedChatRuntime({
          sourceIntegrationPolicy: { schemaVersion: 1, mode: "unrestricted" },
          options: {
            ...scope,
            taskInput: taskInput as never,
            authToken: "host-token",
            instructions: "Synthetic control",
          },
          config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
          buildLocalTools: () => {
            calls++;
            throw new Error("Unexpected tool setup");
          },
        });
      } catch (error) {
        failed = error instanceof Error && error.message === "Invalid host-owned task input";
      }
      assertEquals(failed, true);
    }
  });
  assertEquals(calls, 0);
});

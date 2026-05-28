import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "jsr:@std/testing@1.0.17/time";
import type { Agent } from "#veryfront/agent";
import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
  CreateSandboxBashTool,
} from "#veryfront/sandbox";
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

  it("preserves explicitly allowed source remote tool declarations before constructing the runtime", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedToolNames: string[] = [];

    const agent = {
      id: "support-agent",
      config: {
        id: "support-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          search_knowledge: true,
          get_file: true,
          unknown_local_tool: true,
        },
        allowedRemoteTools: ["search_knowledge", "get_file"],
        remoteTools: [{
          id: "veryfront-mcp",
          listTools: async () => [
            {
              name: "search_knowledge",
              description: "Search project knowledge",
              parameters: { type: "object", properties: {} },
            },
            {
              name: "get_file",
              description: "Read a project file",
              parameters: { type: "object", properties: {} },
            },
          ],
          executeTool: async () => ({}),
        }],
      },
    } as unknown as Agent;

    const input = {
      agentId: "support-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
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

    assertEquals(capturedToolNames, ["get_file", "search_knowledge"]);
  });

  it("materializes explicitly configured sandbox bash before constructing the runtime", async () => {
    const sessionManager = new AgentRunSessionManager();
    const sandboxInputs: AgentServiceSandboxToolsOptions[] = [];
    let capturedToolNames: string[] = [];

    const agent = {
      id: "builder-agent",
      config: {
        id: "builder-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          bash: true,
          missing_tool: true,
        },
        sandbox: {
          id: "sandbox-existing",
          endpoint: "https://sandbox-existing.example.test",
        },
      },
    } as unknown as Agent;

    const input = {
      agentId: "builder-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        projectAgentSandbox: {
          apiUrl: "https://api.test",
          authToken: "runtime-token",
          projectId: "project-1",
        },
        createBashTool: (() => Promise.resolve({ tools: {} })) as CreateSandboxBashTool,
        createAgentServiceSandboxTools: (sandboxInput) => {
          sandboxInputs.push(sandboxInput);
          return Promise.resolve({
            tools: {
              bash: {
                description: "Run bash",
                execute: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
              },
              sandbox_read_file: {
                description: "Read sandbox file",
                execute: async () => "",
              },
            },
            sandbox: {} as AgentServiceSandboxToolsResult["sandbox"],
            closeSandbox: async () => {},
          });
        },
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

    assertEquals(capturedToolNames, ["bash"]);
    assertEquals(
      sandboxInputs.map((sandboxInput) => ({
        apiUrl: sandboxInput.apiUrl,
        authToken: sandboxInput.authToken,
        projectId: sandboxInput.getProjectId?.(),
        sandboxId: sandboxInput.sandboxId,
        sandboxEndpoint: sandboxInput.sandboxEndpoint,
        deleteOnClose: sandboxInput.deleteOnClose,
      })),
      [
        {
          apiUrl: "https://api.test",
          authToken: "runtime-token",
          projectId: "project-1",
          sandboxId: "sandbox-existing",
          sandboxEndpoint: "https://sandbox-existing.example.test",
          deleteOnClose: false,
        },
      ],
    );
  });

  it("does not materialize sandbox bash without an explicit bash tool declaration", async () => {
    const sessionManager = new AgentRunSessionManager();
    let sandboxToolCalls = 0;
    let capturedToolNames: string[] = [];

    const agent = {
      id: "builder-agent",
      config: {
        id: "builder-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          missing_tool: true,
        },
      },
    } as unknown as Agent;

    const input = {
      agentId: "builder-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        projectAgentSandbox: {
          apiUrl: "https://api.test",
          authToken: "runtime-token",
          projectId: "project-1",
        },
        createBashTool: (() => Promise.resolve({ tools: {} })) as CreateSandboxBashTool,
        createAgentServiceSandboxTools: () => {
          sandboxToolCalls += 1;
          return Promise.resolve({
            tools: {},
            sandbox: {} as AgentServiceSandboxToolsResult["sandbox"],
            closeSandbox: async () => {},
          });
        },
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

    assertEquals(capturedToolNames, []);
    assertEquals(sandboxToolCalls, 0);
  });

  it("emits comment heartbeats while the runtime stream is idle", async () => {
    using time = new FakeTime();
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "idle-agent",
      config: {
        id: "idle-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;

    const input = {
      agentId: "idle-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    let runtimeController: ReadableStreamDefaultController<Uint8Array> | null = null;

    const response = await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: () => ({
          stream: async () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                runtimeController = controller;
                // Keep the stream idle so the control-plane response must stay alive.
              },
            }),
        }),
      },
    );

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected a runtime response body");
    }

    const decoder = new TextDecoder();
    const started = await reader.read();
    assertStringIncludes(decoder.decode(started.value), "event: RunStarted");

    const heartbeat = reader.read();
    time.tick(25_000);
    const heartbeatChunk = await heartbeat;
    assertEquals(
      decoder.decode(heartbeatChunk.value),
      ": internal-agent-runtime-heartbeat\n\n",
    );

    runtimeController?.close();
    await reader.cancel();
  });
});

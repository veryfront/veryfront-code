import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import type { Agent, AgentMessage } from "#veryfront/agent";
import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
  CreateSandboxBashTool,
} from "#veryfront/sandbox";
import { type Tool, toolRegistry } from "#veryfront/tool";
import { __resetLoggerConfigForTests, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

function captureConsoleJsonLogs(): { getEntries: () => LogEntry[]; restore: () => void } {
  const originalLog = console.log;
  const originalDebug = console.debug;
  const originalWarn = console.warn;
  const originalError = console.error;
  const capturedOutput: string[] = [];

  const capture = (msg: string) => {
    capturedOutput.push(msg);
  };

  console.log = capture;
  console.debug = capture;
  console.warn = capture;
  console.error = capture;

  return {
    getEntries: () =>
      capturedOutput
        .filter((line) => line.trim().startsWith("{"))
        .map((line) => JSON.parse(line) as LogEntry),
    restore: () => {
      console.log = originalLog;
      console.debug = originalDebug;
      console.warn = originalWarn;
      console.error = originalError;
    },
  };
}

async function withJsonDebugLogFormat<T>(fn: () => Promise<T>): Promise<T> {
  Deno.env.set("LOG_FORMAT", "json");
  Deno.env.set("LOG_LEVEL", "DEBUG");
  __resetLoggerConfigForTests();

  try {
    return await fn();
  } finally {
    Deno.env.delete("LOG_FORMAT");
    Deno.env.delete("LOG_LEVEL");
    __resetLoggerConfigForTests();
  }
}

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

  it("uses supplied local tool objects for boolean source tool declarations", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedTool: unknown;

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          read_baseline: true,
        },
      },
    } as unknown as Agent;

    const readBaselineTool = {
      id: "read_baseline",
      description: "Read baseline",
      inputSchema: { parse: (value: unknown) => value },
      execute: () => ({ ok: true }),
    } as unknown as Tool;

    const input = {
      agentId: "ops-agent",
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
        localTools: {
          read_baseline: readBaselineTool,
        },
        createRuntime: (_agent, mergedTools) => {
          capturedTool = typeof mergedTools === "object" && mergedTools !== null
            ? (mergedTools as Record<string, unknown>).read_baseline
            : undefined;
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

    assertEquals(capturedTool, readBaselineTool);
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
        __vfAllowedRemoteTools: ["search_knowledge", "get_file"],
        __vfRemoteToolSources: [{
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

  it("preserves source remote tool allowlists when forwarded allowlists are present", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedToolNames: string[] = [];

    const agent = {
      id: "support-agent",
      config: {
        id: "support-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          list_projects: true,
          gmail__list_emails: true,
        },
        __vfAllowedRemoteTools: ["list_projects"],
        __vfRemoteToolSources: [{
          id: "veryfront-platform-mcp",
          listTools: async () => [
            {
              name: "list_projects",
              description: "List projects",
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
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["gmail__list_emails"],
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
        createRuntime: (runtimeAgent, mergedTools) => {
          capturedAllowedRemoteTools = (
            runtimeAgent.config as Agent["config"] & { __vfAllowedRemoteTools?: string[] }
          ).__vfAllowedRemoteTools;
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

    assertEquals(capturedAllowedRemoteTools, ["list_projects", "gmail__list_emails"]);
    assertEquals(capturedToolNames, ["gmail__list_emails", "list_projects"]);
  });

  it("restricts the run tool surface to runtimeOverrides.toolAllowlist", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedToolNames: string[] = [];

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          read_baseline: { description: "Read the telemetry baseline" },
          create_issue: { description: "File a GitHub issue" },
        },
      },
    } as unknown as Agent;

    const input = {
      agentId: "ops-agent",
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
          toolAllowlist: ["read_baseline"],
          allowedTools: ["gmail__list_emails"],
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

    // Agent source tools outside the allowlist, injected caller tools, and
    // granted integration tools are all withheld from the model.
    assertEquals(capturedToolNames, ["read_baseline"]);
  });

  it("preserves skill runtime tools for skill-enabled agents under toolAllowlist", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedToolNames: string[] = [];

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        skills: true,
        tools: {
          read_baseline: { description: "Read the telemetry baseline" },
          create_issue: { description: "File a GitHub issue" },
          load_skill: { description: "Load a skill" },
        },
      },
    } as unknown as Agent;

    const input = {
      agentId: "ops-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {
        runtimeOverrides: {
          toolAllowlist: ["read_baseline"],
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

    assertEquals(capturedToolNames, ["load_skill", "read_baseline"]);
  });

  it("intersects toolAllowlist with the agent source remote tool filter", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        __vfAllowedRemoteTools: ["list_projects", "search_knowledge"],
      },
    } as unknown as Agent;

    const input = {
      agentId: "ops-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {
        runtimeOverrides: {
          // create_issue is not source-allowed as a remote tool: the
          // restrictive allowlist must not widen remote exposure.
          toolAllowlist: ["search_knowledge", "create_issue"],
        },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: (runtimeAgent) => {
          capturedAllowedRemoteTools = (
            runtimeAgent.config as Agent["config"] & { __vfAllowedRemoteTools?: string[] }
          ).__vfAllowedRemoteTools;
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

    assertEquals(capturedAllowedRemoteTools, ["search_knowledge"]);
  });

  it("fails closed when toolAllowlist is present but malformed", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedToolNames: string[] = [];

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          read_baseline: { description: "Read the telemetry baseline" },
        },
      },
    } as unknown as Agent;

    const input = {
      agentId: "ops-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {
        runtimeOverrides: {
          toolAllowlist: "read_baseline",
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

    assertEquals(capturedToolNames, []);
  });

  it("compacts oversized internal runtime message history before streaming", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedMessages: AgentMessage[] = [];

    const agent = {
      id: "research-agent",
      config: {
        id: "research-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;

    const input = {
      agentId: "research-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "Research the target architecture.",
        },
        {
          id: "old-assistant",
          role: "assistant",
          content: "Large research artifact ".repeat(720_000),
        },
        {
          id: "latest-user",
          role: "user",
          content: "Continue and finish the diagram.",
        },
      ],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: () => ({
          stream: async (messages) => {
            capturedMessages = messages;
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        }),
      },
    );

    assertEquals(capturedMessages.length, 3);
    assertEquals(capturedMessages[0]?.role, "user");
    const firstText = capturedMessages[0]?.parts.find((part) => part.type === "text");
    assertStringIncludes(
      firstText && "text" in firstText && typeof firstText.text === "string" ? firstText.text : "",
      "[Compressed:",
    );
    assertStringIncludes(JSON.stringify(capturedMessages), "Continue and finish the diagram.");
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

  it("keeps concrete project source tools executable when forwarded metadata has the same name", async () => {
    const sessionManager = new AgentRunSessionManager();
    const projectTool = {
      id: "number-generator",
      type: "function",
      description: "Generate a number",
      inputSchema: {} as never,
      inputSchemaJson: { type: "object", properties: {} },
      execute: () => ({ randomNumber: 7 }),
    };
    let capturedToolResult: unknown;

    const agent = {
      id: "random",
      config: {
        id: "random",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          "number-generator": projectTool,
        },
      },
    } as unknown as Agent;

    const input = {
      agentId: "random",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [
        {
          name: "number-generator",
          description: "Generates a random number within a specified range.",
          parameters: { type: "object", properties: {} },
        },
      ],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: (_agent, mergedTools) => {
          if (mergedTools && mergedTools !== true) {
            const tool = mergedTools["number-generator"];
            if (tool && tool !== true) {
              capturedToolResult = (tool as Tool).execute?.({});
            }
          }
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

    assertEquals(capturedToolResult, { randomNumber: 7 });
  });

  it("keeps server-resolved project source tools out of injected studio waits", async () => {
    const sessionManager = new AgentRunSessionManager();
    const projectTool = {
      id: "number-generator",
      type: "function",
      description: "Generate a number",
      inputSchema: {} as never,
      inputSchemaJson: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: () => ({ randomNumber: 7 }),
    } as unknown as Tool;
    let capturedToolEntry: Tool | boolean | undefined;

    toolRegistry.register("number-generator", projectTool);
    try {
      const agent = {
        id: "random",
        config: {
          id: "random",
          model: "anthropic/claude-opus-4-6",
          system: "test",
          tools: {
            "number-generator": true,
          },
        },
      } as unknown as Agent;

      const input = {
        agentId: "random",
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messages: [],
        tools: [
          {
            name: "number-generator",
            description: "Generates a random number within a specified range.",
            parameters: { type: "object", properties: {} },
          },
        ],
        context: [],
        forwardedProps: {
          runtimeOverrides: {
            serverResolvedProjectTools: ["number-generator"],
          },
        },
      } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

      await createRuntimeAgentStreamResponse(
        input,
        agent,
        {
          sessionManager,
          createRuntime: (_agent, mergedTools) => {
            if (mergedTools && mergedTools !== true) {
              capturedToolEntry = mergedTools["number-generator"];
            }
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
    } finally {
      toolRegistry.delete("number-generator");
    }

    assertEquals(capturedToolEntry, projectTool);
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
    const runtimeControllers: ReadableStreamDefaultController<Uint8Array>[] = [];

    const response = await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: () => ({
          stream: async () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                runtimeControllers.push(controller);
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

    runtimeControllers[0]?.close();
    await reader.cancel();
  });

  it("cancels an active runtime stream when the client disconnects before a tool wait", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "disconnect-agent",
      config: {
        id: "disconnect-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;

    const input = {
      agentId: "disconnect-agent",
      threadId: crypto.randomUUID(),
      runId: "run_disconnect",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    let runtimeCancelCalls = 0;
    const response = await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: () => ({
          stream: async () =>
            new ReadableStream<Uint8Array>({
              cancel() {
                runtimeCancelCalls++;
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

    await reader.cancel();
    for (let attempt = 0; attempt < 20 && runtimeCancelCalls === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assertEquals(runtimeCancelCalls, 1);
    assertEquals(sessionManager.getRunStatus(input.runId), null);
  });

  it("debug logs runtime reader cancellation failures during abort cleanup", async () => {
    const logs = captureConsoleJsonLogs();
    try {
      await withJsonDebugLogFormat(async () => {
        const sessionManager = new AgentRunSessionManager();
        const agent = {
          id: "abort-agent",
          config: {
            id: "abort-agent",
            model: "anthropic/claude-opus-4-6",
            system: "test",
          },
        } as unknown as Agent;

        const input = {
          agentId: "abort-agent",
          threadId: crypto.randomUUID(),
          runId: "run_abort",
          messages: [],
          tools: [],
          context: [],
        } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

        let cancelCalls = 0;
        const response = await createRuntimeAgentStreamResponse(
          input,
          agent,
          {
            sessionManager,
            createRuntime: () => ({
              stream: async () =>
                new ReadableStream<Uint8Array>({
                  cancel() {
                    cancelCalls++;
                    throw new Error("runtime cancel rejected");
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

        assertEquals(sessionManager.cancelRun(input.runId), true);
        await reader.read();
        assertEquals(cancelCalls, 1);
      });
    } finally {
      logs.restore();
    }

    const debugEntry = logs.getEntries().find((entry) =>
      entry.level === "debug" &&
      entry.message === "Internal agent runtime reader cancellation failed during abort cleanup"
    );
    assertEquals(debugEntry?.component, "internal-agent-run-stream");
  });
});

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import type { Agent, AgentMessage } from "#veryfront/agent";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
  CreateSandboxBashTool,
} from "#veryfront/sandbox";
import { type RemoteToolSource, type Tool, toolRegistry } from "#veryfront/tool";
import { __resetLoggerConfigForTests, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { buildMergedTools, createRuntimeAgentStreamResponse } from "./run-stream.ts";

class RecordingSpan implements Span {
  readonly attributes: Record<string, AttributeValue> = {};
  readonly events: Array<{ name: string; attrs?: Record<string, AttributeValue> }> = [];
  status: { code: number; message?: string } | undefined;
  ended = false;

  constructor(readonly name: string) {}

  setAttribute(key: string, value: AttributeValue): Span {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Record<string, AttributeValue>): Span {
    Object.assign(this.attributes, attrs);
    return this;
  }

  setStatus(status: { code: number; message?: string }): Span {
    this.status = status;
    return this;
  }

  recordException(): void {}

  addEvent(name: string, attrs?: Record<string, AttributeValue>): Span {
    this.events.push({ name, attrs });
    return this;
  }

  end(): void {
    this.ended = true;
  }

  spanContext(): SpanContext {
    return {
      traceId: "00000000000000000000000000000001",
      spanId: "0000000000000001",
      traceFlags: 1,
    };
  }

  updateName(): void {}
}

function remoteToolSource(toolNames: string[]): RemoteToolSource {
  return {
    id: "test-remote-source",
    listTools: async () =>
      toolNames.map((name) => ({
        name,
        description: `${name} description`,
        parameters: { type: "object", properties: {} },
      })),
    executeTool: async () => ({}),
  };
}

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
  afterEach(() => {
    _resetShimForTests();
  });

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

  it("rejects merged remote grants above the bounded tool surface", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "bounded-agent",
      config: {
        id: "bounded-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        __vfAllowedRemoteTools: Array.from({ length: 256 }, (_, index) => `source_${index}`),
      },
    } as unknown as Agent;
    const input = {
      agentId: "bounded-agent",
      threadId: crypto.randomUUID(),
      runId: "run_bounded_grants",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {
        runtimeOverrides: { allowedTools: ["forwarded_256"] },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(input, agent, {
          sessionManager,
          createRuntime: () => ({
            stream: async () => new ReadableStream<Uint8Array>(),
          }),
        }),
      RangeError,
      "Remote tool grants exceed",
    );
    assertEquals(sessionManager.getRunStatus(input.runId), null);
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
          toolAllowlist: ["read_baseline", 42],
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

  it("does not grant remote integration tools via the toolAllowlist fallback", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;

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
          // gmail__list_emails is integration-patterned and was neither
          // granted nor forwarded as a definition: the fallback remote filter
          // must not turn the allowlist entry into an implicit grant.
          toolAllowlist: ["read_baseline", "gmail__list_emails"],
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

    assertEquals(capturedAllowedRemoteTools, []);
  });

  it("does not treat forwarded integration defs as grants without allowedTools", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;

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
          // The caller forwarded a definition for gmail__list_emails, so the
          // runtime can render metadata if it is otherwise granted, but the
          // definition itself is not the grant channel.
          toolAllowlist: ["gmail__list_emails"],
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

    assertEquals(capturedAllowedRemoteTools, []);
  });

  it("keeps allowlisted forwarded integration tools granted by allowedTools", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;

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
          toolAllowlist: ["gmail__list_emails"],
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

    assertEquals(capturedAllowedRemoteTools, ["gmail__list_emails"]);
  });

  it("allows a toolAllowlist subset of declared remote-source tools named like integrations", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: true,
        __vfRemoteToolSources: [remoteToolSource([
          "github__list_issues",
          "github__delete_issue",
        ])],
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
          toolAllowlist: ["github__list_issues"],
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

    assertEquals(capturedAllowedRemoteTools, ["github__list_issues"]);
  });

  it("fails closed when remote tool discovery exceeds its bounded surface", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;
    const discoveredToolNames = Array.from(
      { length: 257 },
      (_, index) => index === 0 ? "github__list_issues" : `tool_${index}`,
    );
    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: true,
        __vfRemoteToolSources: [remoteToolSource(discoveredToolNames)],
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
        runtimeOverrides: { toolAllowlist: ["github__list_issues"] },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => {
        capturedAllowedRemoteTools = (
          runtimeAgent.config as Agent["config"] & { __vfAllowedRemoteTools?: string[] }
        ).__vfAllowedRemoteTools;
        return {
          stream: async () =>
            new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
        };
      },
    });

    assertEquals(capturedAllowedRemoteTools, []);
  });

  it("strips all tools for an explicitly empty toolAllowlist", async () => {
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
          toolAllowlist: [],
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

  it("caps providerTools to the toolAllowlist", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedProviderTools: string[] | undefined;

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        providerTools: ["web_search"],
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
          toolAllowlist: ["read_baseline"],
        },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: (runtimeAgent) => {
          capturedProviderTools = runtimeAgent.config.providerTools;
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

    assertEquals(capturedProviderTools, []);
  });

  it("preserves invoke_agent delegation for skill-enabled agents under toolAllowlist", async () => {
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
          invoke_agent: { description: "Delegate to another agent" },
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

    // Documented semantics (see applyRuntimeToolAllowlist): delegation tools
    // survive the allowlist for skill-enabled agents, and child runs are NOT
    // capped by this run's allowlist.
    assertEquals(capturedToolNames, ["invoke_agent", "read_baseline"]);
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

  it("does not expose injected tool failure payloads through runtime errors", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: "thread_1" });
    const agent = {
      id: "test",
      config: { id: "test", model: "test", system: "test" },
    } as unknown as Agent;
    const input = {
      agentId: "test",
      threadId: "thread_1",
      runId: "run_1",
      messages: [],
      tools: [{ name: "external_tool", description: "External tool" }],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    const mergedTools = buildMergedTools(agent, input, sessionManager);
    const injectedTool = mergedTools && mergedTools !== true
      ? mergedTools.external_tool
      : undefined;
    if (!injectedTool || injectedTool === true) {
      throw new Error("Expected injected tool");
    }

    const pending = injectedTool.execute?.({}, { toolCallId: "tool-call-1" });
    sessionManager.submitToolResult("run_1", {
      toolCallId: "tool-call-1",
      result: "private provider failure payload",
      isError: true,
    });

    await assertRejects(
      () => Promise.resolve(pending),
      Error,
      "Injected tool execution failed",
    );
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

  it("records completed runtime token usage on the agent.run span", async () => {
    const spans: RecordingSpan[] = [];
    const tracer: Tracer = {
      startSpan(name) {
        const span = new RecordingSpan(name);
        spans.push(span);
        return span;
      },
      startActiveSpan<T>(
        name: string,
        optionsOrFn: ((span: Span) => T) | {
          kind?: number;
          attributes?: Record<string, AttributeValue>;
        },
        contextOrFn?: unknown,
        fn?: (span: Span) => T,
      ): T {
        const span = this.startSpan(name);
        const callback: ((span: Span) => T) | undefined = typeof optionsOrFn === "function"
          ? optionsOrFn
          : typeof contextOrFn === "function"
          ? contextOrFn as (span: Span) => T
          : fn;
        if (!callback) {
          throw new Error("Expected an active span callback");
        }
        try {
          return callback(span);
        } finally {
          span.end();
        }
      },
    };
    setGlobalTracerProvider({ getTracer: () => tracer });

    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;

    const input = {
      agentId: "ops-agent",
      threadId: crypto.randomUUID(),
      runId: "run_usage",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    const response = await createRuntimeAgentStreamResponse(
      input,
      agent,
      {
        sessionManager,
        createRuntime: () => ({
          stream: async (_messages, _context, callbacks) => {
            callbacks?.onFinish?.({
              text: "done",
              messages: [],
              toolCalls: [],
              status: "completed",
              usage: {
                promptTokens: 17,
                completionTokens: 11,
                totalTokens: 28,
                cachedInputTokens: 5,
                cacheCreationInputTokens: 2,
                cacheReadInputTokens: 3,
                reasoningTokens: 4,
                billableInputTokens: 15,
                billableOutputTokens: 10,
                providerCostUsd: 0.012,
                veryfrontChargeUsd: 0.014,
                costCredits: 2,
                costSource: "gateway",
                billingMode: "deferred",
                usageCaptureStatus: "complete",
              },
            });
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${
                      JSON.stringify({
                        type: "text-delta",
                        messageId: "assistant-usage",
                        delta: "done",
                      })
                    }\n\n`,
                  ),
                );
                controller.close();
              },
            });
          },
        }),
      },
    );

    await response.text();

    const runSpan = spans.find((span) => span.name === "agent.run");
    assertEquals(runSpan?.ended, true);
    assertEquals(runSpan?.attributes["agent.run.final_status"], "completed");
    assertEquals(runSpan?.attributes["gen_ai.usage.input_tokens"], 17);
    assertEquals(runSpan?.attributes["gen_ai.usage.output_tokens"], 11);
    assertEquals(runSpan?.attributes["gen_ai.usage.total_tokens"], 28);
    assertEquals(runSpan?.attributes["gen_ai.usage.cache_creation.input_tokens"], 2);
    assertEquals(runSpan?.attributes["gen_ai.usage.cache_read.input_tokens"], 3);
    assertEquals(runSpan?.attributes["gen_ai.usage.reasoning.output_tokens"], 4);
    assertEquals(runSpan?.attributes["agent.usage.billable_input_tokens"], 15);
    assertEquals(runSpan?.attributes["agent.usage.billable_output_tokens"], 10);
    assertEquals(runSpan?.attributes["agent.usage.provider_cost_usd"], 0.012);
    assertEquals(runSpan?.attributes["agent.usage.veryfront_charge_usd"], 0.014);
    assertEquals(runSpan?.attributes["agent.usage.cost_credits"], 2);
    assertEquals(runSpan?.attributes["agent.usage.cost_source"], "gateway");
    assertEquals(runSpan?.attributes["agent.usage.billing_mode"], "deferred");
    assertEquals(runSpan?.attributes["agent.usage.capture_status"], "complete");
    assertEquals(runSpan?.attributes["run.id"], undefined);
    assertEquals(runSpan?.attributes["thread.id"], undefined);
    assertEquals(runSpan?.attributes["project.id"], undefined);
  });

  it("does not tear down an existing run when a duplicate stream is rejected", async () => {
    const sessionManager = new AgentRunSessionManager();
    const threadId = crypto.randomUUID();
    sessionManager.startRun({ runId: "run_duplicate", threadId });
    let runtimeConstructionCalls = 0;
    const agent = {
      id: "duplicate-agent",
      config: {
        id: "duplicate-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: "duplicate-agent",
      threadId,
      runId: "run_duplicate",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(input, agent, {
          sessionManager,
          createRuntime: () => {
            runtimeConstructionCalls += 1;
            return {
              stream: async () => new ReadableStream<Uint8Array>(),
            };
          },
        }),
      Error,
      "already active",
    );

    assertEquals(runtimeConstructionCalls, 0);
    assertEquals(sessionManager.getRunStatus(input.runId), "running");
    assertEquals(sessionManager.cancelRun(input.runId), true);
  });

  it("releases the run session and sandbox when runtime construction fails", async () => {
    const sessionManager = new AgentRunSessionManager();
    let closeCalls = 0;
    const agent = {
      id: "builder-agent",
      config: {
        id: "builder-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: { bash: true },
      },
    } as unknown as Agent;
    const input = {
      agentId: "builder-agent",
      threadId: crypto.randomUUID(),
      runId: "run_setup_failure",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(input, agent, {
          sessionManager,
          createBashTool: (() => Promise.resolve({ tools: {} })) as CreateSandboxBashTool,
          createAgentServiceSandboxTools: () =>
            Promise.resolve({
              tools: {
                bash: {
                  description: "Run bash",
                  execute: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
                },
              },
              sandbox: {} as AgentServiceSandboxToolsResult["sandbox"],
              closeSandbox: async () => {
                closeCalls += 1;
              },
            }),
          createRuntime: () => {
            throw new Error("runtime construction failed");
          },
        }),
      Error,
      "runtime construction failed",
    );

    assertEquals(sessionManager.getRunStatus(input.runId), null);
    assertEquals(closeCalls, 1);
  });

  it("redacts runtime failures from client events and structured logs", async () => {
    const logs = captureConsoleJsonLogs();
    const secret = "private-provider-payload";
    let responseText = "";
    try {
      await withJsonDebugLogFormat(async () => {
        const sessionManager = new AgentRunSessionManager();
        const agent = {
          id: "sensitive-agent-id",
          config: {
            id: "sensitive-agent-id",
            model: "anthropic/claude-opus-4-6",
            system: "test",
          },
        } as unknown as Agent;
        const input = {
          agentId: "sensitive-agent-id",
          threadId: "10000000-1000-4000-8000-100000000099",
          runId: "sensitive-run-id",
          messages: [],
          tools: [],
          context: [],
        } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

        const response = await createRuntimeAgentStreamResponse(input, agent, {
          sessionManager,
          createRuntime: () => ({
            stream: async () =>
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.error(new Error(secret));
                },
              }),
          }),
        });
        responseText = await response.text();
      });
    } finally {
      logs.restore();
    }

    const serializedLogs = JSON.stringify(logs.getEntries());
    assertEquals(responseText.includes(secret), false);
    assertStringIncludes(responseText, "Internal agent runtime failed");
    assertEquals(serializedLogs.includes(secret), false);
    assertEquals(serializedLogs.includes("sensitive-agent-id"), false);
    assertEquals(serializedLogs.includes("sensitive-run-id"), false);
    assertEquals(serializedLogs.includes("10000000-1000-4000-8000-100000000099"), false);
  });

  it("redacts runtime and tool error payloads carried by data-stream events", async () => {
    const secret = "private-runtime-error-detail";
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "event-error-agent",
      config: {
        id: "event-error-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: "event-error-agent",
      threadId: crypto.randomUUID(),
      runId: "run_event_error",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    const frames = [
      { type: "tool-output-error", toolCallId: "tool-1", errorText: secret },
      { type: "error", error: secret },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(frames));
              controller.close();
            },
          }),
      }),
    });

    const body = await response.text();
    assertEquals(body.includes(secret), false);
    assertStringIncludes(body, "Tool execution failed");
    assertStringIncludes(body, "Internal agent runtime failed");
  });

  it("marks runs with terminal runtime events as failed", async () => {
    class RecordingSessionManager extends AgentRunSessionManager {
      completedRuns = 0;
      failedRuns = 0;

      override completeRun(runId: string): void {
        this.completedRuns += 1;
        super.completeRun(runId);
      }

      override failRun(runId: string): void {
        this.failedRuns += 1;
        super.failRun(runId);
      }
    }

    const sessionManager = new RecordingSessionManager();
    const agent = {
      id: "terminal-error-agent",
      config: {
        id: "terminal-error-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: "terminal-error-agent",
      threadId: crypto.randomUUID(),
      runId: "run_terminal_error",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: "error", error: "provider failed" })}\n\n`,
                ),
              );
              controller.close();
            },
          }),
      }),
    });

    await response.text();
    assertEquals(sessionManager.completedRuns, 0);
    assertEquals(sessionManager.failedRuns, 1);
  });

  it("fails closed when the runtime stream contains malformed UTF-8", async () => {
    const sessionManager = new AgentRunSessionManager();
    let runtimeCancelCalls = 0;
    const agent = {
      id: "encoding-agent",
      config: {
        id: "encoding-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: "encoding-agent",
      threadId: crypto.randomUUID(),
      runId: "run_encoding",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([0xc3, 0x28]));
            },
            cancel() {
              runtimeCancelCalls += 1;
            },
          }),
      }),
    });

    const body = await response.text();
    assertStringIncludes(body, '"code":"RUNTIME_ERROR"');
    assertEquals(body.includes("\uFFFD"), false);
    assertEquals(runtimeCancelCalls, 1);
  });

  it("stops draining runtime output while the response consumer applies backpressure", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "backpressure-agent",
      config: {
        id: "backpressure-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: "backpressure-agent",
      threadId: crypto.randomUUID(),
      runId: "run_backpressure",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    let runtimePulls = 0;

    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            pull(controller) {
              runtimePulls += 1;
              if (runtimePulls > 10) {
                controller.close();
                return;
              }
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${
                    JSON.stringify({
                      type: "text-delta",
                      messageId: "assistant-1",
                      delta: String(runtimePulls),
                    })
                  }\n\n`,
                ),
              );
            },
          }),
      }),
    });

    assertEquals(response.headers.get("cache-control"), "no-cache, no-store");
    assertEquals(response.headers.get("x-accel-buffering"), "no");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(runtimePulls <= 2, true);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected a runtime response body");
    await reader.read();
    await reader.read();
    await reader.cancel();
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

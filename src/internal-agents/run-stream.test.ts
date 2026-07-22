import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

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

  it("forwards the scheduled output-token cap to the internal runtime", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedMaxOutputTokens: number | undefined;
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-sonnet-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: "test",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: { maxOutputTokens: 1200 },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async (_messages, _context, _callbacks, _modelOverride, maxOutputTokens) => {
          capturedMaxOutputTokens = maxOutputTokens;
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          });
        },
      }),
    });

    assertEquals(capturedMaxOutputTokens, 1200);
  });

  it("composes the runtime system prompt with project, environment, and tool context", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAgent: Agent | undefined;
    const agent = {
      id: "custom",
      config: {
        id: "custom",
        model: "openai/gpt-5.4-nano",
        system: "You are Custom Agent.",
        tools: { create_file: { id: "create_file", type: "function", execute: () => "" } },
      },
    } as unknown as Agent;
    const input = {
      agentId: "custom",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [
        {
          type: "json",
          title: "studio_context",
          data: {
            projectId: "ignored-when-sandbox-set",
            branchId: null,
            environmentContext: "<layout_context>\nVisible panels: [chat]\n</layout_context>",
          },
        },
      ],
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["outlook__send_email"],
          integrationToolDefinitions: [
            {
              name: "outlook__send_email",
              description: "Send an Outlook email",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      projectAgentSandbox: { projectId: "project-1" },
      createRuntime: (runtimeAgent) => {
        capturedAgent = runtimeAgent;
        return {
          stream: async () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
        };
      },
    });

    const system = capturedAgent?.config.system;
    assertEquals(typeof system, "function");
    const prompt = await (system as () => Promise<string>)();
    assertStringIncludes(prompt, "You are Custom Agent.");
    assertStringIncludes(prompt, 'project_reference: "project-1"');
    assertStringIncludes(prompt, "branch_id: main (no branch_id needed for file operations)");
    assertStringIncludes(prompt, "<environment_context>");
    assertStringIncludes(prompt, "Visible panels: [chat]");
    assertStringIncludes(prompt, '<runtime_info>\nmodel: "openai/gpt-5.4-nano"\n</runtime_info>');
    assertStringIncludes(prompt, "Current run tool inventory:");
    assertStringIncludes(prompt, "- create_file");
    assertStringIncludes(prompt, "- outlook__send_email");
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
    let runtimeSystem: unknown;

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
          runtimeSystem = runtimeAgent.config.system;
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

    assertEquals(capturedAllowedRemoteTools, undefined);
    assertEquals(typeof runtimeSystem, "function");
    const prompt = await (runtimeSystem as () => Promise<string>)();
    assertEquals(prompt.includes("- gmail__list_emails"), false);
  });

  it("keeps allowlisted forwarded integration tools granted by allowedTools", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;
    let runtimeSystem: unknown;

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
            {
              name: "gmail__delete_email",
              description: "Delete an email",
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
          runtimeSystem = runtimeAgent.config.system;
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
    assertEquals(typeof runtimeSystem, "function");
    const prompt = await (runtimeSystem as () => Promise<string>)();
    assertStringIncludes(prompt, "- gmail__list_emails");
    assertEquals(prompt.includes("- gmail__delete_email"), false);
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

  it("omits provider tools unsupported by the configured model from the inventory", async () => {
    const sessionManager = new AgentRunSessionManager();
    let runtimeSystem: unknown;

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "openai/gpt-5.4-nano",
        system: "test",
        providerTools: ["web_search"],
      },
    } as unknown as Agent;

    const input = {
      agentId: "ops-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => {
        runtimeSystem = runtimeAgent.config.system;
        return {
          stream: async () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
        };
      },
    });

    assertEquals(typeof runtimeSystem, "function");
    const prompt = await (runtimeSystem as () => Promise<string>)();
    assertEquals(prompt.includes("- web_search"), false);
  });

  it("keeps local tools required without protecting remote placeholders from provider caps", async () => {
    const sessionManager = new AgentRunSessionManager();
    const remoteToolNames = Array.from(
      { length: 150 },
      (_, index) => `remote_${String(index).padStart(3, "0")}`,
    );
    let runtimeSystem: unknown;

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "openai/gpt-5.4-nano",
        system: "test",
        tools: Object.fromEntries([
          ...remoteToolNames.map((toolName) => [toolName, true] as const),
          ["zzz_local", { description: "Keep this local tool available" }],
        ]),
        __vfAllowedRemoteTools: [...remoteToolNames, "zzz_local"],
      },
    } as unknown as Agent;

    const input = {
      agentId: "ops-agent",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => {
        runtimeSystem = runtimeAgent.config.system;
        return {
          stream: async () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            }),
        };
      },
    });

    assertEquals(typeof runtimeSystem, "function");
    const prompt = await (runtimeSystem as () => Promise<string>)();
    assertStringIncludes(prompt, "- zzz_local");
    assertEquals(prompt.includes("- remote_127"), false);
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

  it("materializes explicitly configured sandbox tools before constructing the runtime", async () => {
    const sessionManager = new AgentRunSessionManager();
    const sandboxInputs: AgentServiceSandboxToolsOptions[] = [];
    let capturedToolNames: string[] = [];
    let capturedTools: Agent["config"]["tools"];
    const inputSchemaJson = {
      type: "object" as const,
      properties: {},
      additionalProperties: true,
    };

    const agent = {
      id: "builder-agent",
      config: {
        id: "builder-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: {
          bash: true,
          sandbox_read_file: true,
          sandbox_write_file: true,
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
                inputSchemaJson,
                execute: async () => ({ stdout: "ok", stderr: "", exitCode: 0 }),
              },
              sandbox_read_file: {
                description: "Read sandbox file",
                inputSchemaJson,
                execute: async () => "",
              },
              sandbox_write_file: {
                description: "Write sandbox file",
                inputSchemaJson,
                execute: async () => undefined,
              },
            },
            sandbox: {} as AgentServiceSandboxToolsResult["sandbox"],
            closeSandbox: async () => {},
          });
        },
        createRuntime: (_agent, mergedTools) => {
          capturedTools = mergedTools;
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

    assertEquals(capturedToolNames, ["bash", "sandbox_read_file", "sandbox_write_file"]);
    if (!capturedTools || capturedTools === true) {
      throw new Error("Expected materialized sandbox tools");
    }
    for (const toolName of ["bash", "sandbox_read_file", "sandbox_write_file"]) {
      const runtimeTool = capturedTools[toolName];
      if (!runtimeTool || runtimeTool === true) {
        throw new Error(`Expected materialized ${toolName}`);
      }
      assertEquals(runtimeTool.type, "dynamic");
    }
    const bash = capturedTools.bash;
    if (!bash || bash === true || !bash.execute) {
      throw new Error("Expected executable bash tool");
    }
    assertEquals(await bash.execute({}, { toolCallId: "bash-call" }), {
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
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

import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import {
  type Agent,
  agent as createAgent,
  type AgentMessage,
  DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER,
} from "#veryfront/agent";
import { flattenSystemInstructions } from "#veryfront/agent/runtime/tool-inventory.ts";
import { resolveAgentSystem } from "#veryfront/agent/runtime/effective-agent-system.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "#veryfront/agent/runtime/agent-markdown-adapter.ts";
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
import { registerSkill } from "#veryfront/skill/registry.ts";
import { type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import type { RemoteToolSource, Tool } from "#veryfront/tool";
import { __resetLoggerConfigForTests, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import { getActiveRunEventSinks } from "#veryfront/runtime/run-event-sink-context.ts";
import type { ProviderReplayCheckpoint } from "#veryfront/agent/runtime/provider-replay.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import {
  buildMergedTools,
  createRuntimeAgentStreamResponse,
  getExplicitlyDeniedToolNames,
  MODEL_CALL_CONTEXT_SSE_EVENT_NAME,
  PROVIDER_REPLAY_PROTOCOL_HEADER,
  PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME,
} from "./run-stream.ts";

function parseSseFrames(body: string): Array<{ event: string; data: unknown }> {
  return body.split("\n\n").flatMap((frame) => {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) as unknown }] : [];
  });
}

async function resolveTestAgentSystem(system: unknown): Promise<Agent["config"]["system"]> {
  if (typeof system === "function") {
    return await resolveAgentSystem(system as Agent["config"]["system"], undefined);
  }
  return system as Agent["config"]["system"];
}

async function getAgentSystemText(system: unknown): Promise<string> {
  const resolved = await resolveTestAgentSystem(system);
  if (typeof resolved === "string") {
    return resolved;
  }
  if (Array.isArray(resolved)) {
    return flattenSystemInstructions(resolved);
  }
  throw new Error("Expected agent system instructions");
}

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

function installRecordingTracer(): RecordingSpan[] {
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
  return spans;
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
    skillRegistryInternal.clearAll();
  });

  it("includes skill infrastructure for tools: true agents without a skills selector", () => {
    toolRegistryInternal.clearAll();
    try {
      const runtimeAgent = createAgent({
        id: "universal-skill-agent",
        system: "Use available skills.",
        tools: true,
      });
      const mergedTools = buildMergedTools(
        runtimeAgent,
        {
          runId: "run_1",
          threadId: crypto.randomUUID(),
          messages: [],
          tools: [],
          context: [],
        } as Parameters<typeof buildMergedTools>[1],
        new AgentRunSessionManager(),
      );

      assertEquals(Object.keys(mergedTools ?? {}).sort(), [
        "execute_skill_script",
        "load_skill",
        "load_skill_reference",
      ]);
    } finally {
      toolRegistryInternal.clearAll();
    }
  });

  it("keeps injected studio waits authoritative over same-named registry tools", () => {
    const sessionManager = new AgentRunSessionManager();
    const projectTool = {
      id: "number-generator",
      type: "function",
      description: "Generate a number",
      inputSchema: {} as never,
      execute: () => ({ randomNumber: 7 }),
    } as unknown as Tool;

    toolRegistryInternal.register("number-generator", projectTool);
    try {
      const runtimeAgent = {
        id: "random",
        config: {
          id: "random",
          system: "test",
          tools: { "number-generator": true },
        },
      } as unknown as Agent;
      const mergedTools = buildMergedTools(
        runtimeAgent,
        {
          runId: "run_1",
          threadId: crypto.randomUUID(),
          messages: [],
          tools: [{
            name: "number-generator",
            description: "Caller-supplied shadow definition",
          }],
          context: [],
        } as Parameters<typeof buildMergedTools>[1],
        sessionManager,
      );

      const entry = mergedTools?.["number-generator"];
      assertEquals(typeof entry, "object");
      assertEquals((entry as Tool).description, "Caller-supplied shadow definition");
      assertEquals(entry === projectTool, false);
    } finally {
      toolRegistryInternal.delete("number-generator");
    }
  });

  it("keeps injected studio waits authoritative for tools: true agents", () => {
    const sessionManager = new AgentRunSessionManager();
    const projectTool = {
      id: "number-generator",
      type: "function",
      description: "Generate a number",
      inputSchema: {} as never,
      execute: () => ({ randomNumber: 7 }),
    } as unknown as Tool;

    toolRegistryInternal.register("number-generator", projectTool);
    try {
      const runtimeAgent = {
        id: "random",
        config: {
          id: "random",
          system: "test",
          tools: true,
        },
      } as unknown as Agent;
      const mergedTools = buildMergedTools(
        runtimeAgent,
        {
          runId: "run_1",
          threadId: crypto.randomUUID(),
          messages: [],
          tools: [{
            name: "number-generator",
            description: "Caller-supplied shadow definition",
          }],
          context: [],
        } as Parameters<typeof buildMergedTools>[1],
        sessionManager,
      );

      const entry = mergedTools?.["number-generator"];
      assertEquals(typeof entry, "object");
      assertEquals((entry as Tool).description, "Caller-supplied shadow definition");
    } finally {
      toolRegistryInternal.delete("number-generator");
    }
  });

  it("keeps explicit false denials authoritative over request-injected tools", () => {
    const sessionManager = new AgentRunSessionManager();
    const runtimeAgent = {
      id: "locked-down",
      config: {
        id: "locked-down",
        system: "test",
        tools: {
          load_skill: false,
          load_skill_reference: false,
          execute_skill_script: false,
        },
      },
    } as unknown as Agent;

    const mergedTools = buildMergedTools(
      runtimeAgent,
      {
        runId: "run_1",
        threadId: crypto.randomUUID(),
        messages: [],
        tools: [
          { name: "load_skill", description: "Caller-supplied loader" },
          { name: "execute_skill_script", description: "Caller-supplied executor" },
          { name: "unrelated_tool", description: "Still injectable" },
        ],
        context: [],
      } as Parameters<typeof buildMergedTools>[1],
      sessionManager,
    );

    assertEquals(Object.keys(mergedTools ?? {}), ["unrelated_tool"]);
  });

  it("rejects every request-injected tool when an unrestricted selector fails closed", () => {
    const sessionManager = new AgentRunSessionManager();
    const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
      id: "fail-closed-injected",
      name: "Fail Closed Injected",
      description: "Does not accept injected project tools",
      instructions: "Do not use project tools.",
      tools: true,
      deniedTools: ["update_file"],
    });

    const mergedTools = buildMergedTools(
      runtimeAgent,
      {
        runId: "run_1",
        threadId: crypto.randomUUID(),
        messages: [],
        tools: [
          { name: "update_file", description: "Denied tool" },
          { name: "unrelated_tool", description: "Another project tool" },
        ],
        context: [],
      } as Parameters<typeof buildMergedTools>[1],
      sessionManager,
    );

    assertEquals(mergedTools, undefined);
  });

  it("applies owned short-name denials to registered-name injected tools", () => {
    const sessionManager = new AgentRunSessionManager();
    toolRegistryInternal.register("researcher--fetch-paper", {
      id: "researcher--fetch-paper",
      shortName: "fetch-paper",
      ownerAgentId: "researcher",
      type: "function",
      description: "Fetch paper",
      inputSchema: {} as never,
      execute: () => ({ ok: true }),
    } as unknown as Tool);
    try {
      const runtimeAgent = {
        id: "researcher",
        config: {
          id: "researcher",
          system: "test",
          tools: { "fetch-paper": false },
        },
      } as unknown as Agent;

      const mergedTools = buildMergedTools(
        runtimeAgent,
        {
          runId: "run_1",
          threadId: crypto.randomUUID(),
          messages: [],
          tools: [{ name: "researcher--fetch-paper", description: "Injected wrapper" }],
          context: [],
        } as Parameters<typeof buildMergedTools>[1],
        sessionManager,
      );

      assertEquals(mergedTools, undefined);
    } finally {
      toolRegistryInternal.delete("researcher--fetch-paper");
    }
  });

  it("collects only explicit false entries as denied tool names", () => {
    const runtimeAgent = {
      id: "denied-remote",
      config: {
        id: "denied-remote",
        system: "test",
        tools: {
          create_file: false,
          load_skill: false,
          search_docs: true,
          echo: { id: "echo", description: "Echo" },
        },
      },
    } as unknown as Agent;

    const deniedToolNames = [...getExplicitlyDeniedToolNames(runtimeAgent)]
      .sort((left, right) => left.localeCompare(right));

    assertEquals(deniedToolNames, ["create_file", "load_skill"]);
    assertEquals(getExplicitlyDeniedToolNames({ config: {} } as unknown as Agent).size, 0);
  });

  it("keeps registry tools authoritative for server-resolved project tool names", () => {
    const sessionManager = new AgentRunSessionManager();
    const projectTool = {
      id: "number-generator",
      type: "function",
      description: "Generate a number",
      inputSchema: {} as never,
      execute: () => ({ randomNumber: 7 }),
    } as unknown as Tool;

    toolRegistryInternal.register("number-generator", projectTool);
    try {
      const runtimeAgent = {
        id: "random",
        config: {
          id: "random",
          system: "test",
          tools: { "number-generator": true },
        },
      } as unknown as Agent;
      const mergedTools = buildMergedTools(
        runtimeAgent,
        {
          runId: "run_1",
          threadId: crypto.randomUUID(),
          messages: [],
          tools: [{
            name: "number-generator",
            description: "Caller-supplied shadow definition",
          }],
          context: [],
          forwardedProps: {
            runtimeOverrides: {
              serverResolvedProjectTools: ["number-generator"],
            },
          },
        } as Parameters<typeof buildMergedTools>[1],
        sessionManager,
      );

      assertEquals(mergedTools?.["number-generator"], projectTool);
    } finally {
      toolRegistryInternal.delete("number-generator");
    }
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

  it("persists replay checkpoints before emitting the private turn boundary", async () => {
    const sessionManager = new AgentRunSessionManager();
    const messageId = crypto.randomUUID();
    const checkpoint: ProviderReplayCheckpoint = {
      version: 1,
      messageId,
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: "signed-private-block" },
      }],
      providerBlockPositions: [0],
      providerMessageBlockCounts: [1],
      totalPartCount: 2,
    };
    let capturedConfig:
      | (Agent["config"] & {
        __vfProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
        __vfProviderReplayCheckpointMessageId?: string;
        __vfPersistProviderReplayCheckpoint?: (
          value: ProviderReplayCheckpoint,
        ) => void | Promise<void>;
        __vfProviderReplayCheckpointTurnComplete?: () => void | Promise<void>;
      })
      | undefined;
    const persistedCheckpoints: ProviderReplayCheckpoint[] = [];
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: "test",
      threadId: crypto.randomUUID(),
      runId: "run_1",
      messageId,
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      providerReplayCheckpointEmissionEnabled: true,
      providerReplayCheckpoints: [],
      persistProviderReplayCheckpoint: (value) => {
        persistedCheckpoints.push(value);
        return Promise.resolve();
      },
      createRuntime: (runtimeAgent) => {
        capturedConfig = runtimeAgent.config as typeof capturedConfig;
        return {
          stream: async () => {
            await capturedConfig?.__vfPersistProviderReplayCheckpoint?.(checkpoint);
            await capturedConfig?.__vfProviderReplayCheckpointTurnComplete?.();
            return new ReadableStream<Uint8Array>({
              start(controller) {
                controller.close();
              },
            });
          },
        };
      },
    });
    const frames = parseSseFrames(await response.text());

    assertEquals(response.headers.get(PROVIDER_REPLAY_PROTOCOL_HEADER), "1");
    assertEquals(capturedConfig?.__vfProviderReplayCheckpointMessageId, messageId);
    assertEquals(capturedConfig?.__vfProviderReplayCheckpoints, undefined);
    assertEquals(persistedCheckpoints, [checkpoint]);
    assertEquals(JSON.stringify(frames).includes("signed-private-block"), false);
    assertEquals(
      frames.some((frame) => frame.event === PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME),
      true,
    );
    assertEquals(
      frames.findIndex((frame) => frame.event === PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME) <
        frames.findIndex((frame) => frame.event === "RunError"),
      true,
    );
  });

  it("continues checkpoint emission after the host gate is disabled", async () => {
    const sessionManager = new AgentRunSessionManager();
    const messageId = crypto.randomUUID();
    const checkpoint: ProviderReplayCheckpoint = {
      version: 1,
      messageId,
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: "existing-signature" },
      }],
      providerBlockPositions: [0],
      providerMessageBlockCounts: [1],
      totalPartCount: 1,
    };
    let persistCheckpoint:
      | ((value: ProviderReplayCheckpoint) => void | Promise<void>)
      | undefined;
    let completeProviderReplayTurn: (() => void | Promise<void>) | undefined;
    const persistedCheckpoints: ProviderReplayCheckpoint[] = [];
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;

    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messageId,
        messages: [],
        tools: [],
        context: [],
      },
      agent,
      {
        sessionManager,
        providerReplayCheckpointEmissionEnabled: false,
        providerReplayCheckpoints: [checkpoint],
        persistProviderReplayCheckpoint: (value) => {
          persistedCheckpoints.push(value);
          return Promise.resolve();
        },
        createRuntime: (runtimeAgent) => {
          persistCheckpoint = (runtimeAgent.config as Agent["config"] & {
            __vfPersistProviderReplayCheckpoint?: (
              value: ProviderReplayCheckpoint,
            ) => void | Promise<void>;
            __vfProviderReplayCheckpointTurnComplete?: () => void | Promise<void>;
          }).__vfPersistProviderReplayCheckpoint;
          completeProviderReplayTurn = (runtimeAgent.config as Agent["config"] & {
            __vfProviderReplayCheckpointTurnComplete?: () => void | Promise<void>;
          }).__vfProviderReplayCheckpointTurnComplete;
          return {
            stream: async () => {
              await persistCheckpoint?.(checkpoint);
              await completeProviderReplayTurn?.();
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              });
            },
          };
        },
      },
    );
    const frames = parseSseFrames(await response.text());

    assertEquals(typeof persistCheckpoint, "function");
    assertEquals(typeof completeProviderReplayTurn, "function");
    assertEquals(persistedCheckpoints, [checkpoint]);
    assertEquals(JSON.stringify(frames).includes("existing-signature"), false);
  });

  it("holds tool dispatch until durable persistence and the turn boundary complete", async () => {
    const sessionManager = new AgentRunSessionManager();
    const messageId = crypto.randomUUID();
    const checkpoint: ProviderReplayCheckpoint = {
      version: 1,
      messageId,
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: "ordered-signature" },
      }],
      providerBlockPositions: [0],
      providerMessageBlockCounts: [1],
      totalPartCount: 1,
    };
    let runtimeConfig:
      | (Agent["config"] & {
        __vfPersistProviderReplayCheckpoint?: (
          value: ProviderReplayCheckpoint,
        ) => void | Promise<void>;
        __vfProviderReplayCheckpointTurnComplete?: () => void | Promise<void>;
      })
      | undefined;
    const operations: string[] = [];
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;

    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messageId,
        messages: [],
        tools: [],
        context: [],
      },
      agent,
      {
        sessionManager,
        providerReplayCheckpointEmissionEnabled: true,
        persistProviderReplayCheckpoint: async () => {
          operations.push("persist:start");
          await Promise.resolve();
          operations.push("persist:done");
        },
        createRuntime: (runtimeAgent) => {
          runtimeConfig = runtimeAgent.config as typeof runtimeConfig;
          return {
            stream: async () =>
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      'data: {"type":"step-start"}\n\ndata: {"type":"tool-input-start","toolCallId":"tool-1","toolName":"lookup"}\n\ndata: {"type":"tool-input-available","toolCallId":"tool-1","toolName":"lookup","input":{}}\n\n',
                    ),
                  );
                  setTimeout(async () => {
                    await runtimeConfig?.__vfPersistProviderReplayCheckpoint?.(checkpoint);
                    await runtimeConfig?.__vfProviderReplayCheckpointTurnComplete?.();
                    controller.close();
                  }, 0);
                },
              }),
          };
        },
      },
    );
    const frames = parseSseFrames(await response.text());

    assertEquals(operations, ["persist:start", "persist:done"]);
    assertEquals(
      frames.findIndex((frame) => frame.event === PROVIDER_REPLAY_TURN_COMPLETE_SSE_EVENT_NAME) <
        frames.findIndex((frame) => frame.event === "ToolCallEnd"),
      true,
    );
    assertEquals(JSON.stringify(frames).includes("ordered-signature"), false);
  });

  it("fails closed when checkpoint emission has no runtime message identity", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;

    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(
          {
            threadId: crypto.randomUUID(),
            runId: "run_1",
            messages: [],
            tools: [],
            context: [],
          },
          agent,
          {
            sessionManager,
            providerReplayCheckpointEmissionEnabled: true,
          },
        ),
      Error,
      "Provider replay checkpoint emission requires a runtime message identity",
    );
  });

  it("fails before provider execution when no trusted checkpoint writer is available", async () => {
    const sessionManager = new AgentRunSessionManager();
    let runtimeCreated = false;
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;

    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(
          {
            threadId: crypto.randomUUID(),
            runId: "run_1",
            messageId: crypto.randomUUID(),
            messages: [],
            tools: [],
            context: [],
          },
          agent,
          {
            sessionManager,
            providerReplayCheckpointEmissionEnabled: true,
            createRuntime: () => {
              runtimeCreated = true;
              throw new Error("runtime must not be created");
            },
          },
        ),
      Error,
      "trusted run-event append token",
    );
    assertEquals(runtimeCreated, false);
  });

  it("settles an open replay turn when the provider stream fails", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;

    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messageId: crypto.randomUUID(),
        messages: [],
        tools: [],
        context: [],
      },
      agent,
      {
        sessionManager,
        providerReplayCheckpointEmissionEnabled: true,
        persistProviderReplayCheckpoint: () => Promise.resolve(),
        createRuntime: () => ({
          stream: async () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"step-start"}\n\ndata: {"type":"error","error":"provider stream failed"}\n\n',
                  ),
                );
                controller.close();
              },
            }),
        }),
      },
    );

    const body = await response.text();

    assertStringIncludes(body, "event: RunError");
    assertEquals(body.includes("event: RunFinished"), false);
  });

  for (const lifecycleMode of ["legacy", "active"] as const) {
    it(`preserves a structured provider error through the ${lifecycleMode} runtime and hosted AG-UI boundary`, async () => {
      const sessionManager = new AgentRunSessionManager();
      const previousLifecycleMode = Deno.env.get("VF_STREAM_LIFECYCLE_MODE");
      Deno.env.set("VF_STREAM_LIFECYCLE_MODE", lifecycleMode);
      const providerError = new Error("Provider request failed with status 402");
      Object.defineProperty(providerError, "responseBody", {
        value: JSON.stringify({
          slug: "insufficient-credits",
          error: "AI credit limit exceeded",
          suggestion: "Purchase additional credits or select a lower-cost model.",
          privateDetail: "provider-private-diagnostic",
        }),
      });
      const unregister = registerModelProvider(`issue-192-${lifecycleMode}`, () => ({
        provider: `issue-192-${lifecycleMode}`,
        modelId: `issue-192-${lifecycleMode}/terminal-error`,
        doGenerate: () => Promise.reject(new Error("generate must not be called")),
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream<unknown>({
              start(controller) {
                controller.error(providerError);
              },
            }),
          }),
      }));

      try {
        const runtimeAgent = createAgent({
          id: `issue-192-${lifecycleMode}-runtime-error`,
          model: `issue-192-${lifecycleMode}/terminal-error`,
          system: "Reply to the user.",
          skills: false,
        });
        const response = await createRuntimeAgentStreamResponse(
          {
            threadId: crypto.randomUUID(),
            runId: `run_issue_192_${lifecycleMode}`,
            messages: [{ id: "message-1", role: "user", content: "Hello" }],
            tools: [],
            context: [],
          },
          runtimeAgent,
          { sessionManager },
        );
        const frames = parseSseFrames(await response.text());
        const stepStartedIndex = frames.findIndex((frame) => frame.event === "StepStarted");
        const runErrorIndex = frames.findIndex((frame) => frame.event === "RunError");
        const runError = frames[runErrorIndex]?.data as Record<string, unknown> | undefined;

        assertEquals(stepStartedIndex >= 0, true);
        assertEquals(runErrorIndex > stepStartedIndex, true);
        assertEquals(
          runError?.message,
          "Purchase additional credits or select a lower-cost model.",
        );
        assertEquals(runError?.code, "INSUFFICIENT_CREDITS");
        assertEquals(JSON.stringify(runError).includes("provider-private-diagnostic"), false);
        assertEquals(frames.some((frame) => frame.event === "RunFinished"), false);
      } finally {
        unregister();
        if (previousLifecycleMode === undefined) Deno.env.delete("VF_STREAM_LIFECYCLE_MODE");
        else Deno.env.set("VF_STREAM_LIFECYCLE_MODE", previousLifecycleMode);
      }
    });
  }

  it("releases a pending tool boundary when the runtime turn fails", async () => {
    const sessionManager = new AgentRunSessionManager();
    let failProviderReplayTurn: (() => void | Promise<void>) | undefined;
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;

    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messageId: crypto.randomUUID(),
        messages: [],
        tools: [],
        context: [],
      },
      agent,
      {
        sessionManager,
        providerReplayCheckpointEmissionEnabled: true,
        persistProviderReplayCheckpoint: () => Promise.resolve(),
        createRuntime: (runtimeAgent) => {
          failProviderReplayTurn = (runtimeAgent.config as Agent["config"] & {
            __vfProviderReplayCheckpointTurnFailed?: () => void | Promise<void>;
          }).__vfProviderReplayCheckpointTurnFailed;
          return {
            stream: async () =>
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      'data: {"type":"step-start"}\n\ndata: {"type":"tool-input-start","toolCallId":"tool-1","toolName":"lookup"}\n\ndata: {"type":"tool-input-available","toolCallId":"tool-1","toolName":"lookup","input":{}}\n\n',
                    ),
                  );
                  setTimeout(async () => {
                    await failProviderReplayTurn?.();
                    controller.enqueue(
                      new TextEncoder().encode(
                        'data: {"type":"error","error":"provider stream failed"}\n\n',
                      ),
                    );
                    controller.close();
                  }, 0);
                },
              }),
          };
        },
      },
    );

    const body = await response.text();

    assertStringIncludes(body, "event: RunError");
    assertEquals(body.includes("event: RunFinished"), false);
  });

  it("aborts a pending replay boundary when the run is cancelled", async () => {
    const sessionManager = new AgentRunSessionManager();
    let runtimeCancelCalls = 0;
    const runId = "run_cancel_pending_replay";
    const agent = {
      id: "test",
      config: {
        id: "test",
        model: "anthropic/claude-opus-4-8",
        system: "test",
      },
    } as unknown as Agent;
    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId,
        messageId: crypto.randomUUID(),
        messages: [],
        tools: [],
        context: [],
      },
      agent,
      {
        sessionManager,
        providerReplayCheckpointEmissionEnabled: true,
        persistProviderReplayCheckpoint: () => Promise.resolve(),
        createRuntime: () => ({
          stream: async () =>
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"type":"step-start"}\n\ndata: {"type":"tool-input-start","toolCallId":"tool-1","toolName":"lookup"}\n\ndata: {"type":"tool-input-available","toolCallId":"tool-1","toolName":"lookup","input":{}}\n\n',
                  ),
                );
              },
              cancel() {
                runtimeCancelCalls++;
              },
            }),
        }),
      },
    );

    const body = response.text();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(sessionManager.cancelRun(runId), true);
    await body;

    assertEquals(runtimeCancelCalls, 1);
    assertEquals(sessionManager.getRunStatus(runId), null);
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

    const system = await resolveTestAgentSystem(capturedAgent?.config.system);
    assertEquals(Array.isArray(system), true);
    if (!Array.isArray(system)) {
      throw new Error("Expected structured internal run system messages");
    }
    assertEquals(system[0]?.providerOptions, {
      anthropic: { cacheControl: { type: "ephemeral" } },
    });
    const prompt = flattenSystemInstructions(system);
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

  it("preserves an agent factory marker through internal runtime dispatch", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedSystem: Agent["config"]["system"] | undefined;
    const runtimeAgent = createAgent({
      id: "marker-agent",
      model: "anthropic/claude-opus-4-6",
      skills: false,
      environmentContext: "Factory environment context.",
      system: [{
        role: "system",
        content:
          `Instructions before.\n\n${DEFAULT_RUNTIME_AGENT_CONTEXT_MARKER}\n\nInstructions after.`,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      }],
    });
    const input = {
      agentId: runtimeAgent.id,
      threadId: crypto.randomUUID(),
      runId: "run_marker_agent",
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, runtimeAgent, {
      sessionManager,
      projectAgentSandbox: { projectId: "project-1" },
      createRuntime: (agent) => {
        capturedSystem = agent.config.system;
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

    const resolvedSystem = await resolveTestAgentSystem(capturedSystem);
    assertEquals(Array.isArray(resolvedSystem), true);
    if (!Array.isArray(resolvedSystem)) {
      throw new Error("Expected structured internal runtime system messages");
    }
    assertEquals(resolvedSystem[0]?.content, "Instructions before.");
    const projectIndex = resolvedSystem.findIndex((message) =>
      message.content.includes('project_reference: "project-1"')
    );
    const factoryContextIndex = resolvedSystem.findIndex((message) =>
      message.content.includes("Factory environment context.")
    );
    const authoredTailIndex = resolvedSystem.findIndex((message) =>
      message.content.includes("Instructions after.")
    );
    assertEquals(projectIndex > 0 && projectIndex < authoredTailIndex, true);
    assertEquals(factoryContextIndex > 0 && factoryContextIndex < authoredTailIndex, true);
    assertEquals(
      flattenSystemInstructions(resolvedSystem).split("Instructions after.").length - 1,
      1,
    );
  });

  it("keeps structured cache metadata through internal runtime dispatch", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedSystem: Agent["config"]["system"] | undefined;
    const agent = {
      id: "structured-system-agent",
      config: {
        id: "structured-system-agent",
        model: "anthropic/claude-opus-4-6",
        system: [{
          role: "system",
          content: "Shared internal instructions.",
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
          },
        }],
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
      threadId: crypto.randomUUID(),
      runId: "run_structured_system",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: (runtimeAgent) => {
        capturedSystem = runtimeAgent.config.system;
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

    const resolvedSystem = await resolveTestAgentSystem(capturedSystem);
    assertEquals(Array.isArray(resolvedSystem), true);
    if (!Array.isArray(resolvedSystem)) {
      throw new Error("Expected structured internal runtime system messages");
    }
    assertEquals(resolvedSystem[0], {
      role: "system",
      content: "Shared internal instructions.",
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
      },
    });
  });

  it("uses the effective runtime provider key during internal runtime dispatch", async () => {
    let observedSystem: unknown;
    let authoredSystemCalls = 0;
    let modelTransportCalls = 0;
    const model: ModelRuntime = {
      provider: "AWS-Anthropic",
      modelId: "claude-sonnet",
      // deno-lint-ignore require-await
      async doGenerate() {
        throw new Error("Internal streaming must not use generate");
      },
      // deno-lint-ignore require-await
      async doStream(options: unknown) {
        observedSystem = (options as {
          prompt?: Array<{ role?: string; content?: unknown; providerOptions?: unknown }>;
        }).prompt?.filter((message) => message.role === "system");
        return {
          stream: new ReadableStream<unknown>({
            start(controller) {
              controller.enqueue({ type: "finish", finishReason: "stop" });
              controller.close();
            },
          }),
        };
      },
    } as unknown as ModelRuntime;
    const unregister = registerModelProvider("bedrock", () => model);

    try {
      const runtimeAgent = createAgent({
        id: "internal-runtime-provider-key",
        model: "bedrock/claude-sonnet",
        system: () => {
          authoredSystemCalls += 1;
          return Promise.resolve([{
            role: "system" as const,
            content: "Shared internal instructions.",
            providerOptions: {
              "AWS-Anthropic": { cacheControl: { type: "ephemeral" as const, ttl: "1h" as const } },
            },
          }, {
            role: "system" as const,
            content: "Authored dynamic instructions.",
          }]);
        },
        resolveModelTransport: () => {
          modelTransportCalls += 1;
          return Promise.resolve({ model });
        },
        skills: false,
      });
      const response = await createRuntimeAgentStreamResponse(
        {
          agentId: runtimeAgent.id,
          threadId: crypto.randomUUID(),
          runId: "run_runtime_provider_key",
          messages: [],
          tools: [],
          context: [],
        } as Parameters<typeof createRuntimeAgentStreamResponse>[0],
        runtimeAgent,
        {
          sessionManager: new AgentRunSessionManager(),
        },
      );
      await response.text();

      assertEquals(authoredSystemCalls, 1);
      assertEquals(modelTransportCalls, 1);
      if (!Array.isArray(observedSystem)) {
        throw new Error("Expected the model runtime to receive system messages");
      }
      assertEquals(observedSystem.slice(0, 2), [{
        role: "system",
        content: "Shared internal instructions.",
        providerOptions: {
          "AWS-Anthropic": { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      }, {
        role: "system",
        content: "Authored dynamic instructions.",
      }]);
      assertEquals(observedSystem[2]?.providerOptions, undefined);
    } finally {
      unregister();
    }
  });

  it("includes the resolved system prompt in message compaction overhead", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedMessages: AgentMessage[] = [];
    const agent = {
      id: "large-context-agent",
      config: {
        id: "large-context-agent",
        model: "anthropic/claude-opus-4-6",
        system: `System context\n${"s".repeat(120_000)}`,
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
      threadId: crypto.randomUUID(),
      runId: "run_compaction_overhead",
      messages: [
        {
          id: "oldest",
          role: "user",
          content: `oldest-turn\n${"a".repeat(200_000)}`,
        },
        {
          id: "middle",
          role: "user",
          content: `middle-turn\n${"b".repeat(200_000)}`,
        },
        {
          id: "latest",
          role: "user",
          content: `latest-turn\n${"c".repeat(200_000)}`,
        },
      ],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    const response = await createRuntimeAgentStreamResponse(input, agent, {
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
    });
    await response.text();

    const firstMessage = capturedMessages[0];
    assertEquals(firstMessage?.role, "user");
    const firstText = (firstMessage as unknown as {
      parts?: Array<{ type?: string; text?: string }>;
    })?.parts?.find((part) => part.type === "text")?.text;
    assertEquals(
      firstText?.startsWith("[Compressed: oldest-turn"),
      true,
    );
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

  it("filters source remote grants when forwarded grants are absent", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedToolNames: string[] = [];
    const agent = {
      id: "support-agent",
      config: {
        id: "support-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: { search_knowledge: false, get_file: true },
        __vfAllowedRemoteTools: ["search_knowledge", "get_file"],
        __vfRemoteToolSources: [{
          id: "veryfront-mcp",
          listTools: async () => [
            { name: "search_knowledge", description: "Search", parameters: {} },
            { name: "get_file", description: "Read", parameters: {} },
          ],
          executeTool: async () => ({}),
        }],
      },
    } as unknown as Agent;

    await createRuntimeAgentStreamResponse(
      {
        agentId: "support-agent",
        threadId: crypto.randomUUID(),
        runId: "run_1",
        messages: [],
        tools: [],
        context: [],
      } as Parameters<typeof createRuntimeAgentStreamResponse>[0],
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

    assertEquals(capturedAllowedRemoteTools, ["get_file"]);
    assertEquals(capturedToolNames, ["get_file"]);
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

  it("preserves skill runtime tools for every agent under toolAllowlist", async () => {
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
    const prompt = await getAgentSystemText(runtimeSystem);
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
    const prompt = await getAgentSystemText(runtimeSystem);
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

  it("caps providerTools to the toolAllowlist and explicit denials", async () => {
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
          web_search: false,
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
          toolAllowlist: ["read_baseline", "web_search"],
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

  it("keeps provider tools supported by the configured OpenAI model in the inventory", async () => {
    const sessionManager = new AgentRunSessionManager();
    let runtimeSystem: unknown;

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "openai/gpt-5.4-nano",
        system: "test",
        providerTools: ["web_search", "web_fetch"],
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

    const prompt = await getAgentSystemText(runtimeSystem);
    // OpenAI exposes a native web_search but no native web_fetch, so only the
    // supported half may reach the inventory.
    assertEquals(prompt.includes("- web_search"), true);
    assertEquals(prompt.includes("- web_fetch"), false);
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

    const prompt = await getAgentSystemText(runtimeSystem);
    assertStringIncludes(prompt, "- zzz_local");
    assertEquals(prompt.includes("- remote_127"), false);
  });

  it("withholds invoke_agent delegation for default-skilled agents with no visible skills", async () => {
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

    assertEquals(capturedToolNames, ["read_baseline"]);
  });

  it("withholds invoke_agent when the signed runtime request denies delegation", async () => {
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
      allowDelegation: false,
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
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
    });

    assertEquals(capturedToolNames, ["read_baseline"]);
  });

  it("strips invoke_agent from the remote tool grants when delegation is denied", async () => {
    const sessionManager = new AgentRunSessionManager();
    let capturedAllowedRemoteTools: string[] | undefined;
    let capturedToolNames: string[] = [];

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        __vfAllowedRemoteTools: ["invoke_agent"],
        tools: {
          read_baseline: { description: "Read the telemetry baseline" },
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
      allowDelegation: false,
      forwardedProps: {
        runtimeOverrides: {
          allowedTools: ["search_knowledge"],
        },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
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
    });

    assertEquals(
      capturedAllowedRemoteTools,
      ["search_knowledge"],
      "a signed request denying delegation must strip invoke_agent from the remote grants too",
    );
    assertEquals(capturedToolNames.includes("invoke_agent"), false);
  });

  it("preserves invoke_agent delegation when visible skills are hidden from the catalog", async () => {
    registerSkill("handoff", {
      id: "handoff",
      metadata: { name: "handoff", description: "Delegate safely" },
      rootPath: "/test/skills/handoff",
    });

    const sessionManager = new AgentRunSessionManager();
    let capturedToolNames: string[] = [];

    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        skills: [],
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

    assertEquals(capturedToolNames, ["invoke_agent", "read_baseline"]);
  });

  it("does not preserve caller-injected delegation across a hard tool allowlist", async () => {
    registerSkill("handoff", {
      id: "handoff",
      metadata: { name: "handoff", description: "Delegate safely" },
      rootPath: "/test/skills/handoff",
    });

    const sessionManager = new AgentRunSessionManager();
    let capturedToolNames: string[] = [];
    const agent = {
      id: "ops-agent",
      config: {
        id: "ops-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        skills: [],
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
      tools: [{
        name: "invoke_agent",
        description: "Caller-supplied delegation",
        parameters: { type: "object", properties: {} },
      }],
      context: [],
      forwardedProps: {
        runtimeOverrides: {
          toolAllowlist: ["read_baseline"],
        },
      },
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await createRuntimeAgentStreamResponse(input, agent, {
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
    });

    assertEquals(capturedToolNames, ["read_baseline"]);
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

  it("clears run admission when sandbox setup rejects", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "sandbox-failure-agent",
      config: {
        id: "sandbox-failure-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: { bash: true },
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
      threadId: crypto.randomUUID(),
      runId: "run_sandbox_setup_failure",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(input, agent, {
          sessionManager,
          createBashTool: (() => Promise.resolve({ tools: {} })) as CreateSandboxBashTool,
          createAgentServiceSandboxTools: () => Promise.reject(new Error("sandbox setup failed")),
        }),
      Error,
      "sandbox setup failed",
    );

    assertEquals(sessionManager.getRunStatus(input.runId), null);
  });

  it("closes an acquired sandbox once after runtime construction fails and permits retry", async () => {
    const sessionManager = new AgentRunSessionManager();
    let closeSandboxCalls = 0;
    const inputSchemaJson = {
      type: "object" as const,
      properties: {},
      additionalProperties: true,
    };
    const sandboxAgent = {
      id: "sandbox-runtime-failure-agent",
      config: {
        id: "sandbox-runtime-failure-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: { bash: true },
      },
    } as unknown as Agent;
    const input = {
      agentId: sandboxAgent.id,
      threadId: crypto.randomUUID(),
      runId: "run_runtime_setup_failure",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    await assertRejects(
      () =>
        createRuntimeAgentStreamResponse(input, sandboxAgent, {
          sessionManager,
          createBashTool: (() => Promise.resolve({ tools: {} })) as CreateSandboxBashTool,
          createAgentServiceSandboxTools: () =>
            Promise.resolve({
              tools: {
                bash: {
                  description: "Run bash",
                  inputSchemaJson,
                  execute: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
                },
              },
              sandbox: {} as AgentServiceSandboxToolsResult["sandbox"],
              closeSandbox: () => {
                closeSandboxCalls++;
                return Promise.resolve();
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
    assertEquals(closeSandboxCalls, 1);

    const retryAgent = {
      id: sandboxAgent.id,
      config: {
        id: sandboxAgent.id,
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const retryResponse = await createRuntimeAgentStreamResponse(input, retryAgent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.close();
            },
          }),
      }),
    });
    await retryResponse.text();

    assertEquals(sessionManager.getRunStatus(input.runId), null);
    assertEquals(closeSandboxCalls, 1);
  });

  it("rejects a locked runtime stream during setup and releases acquired resources", async () => {
    const sessionManager = new AgentRunSessionManager();
    let closeSandboxCalls = 0;
    const lockedStream = new ReadableStream<Uint8Array>();
    const lockedReader = lockedStream.getReader();
    const agent = {
      id: "locked-stream-agent",
      config: {
        id: "locked-stream-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
        tools: { bash: true },
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
      threadId: crypto.randomUUID(),
      runId: "run_locked_stream",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    try {
      await assertRejects(
        () =>
          createRuntimeAgentStreamResponse(input, agent, {
            sessionManager,
            createBashTool: (() => Promise.resolve({ tools: {} })) as CreateSandboxBashTool,
            createAgentServiceSandboxTools: () =>
              Promise.resolve({
                tools: {},
                sandbox: {} as AgentServiceSandboxToolsResult["sandbox"],
                closeSandbox: () => {
                  closeSandboxCalls++;
                  return Promise.resolve();
                },
              }),
            createRuntime: () => ({
              stream: () => Promise.resolve(lockedStream),
            }),
          }),
        TypeError,
        "Internal agent runtime returned a locked stream",
      );
    } finally {
      lockedReader.releaseLock();
    }

    assertEquals(sessionManager.getRunStatus(input.runId), null);
    assertEquals(closeSandboxCalls, 1);
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

    toolRegistryInternal.register("number-generator", projectTool);
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
      toolRegistryInternal.delete("number-generator");
    }

    assertEquals(capturedToolEntry, projectTool);
  });

  it("records completed runtime token usage on the agent.run span", async () => {
    const spans = installRecordingTracer();

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
                    [
                      'data: {"type":"message-start","messageId":"assistant-1"}',
                      'data: {"type":"text-start","id":"text-1"}',
                      'data: {"type":"text-delta","id":"text-1","delta":"done"}',
                      'data: {"type":"text-end","id":"text-1"}',
                      "",
                      "",
                    ].join("\n\n"),
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
  });

  it("records terminal runtime error events as failed instead of completed", async () => {
    const spans = installRecordingTracer();
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "failing-agent",
      config: {
        id: "failing-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
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
                  'data: {"type":"error","error":"provider stream failed"}\n\n',
                ),
              );
              controller.close();
            },
          }),
      }),
    });
    const body = await response.text();

    assertStringIncludes(body, "event: RunError");
    assertEquals(body.includes("event: RunFinished"), false);
    const runSpan = spans.find((span) => span.name === "agent.run");
    assertEquals(runSpan?.attributes["agent.run.final_status"], "failed");
    assertEquals(runSpan?.events.some((event) => event.name === "agent.run.failed"), true);
    assertEquals(runSpan?.events.some((event) => event.name === "agent.run.completed"), false);
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

  it("cancels and releases a runtime reader when the run is already aborted", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "pre-aborted-agent",
      config: {
        id: "pre-aborted-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
      threadId: crypto.randomUUID(),
      runId: "run_pre_aborted",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    let runtimeCancelCalls = 0;
    let runtimeStream: ReadableStream<Uint8Array> | undefined;

    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () => {
          sessionManager.cancelRun(input.runId);
          runtimeStream = new ReadableStream<Uint8Array>({
            cancel() {
              runtimeCancelCalls++;
            },
          });
          return runtimeStream;
        },
      }),
    });
    await response.text();

    assertEquals(runtimeCancelCalls, 1);
    assertEquals(runtimeStream?.locked, false);
    assertEquals(sessionManager.getRunStatus(input.runId), null);
  });

  it("logs an expected runtime cancellation as lifecycle info", async () => {
    const logs = captureConsoleJsonLogs();
    try {
      await withJsonDebugLogFormat(async () => {
        const sessionManager = new AgentRunSessionManager();
        const agent = {
          id: "cancelled-agent",
          config: {
            id: "cancelled-agent",
            model: "anthropic/claude-opus-4-6",
            system: "test",
          },
        } as unknown as Agent;
        const input = {
          agentId: agent.id,
          threadId: crypto.randomUUID(),
          runId: "run_cancelled",
          messages: [],
          tools: [],
          context: [],
        } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

        const response = await createRuntimeAgentStreamResponse(input, agent, {
          sessionManager,
          createRuntime: () => ({
            stream: async () => {
              sessionManager.cancelRun(input.runId);
              return new ReadableStream<Uint8Array>();
            },
          }),
        });
        await response.text();
      });
    } finally {
      logs.restore();
    }

    const entries = logs.getEntries();
    const cancellationEntry = entries.find((entry) =>
      entry.message === "Internal agent runtime session cancelled"
    );
    assertEquals(cancellationEntry?.level, "info");
    assertEquals(cancellationEntry?.context?.status, "cancelled");
    assertEquals(cancellationEntry?.context?.error, undefined);
    assertEquals(
      entries.find((entry) => entry.message === "Internal agent runtime stream aborted")?.level,
      "debug",
    );
    assertEquals(
      entries.some((entry) =>
        entry.level === "warn" && entry.message === "Internal agent runtime stream cancelled"
      ),
      false,
    );
  });

  it("cancels and releases a runtime reader after a non-EOF mapping failure", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "mapping-failure-agent",
      config: {
        id: "mapping-failure-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
      threadId: crypto.randomUUID(),
      runId: "run_mapping_failure",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    let runtimeCancelCalls = 0;
    let runtimeStream: ReadableStream<Uint8Array> | undefined;

    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () => {
          runtimeStream = new ReadableStream<Uint8Array>({
            pull(controller) {
              sessionManager.failRun(input.runId);
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"tool-input-start","toolCallId":"tool-1","toolName":"bash"}\n\n',
                ),
              );
            },
            cancel() {
              runtimeCancelCalls++;
            },
          });
          return runtimeStream;
        },
      }),
    });
    const body = await response.text();

    assertStringIncludes(body, "event: RunError");
    assertEquals(runtimeCancelCalls, 1);
    assertEquals(runtimeStream?.locked, false);
    assertEquals(sessionManager.getRunStatus(input.runId), null);
  });

  it("pre-registers the tool-result wait when a tool call starts streaming", async () => {
    const sessionManager = new AgentRunSessionManager();
    const agent = {
      id: "tool-wait-agent",
      config: {
        id: "tool-wait-agent",
        model: "anthropic/claude-opus-4-6",
        system: "test",
      },
    } as unknown as Agent;
    const input = {
      agentId: agent.id,
      threadId: crypto.randomUUID(),
      runId: "run_tool_wait",
      messages: [],
      tools: [],
      context: [],
    } as Parameters<typeof createRuntimeAgentStreamResponse>[0];

    let runtimeController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const response = await createRuntimeAgentStreamResponse(input, agent, {
      sessionManager,
      createRuntime: () => ({
        stream: async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              runtimeController = controller;
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"tool-input-start","toolCallId":"tool-1","toolName":"bash"}\n\n',
                ),
              );
            },
          }),
      }),
    });

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected a runtime response body");
    }

    const decoder = new TextDecoder();
    let streamed = "";
    while (!streamed.includes("event: ToolCallStart")) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      streamed += decoder.decode(chunk.value, { stream: true });
    }
    assertStringIncludes(streamed, "event: ToolCallStart");

    // A Studio client can POST its result before the runtime invokes the tool,
    // so the wait has to exist as soon as the frame reaches the client.
    let thrown: unknown;
    try {
      sessionManager.submitToolResult(input.runId, {
        toolCallId: "tool-1",
        result: { ok: true },
      });
    } catch (error) {
      thrown = error;
    }
    assertEquals(
      thrown,
      undefined,
      "the tool-result wait must be pre-registered when ToolCallStart is emitted",
    );

    runtimeController?.close();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
    }
    reader.releaseLock();
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

  it("debug logs runtime reader cancellation failures during cleanup", async () => {
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
      entry.message === "Internal agent runtime reader cancellation failed during cleanup"
    );
    assertEquals(debugEntry?.component, "internal-agent-run-stream");
  });
  describe("model call context", () => {
    const modelCallContextEvent = {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [{ role: "system", content: "test system prompt" }],
      tools: [{ type: "function", name: "granted_tool", inputSchema: {} }],
    };

    function contextAgent(): Agent {
      return {
        id: "context-agent",
        config: { id: "context-agent", model: "anthropic/claude-opus-4-6", system: "test" },
      } as unknown as Agent;
    }

    function contextRunInput(runId: string) {
      return {
        agentId: "context-agent",
        threadId: crypto.randomUUID(),
        runId,
        messages: [],
        tools: [],
        context: [],
      } as Parameters<typeof createRuntimeAgentStreamResponse>[0];
    }

    it("streams a context emitted while the runtime stream is created", async () => {
      let sinkDuringCreate: AgentRunEventSink | undefined;

      const response = await createRuntimeAgentStreamResponse(
        contextRunInput("run_context_setup"),
        contextAgent(),
        {
          sessionManager: new AgentRunSessionManager(),
          createRuntime: () => ({
            stream: async () => {
              // The real runtime dispatches its first model call here, so the
              // sink has to already be scoped by the time stream() runs.
              sinkDuringCreate = getActiveRunEventSinks().mandatory;
              await sinkDuringCreate?.(modelCallContextEvent as never);
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              });
            },
          }),
        },
      );

      const frames = parseSseFrames(await response.text());
      assertEquals(Boolean(sinkDuringCreate), true);
      const contextFrame = frames.find((frame) =>
        frame.event === MODEL_CALL_CONTEXT_SSE_EVENT_NAME
      );
      const contextEvent = contextFrame?.data as Record<string, unknown> | undefined;
      assertEquals(contextEvent?.type, modelCallContextEvent.type);
      assertEquals(contextEvent?.messages, modelCallContextEvent.messages);
      assertEquals(contextEvent?.tools, modelCallContextEvent.tools);
      assertEquals(
        typeof contextEvent?.elapsedMs === "number" &&
          Number.isFinite(contextEvent.elapsedMs) && contextEvent.elapsedMs >= 0,
        true,
      );
      assertEquals(
        typeof contextEvent?.emittedAt === "number" &&
          Number.isInteger(contextEvent.emittedAt) && contextEvent.emittedAt > 0,
        true,
      );
    });

    it("keeps the context ahead of the step it describes", async () => {
      const response = await createRuntimeAgentStreamResponse(
        contextRunInput("run_context_order"),
        contextAgent(),
        {
          sessionManager: new AgentRunSessionManager(),
          createRuntime: () => ({
            stream: async () => {
              await getActiveRunEventSinks().mandatory?.(modelCallContextEvent as never);
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              });
            },
          }),
        },
      );

      const names = parseSseFrames(await response.text()).map((frame) => frame.event);
      assertEquals(names[0], "RunStarted");
      assertEquals(names[1], MODEL_CALL_CONTEXT_SSE_EVENT_NAME);
    });

    it("streams a context emitted for a later step while the client reads", async () => {
      let sinkDuringConsume: AgentRunEventSink | undefined;

      const response = await createRuntimeAgentStreamResponse(
        contextRunInput("run_context_step_two"),
        contextAgent(),
        {
          sessionManager: new AgentRunSessionManager(),
          createRuntime: () => ({
            stream: async () =>
              new ReadableStream<Uint8Array>({
                // Multi-step runs dispatch later model calls as the stream is
                // pulled, long after stream() returned.
                async pull(controller) {
                  sinkDuringConsume = getActiveRunEventSinks().mandatory;
                  await sinkDuringConsume?.(modelCallContextEvent as never);
                  controller.close();
                },
              }),
          }),
        },
      );

      const frames = parseSseFrames(await response.text());
      assertEquals(Boolean(sinkDuringConsume), true);
      assertEquals(
        frames.filter((frame) => frame.event === MODEL_CALL_CONTEXT_SSE_EVENT_NAME).length,
        1,
      );
    });
  });
});

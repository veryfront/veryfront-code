import { assertEquals, assertRejects } from "@std/assert";
import type { HostToolSet } from "#veryfront/tool";
import {
  DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS,
  executeHostedChildForkToolInput,
  executeHostedChildForkWithPreparedTools,
} from "./child-fork-execution-runner.ts";
import { createHostedDurableChildForkRunContext } from "./child-fork-run-context.ts";
import type { AgentResponse } from "../schemas/index.ts";
import { UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE } from "../project/context.ts";
import {
  createHostedRunEventWriterCapability,
  getActiveHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import {
  getActiveRunEventSink,
  runWithRunEventSink,
} from "../../runtime/run-event-sink-context.ts";
import { streamText } from "../../runtime/runtime-bridge.ts";
import { createStreamModel } from "../../runtime/runtime-bridge.test-helpers.ts";
import type { ForkPart } from "../streaming/fork-runtime-stream.ts";
import type { AgentSystem } from "#veryfront/agent/types.ts";

function systemIncludes(system: AgentSystem, text: string): boolean {
  return typeof system === "string"
    ? system.includes(text)
    : system.some((message) => message.content.includes(text));
}

function withoutEventTiming(event: unknown): unknown {
  if (typeof event !== "object" || event === null) return event;
  const { elapsedMs: _elapsedMs, emittedAt: _emittedAt, ...semanticEvent } = event as Record<
    string,
    unknown
  >;
  return semanticEvent;
}

function createRuntimeEventStream(
  events: readonly Record<string, unknown>[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

function createResponse(): AgentResponse {
  return {
    text: "Done.",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: 2,
        parts: [{ type: "text", text: "Done." }],
      },
    ],
    toolCalls: [],
    status: "completed",
    metadata: { finishReason: "stop" },
  };
}

Deno.test("executeHostedChildForkWithPreparedTools returns a failure for unavailable tools", async () => {
  const result = await executeHostedChildForkWithPreparedTools({
    authToken: "token",
    apiUrl: "https://api.example.com",
    description: "Check the app",
    kind: "invoke_agent",
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4",
    maxSteps: 4,
    effectivePrompt: "Do the work.",
    toolAssembly: {
      ok: false,
      errorMessage: "Requested fork tools not available in runtime: bash",
    },
  });

  assertEquals(result.success, false);
  assertEquals(result.description, "Check the app");
  if (!result.success) {
    assertEquals(result.error, "Requested fork tools not available in runtime: bash");
  }
  assertEquals(result.steps, 0);
  assertEquals(result.toolCalls, []);
  assertEquals(result.toolResults, []);
});

Deno.test("executeHostedChildForkWithPreparedTools executes a prepared child fork and closes resources", async () => {
  let closeToolingCalls = 0;
  let closeRuntimeCalls = 0;
  const toolTraceSpans: string[] = [];
  const traceAttributes: Record<string, unknown>[] = [];
  const partTypes: string[] = [];
  const forkTools: HostToolSet = {
    noop: {
      description: "No-op tool",
      inputSchema: {},
      execute: () => "ok",
    },
  };

  const result = await executeHostedChildForkWithPreparedTools({
    authToken: "token",
    apiUrl: "https://api.example.com",
    projectId: "project-1",
    description: "Check the app",
    kind: "invoke_agent",
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4",
    temperature: 0.2,
    maxSteps: 4,
    effectivePrompt: "Do the work.",
    forkContext: {
      projectId: "project-1",
      branchId: "branch-1",
      availableSkillIds: ["design"],
    },
    toolAssembly: {
      ok: true,
      forkTools,
      availableToolNames: ["noop"],
      closeTooling: () => {
        closeToolingCalls += 1;
        return Promise.resolve();
      },
      closeRuntime: () => {
        closeRuntimeCalls += 1;
        return Promise.resolve();
      },
    },
    instrumentation: {
      trace: (spanName, operation) => {
        toolTraceSpans.push(spanName);
        return operation();
      },
      buildToolTraceAttributes: ({ toolName, toolCallId }) => ({
        toolName,
        toolCallId: toolCallId ?? null,
      }),
      setTraceAttributes: (attributes) => {
        traceAttributes.push(attributes);
      },
      tracePart: ({ partType }) => {
        partTypes.push(partType);
      },
    },
    runStep: async (input) => {
      assertEquals(input.model, "anthropic/claude-sonnet-4");
      assertEquals(input.temperature, 0.2);
      assertEquals(input.forkToolNames, ["noop"]);
      assertEquals(input.providerOptions, undefined);
      assertEquals(systemIncludes(input.system, 'project_reference: "project-1"'), true);
      assertEquals(systemIncludes(input.system, "Available Skills"), true);
      return {
        stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
        responsePromise: Promise.resolve(createResponse()),
      };
    },
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.summary.text, "Done.");
  }
  assertEquals(partTypes, ["text-delta"]);
  assertEquals(toolTraceSpans, []);
  assertEquals(traceAttributes, []);
  assertEquals(closeToolingCalls, 1);
  assertEquals(closeRuntimeCalls, 1);
});

Deno.test("executeHostedChildForkWithPreparedTools allows injecting the runtime starter", async () => {
  let startRuntimeCalls = 0;
  const sourceIntegrationPolicy = {
    schemaVersion: 1 as const,
    mode: "allowlist" as const,
    integrations: { gmail: { allowedToolIds: ["list_emails"] } },
  };
  const result = await executeHostedChildForkWithPreparedTools({
    authToken: "token",
    apiUrl: "https://api.example.com",
    description: "Check the app",
    kind: "invoke_agent",
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4",
    maxSteps: 4,
    effectivePrompt: "Do the work.",
    sourceIntegrationPolicy,
    toolAssembly: {
      ok: true,
      forkTools: {},
      availableToolNames: [],
    },
    startRuntime: (input) => {
      startRuntimeCalls += 1;
      assertEquals(input.forkModel, "anthropic/claude-sonnet-4");
      assertEquals(input.sourceIntegrationPolicy, sourceIntegrationPolicy);
      return {
        forkStreamAbortController: new AbortController(),
        childRunMonitorAbortController: null,
        childRunMonitorPromise: Promise.resolve(),
        forkToolNames: [],
        streamResult: {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "Injected." } as const;
          })(),
          steps: Promise.resolve([
            {
              text: "Injected.",
              finishReason: "stop",
              messages: [],
              toolCalls: [],
              toolResults: [],
            },
          ]),
          totalUsage: Promise.resolve(undefined),
        },
      };
    },
  });

  assertEquals(startRuntimeCalls, 1);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.summary.text, "Injected.");
  }
});

Deno.test("executeHostedChildForkWithPreparedTools clears writer authority before provider dispatch", async () => {
  const capability = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example.com",
    runId: "run-parent",
    runEventAppendToken: "parent-writer-token",
  });
  let authorityDuringDispatch: unknown;

  const result = await runWithHostedRunEventWriterCapability(
    capability,
    () =>
      executeHostedChildForkWithPreparedTools({
        authToken: "user-token",
        apiUrl: "https://api.example.com",
        description: "Check the app",
        kind: "invoke_agent",
        provider: "anthropic",
        forkModel: "anthropic/claude-sonnet-4",
        maxSteps: 4,
        effectivePrompt: "Do the work.",
        toolAssembly: {
          ok: true,
          forkTools: {},
          availableToolNames: [],
        },
        startRuntime: () => {
          authorityDuringDispatch = getActiveHostedRunEventWriterCapability();
          return {
            forkStreamAbortController: new AbortController(),
            childRunMonitorAbortController: null,
            childRunMonitorPromise: Promise.resolve(),
            forkToolNames: [],
            streamResult: {
              fullStream: (async function* () {
                yield { type: "text-delta", text: "Done." } as const;
              })(),
              steps: Promise.resolve([{
                text: "Done.",
                finishReason: "stop",
                messages: [],
                toolCalls: [],
                toolResults: [],
              }]),
              totalUsage: Promise.resolve(undefined),
            },
          };
        },
      }),
  );

  assertEquals(result.success, true);
  assertEquals(authorityDuringDispatch, undefined);
});

Deno.test("executeHostedChildForkWithPreparedTools fails closed before provider dispatch without a child writer token", async () => {
  let startRuntimeCalls = 0;
  const result = await executeHostedChildForkWithPreparedTools({
    authToken: "user-token",
    apiUrl: "https://api.example.com",
    description: "Check the app",
    kind: "invoke_agent",
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4",
    maxSteps: 4,
    effectivePrompt: "Do the work.",
    durableChildRun: {
      childConversationId: "11111111-1111-4111-a111-111111111111",
      childRunId: "child-run-scoped",
      childMessageId: "22222222-2222-4222-a222-222222222222",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    },
    toolAssembly: {
      ok: true,
      forkTools: {},
      availableToolNames: [],
    },
    startRuntime: () => {
      startRuntimeCalls += 1;
      throw new Error("provider dispatch must not start");
    },
  });

  assertEquals(startRuntimeCalls, 0);
  assertEquals(result.success, false);
  if (!result.success) {
    assertEquals(result.error, "Durable hosted child run requires an event mirror");
  }
});

for (
  const [authorityKind, capabilityRunId] of [
    ["parent", "parent-run-scoped"],
    ["sibling", "sibling-run-scoped"],
  ] as const
) {
  Deno.test(`executeHostedChildForkWithPreparedTools rejects ${authorityKind} authority before provider dispatch`, async () => {
    let startRuntimeCalls = 0;
    const result = await executeHostedChildForkWithPreparedTools({
      authToken: "user-token",
      apiUrl: "https://api.example.com",
      runEventWriterCapability: createHostedRunEventWriterCapability({
        apiUrl: "https://api.example.com",
        runId: capabilityRunId,
        runEventAppendToken: "wrong-run-writer-token",
      }),
      description: "Check the app",
      kind: "invoke_agent",
      provider: "anthropic",
      forkModel: "anthropic/claude-sonnet-4",
      maxSteps: 4,
      effectivePrompt: "Do the work.",
      durableChildRun: {
        childConversationId: "11111111-1111-4111-a111-111111111111",
        childRunId: "target-child-run-scoped",
        childMessageId: "22222222-2222-4222-a222-222222222222",
        latestEventId: 0,
        latestExternalEventSequence: 0,
      },
      toolAssembly: {
        ok: true,
        forkTools: {},
        availableToolNames: [],
      },
      startRuntime: () => {
        startRuntimeCalls += 1;
        throw new Error("provider dispatch must not start");
      },
    });

    assertEquals(startRuntimeCalls, 0);
    assertEquals(result.success, false);
    if (!result.success) {
      assertEquals(result.error, "Durable hosted child run requires an event mirror");
    }
  });
}

Deno.test("executeHostedChildForkWithPreparedTools preserves the mandatory sink through middleware next()", async () => {
  let createRunContextCalls = 0;
  let activeDuringStart = false;
  let activeDuringIteration = false;
  const persisted: unknown[] = [];
  const observed: unknown[] = [];
  const order: string[] = [];
  const model = createStreamModel("test", "test/hosted-child", async () => {
    order.push("dispatch");
    return {
      stream: ReadableStream.from([
        { type: "text-delta", delta: "Injected context." },
        { type: "finish", finishReason: "stop", usage: {} },
      ]),
    };
  });
  const result = await executeHostedChildForkWithPreparedTools({
    authToken: "token",
    apiUrl: "https://api.example.com",
    description: "Check the app",
    kind: "invoke_agent",
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4",
    maxSteps: 4,
    effectivePrompt: "Do the work.",
    toolAssembly: {
      ok: true,
      forkTools: {},
      availableToolNames: [],
    },
    durableChildRun: {
      childConversationId: "11111111-1111-4111-a111-111111111111",
      childRunId: "child-run-scoped",
      childMessageId: "22222222-2222-4222-a222-222222222222",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    },
    createRunContext: (input) => {
      createRunContextCalls += 1;
      assertEquals(input.authToken, "token");
      assertEquals("runEventAppendToken" in input, false);
      assertEquals("runEventWriterCapability" in input, false);
      assertEquals(input.apiUrl, "https://api.example.com");
      const context = createHostedDurableChildForkRunContext({
        instrumentation: input.instrumentation,
        pendingToolLogContext: {
          conversationId: input.conversationId,
          parentRunId: input.parentRunId,
          description: input.description,
        },
        pendingToolLogWriter: input.pendingToolLogWriter,
      });
      const quiescentSnapshot = {
        latestEventId: 0,
        latestExternalEventSequence: 0,
        pendingEventCount: 0,
        consecutiveFailures: 0,
        disabled: false,
        hasFlushTimer: false,
        hasRetryTimer: false,
        inFlight: false,
      };
      return {
        ...context,
        durableRunMirror: {
          handleChunk: async () => {},
          appendEvents: async (events) => {
            order.push("append");
            persisted.push(...events);
          },
          flush: async () => {
            order.push("flush");
            return quiescentSnapshot;
          },
          getSnapshot: () => quiescentSnapshot,
          dispose: () => {},
        },
      };
    },
    startRuntime: (input) => {
      assertEquals(input.authToken, "token");
      activeDuringStart = getActiveRunEventSink() !== undefined;
      const next = () =>
        streamText({
          model,
          system: "Hosted child instructions",
          messages: [{ role: "user", content: "Run child" }],
        });
      const stream = runWithRunEventSink(
        (event) => {
          order.push("observe");
          observed.push(event);
        },
        next,
      );
      return {
        forkStreamAbortController: new AbortController(),
        childRunMonitorAbortController: null,
        childRunMonitorPromise: Promise.resolve(),
        forkToolNames: [],
        streamResult: {
          fullStream: (async function* () {
            activeDuringIteration = getActiveRunEventSink() !== undefined;
            for await (const part of stream.fullStream) {
              yield part as ForkPart;
            }
          })(),
          steps: Promise.resolve([
            {
              text: "Injected context.",
              finishReason: "stop",
              messages: [],
              toolCalls: [],
              toolResults: [],
            },
          ]),
          totalUsage: Promise.resolve(undefined),
        },
      };
    },
  });

  assertEquals(createRunContextCalls, 1);
  assertEquals(activeDuringStart, true);
  assertEquals(activeDuringIteration, true);
  assertEquals(order.slice(0, 4), ["append", "flush", "observe", "dispatch"]);
  assertEquals(persisted.map(withoutEventTiming), [{
    type: "AGENT_RUN_MODEL_CALL_CONTEXT",
    messages: [
      { role: "system", content: "Hosted child instructions" },
      { role: "user", content: [{ type: "text", text: "Run child" }] },
    ],
    model: {
      id: "test/hosted-child",
      modelProvider: "test",
    },
  }]);
  const persistedContext = persisted[0] as Record<string, unknown> | undefined;
  assertEquals(
    typeof persistedContext?.elapsedMs === "number" &&
      Number.isFinite(persistedContext.elapsedMs) && persistedContext.elapsedMs >= 0,
    true,
  );
  assertEquals(
    typeof persistedContext?.emittedAt === "number" &&
      Number.isInteger(persistedContext.emittedAt) && persistedContext.emittedAt > 0,
    true,
  );
  assertEquals(observed, persisted.map(withoutEventTiming));
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.summary.text, "Injected context.");
  }
});

Deno.test("executeHostedChildForkWithPreparedTools drains queued child events before a subsequent model dispatch", async () => {
  let pendingEventCount = 0;
  let dispatches = 0;
  let queueChildEvent = () => {};
  const persisted: unknown[] = [];
  const order: string[] = [];
  const model = createStreamModel("test", "test/hosted-child-two-step", async () => {
    dispatches += 1;
    order.push(`dispatch-${dispatches}`);
    return {
      stream: ReadableStream.from([
        { type: "text-delta", delta: `step ${dispatches}` },
        { type: "finish", finishReason: "stop", usage: {} },
      ]),
    };
  });
  const result = await executeHostedChildForkWithPreparedTools({
    authToken: "token",
    apiUrl: "https://api.example.com",
    description: "Check two steps",
    kind: "invoke_agent",
    provider: "anthropic",
    forkModel: "anthropic/claude-sonnet-4",
    maxSteps: 4,
    effectivePrompt: "Do the work.",
    toolAssembly: { ok: true, forkTools: {}, availableToolNames: [] },
    durableChildRun: {
      childConversationId: "11111111-1111-4111-a111-111111111111",
      childRunId: "child-run-two-step",
      childMessageId: "22222222-2222-4222-a222-222222222222",
      latestEventId: 0,
      latestExternalEventSequence: 0,
    },
    createRunContext: (input) => {
      const context = createHostedDurableChildForkRunContext({
        instrumentation: input.instrumentation,
        pendingToolLogContext: {
          conversationId: input.conversationId,
          parentRunId: input.parentRunId,
          description: input.description,
        },
        pendingToolLogWriter: input.pendingToolLogWriter,
      });
      const getSnapshot = () => ({
        latestEventId: 0,
        latestExternalEventSequence: 0,
        pendingEventCount,
        consecutiveFailures: 0,
        disabled: false,
        hasFlushTimer: pendingEventCount > 0,
        hasRetryTimer: false,
        inFlight: false,
      });
      queueChildEvent = () => {
        pendingEventCount += 1;
        order.push("queue-child");
      };
      return {
        ...context,
        durableRunMirror: {
          handleChunk: async () => {
            pendingEventCount += 1;
            order.push("queue-child");
          },
          appendEvents: async (events) => {
            pendingEventCount += events.length;
            persisted.push(...events);
            order.push("append-context");
          },
          flush: async () => {
            order.push("flush");
            pendingEventCount = 0;
            return getSnapshot();
          },
          getSnapshot,
          dispose: () => {},
        },
      };
    },
    startRuntime: () => {
      const first = streamText({
        model,
        messages: [{ role: "user", content: "First child step" }],
      });
      return {
        forkStreamAbortController: new AbortController(),
        childRunMonitorAbortController: null,
        childRunMonitorPromise: Promise.resolve(),
        forkToolNames: [],
        streamResult: {
          fullStream: (async function* () {
            for await (const part of first.fullStream) yield part as ForkPart;
            queueChildEvent();
            const second = streamText({
              model,
              messages: [{ role: "user", content: "Second child step" }],
            });
            for await (const part of second.fullStream) yield part as ForkPart;
          })(),
          steps: Promise.resolve([
            { text: "step 1", finishReason: "stop", messages: [], toolCalls: [], toolResults: [] },
            { text: "step 2", finishReason: "stop", messages: [], toolCalls: [], toolResults: [] },
          ]),
          totalUsage: Promise.resolve(undefined),
        },
      };
    },
  });

  assertEquals(result.success, true);
  assertEquals(dispatches, 2);
  assertEquals(
    persisted.filter((event) =>
      (event as { type?: string }).type === "AGENT_RUN_MODEL_CALL_CONTEXT"
    ).length,
    2,
  );
  const secondDispatch = order.indexOf("dispatch-2");
  const secondContextFlush = order.lastIndexOf("flush", secondDispatch);
  const secondContextAppend = order.lastIndexOf("append-context", secondContextFlush);
  const priorEventFlush = order.lastIndexOf("flush", secondContextAppend - 1);
  const priorChildEvent = order.lastIndexOf("queue-child", priorEventFlush);
  assertEquals(
    priorChildEvent < priorEventFlush && priorEventFlush < secondContextAppend &&
      secondContextAppend < secondContextFlush && secondContextFlush < secondDispatch,
    true,
  );
});

Deno.test("executeHostedChildForkToolInput resolves runtime config and prepares tools", async () => {
  const callbacks: string[] = [];

  const input = {
    authToken: "token",
    apiUrl: "https://api.example.com",
    projectId: "project-1",
    conversationId: "conversation-parent-1",
    parentRunId: "run-parent-1",
    kind: "invoke_agent",
    forkInput: {
      description: "Review checkout",
      prompt: "Review the checkout flow.",
      context: {},
      project_reference: "project-two",
      tools: ["noop"],
      model: "sonnet",
      temperature: 0.4,
      thinking: 256,
      max_steps: 120,
    },
    toolCallId: "tool-call-1",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    contextModel: "opus",
    onRequestedProjectId: (projectId) => {
      callbacks.push(`project:${projectId}`);
    },
    resolveProjectReference: ({ projectReference }) => {
      assertEquals(projectReference, "project-two");
      return Promise.resolve({ projectId: "project-2", slug: "project-two" });
    },
    resolveModelId: (modelId) => `resolved-${modelId}`,
    resolveProvider: (modelId) => `provider-${modelId}`,
    resolveProviderOptions: (forkModel, thinkingConfig) => ({
      forkModel,
      thinkingConfig,
    }),
    resolveReasoning: (_forkModel: string, thinkingConfig: unknown) => thinkingConfig,
    onRuntimeConfig: (runtimeConfig) => {
      callbacks.push(`runtime:${runtimeConfig.forkModel}`);
    },
    prepareToolAssembly: ({ runtimeConfig, requestedTools }) => {
      callbacks.push(`tools:${requestedTools?.join(",") ?? "all"}`);
      assertEquals(runtimeConfig.description, "Review checkout");
      assertEquals(runtimeConfig.forkModel, "resolved-sonnet");
      assertEquals(runtimeConfig.provider, "provider-resolved-sonnet");
      assertEquals(runtimeConfig.temperature, 0.4);
      assertEquals(runtimeConfig.maxSteps, 120);
      assertEquals(runtimeConfig.thinkingConfig, { enabled: true, budgetTokens: 256 });
      assertEquals(runtimeConfig.effectivePrompt.includes("Review the checkout flow."), true);
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"parent_conversation_id":"conversation-parent-1"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"root_conversation_id":"conversation-parent-1"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"parent_run_id":"run-parent-1"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"root_run_id":"run-parent-1"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"tool_call_id":"tool-call-1"'),
        true,
      );
      return {
        ok: true,
        forkTools: {},
        availableToolNames: [],
      };
    },
    startRuntime: (input) => {
      callbacks.push(`start:${input.forkModel}`);
      assertEquals(input.provider, "provider-resolved-sonnet");
      assertEquals(input.temperature, 0.4);
      assertEquals(input.maxSteps, 120);
      assertEquals(input.providerOptions, {
        forkModel: "resolved-sonnet",
        thinkingConfig: { enabled: true, budgetTokens: 256 },
      });
      assertEquals((input as { reasoning?: unknown }).reasoning, {
        enabled: true,
        budgetTokens: 256,
      });
      return {
        forkStreamAbortController: new AbortController(),
        childRunMonitorAbortController: null,
        childRunMonitorPromise: Promise.resolve(),
        forkToolNames: [],
        streamResult: {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "Resolved." } as const;
          })(),
          steps: Promise.resolve([
            {
              text: "Resolved.",
              finishReason: "stop",
              messages: [],
              toolCalls: [],
              toolResults: [],
            },
          ]),
          totalUsage: Promise.resolve(undefined),
        },
      };
    },
  } as Parameters<typeof executeHostedChildForkToolInput>[0] & {
    resolveReasoning: (forkModel: string, thinkingConfig: unknown) => unknown;
  };

  const result = await executeHostedChildForkToolInput(input);

  assertEquals(callbacks, [
    "project:project-2",
    "runtime:resolved-sonnet",
    "tools:noop",
    "start:resolved-sonnet",
  ]);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.summary.text, "Resolved.");
  }
});

Deno.test("executeHostedChildForkToolInput rejects unconfirmed project identities before setup", async () => {
  const callbacks: string[] = [];

  await assertRejects(
    () =>
      executeHostedChildForkToolInput({
        authToken: "token",
        apiUrl: "https://api.example.com",
        kind: "invoke_agent",
        toolCallId: "tool-call-unconfirmed-project",
        forkInput: {
          description: "Review checkout",
          prompt: "Review the checkout flow.",
          context: {},
          project_reference: "project-two",
        },
        defaultModel: "haiku",
        defaultMaxSteps: 80,
        resolveProjectReference: () => Promise.resolve({ projectId: "project-three" }),
        onRequestedProjectId: () => {
          callbacks.push("project");
        },
        resolveModelId: (modelId) => {
          callbacks.push("model");
          return modelId;
        },
        resolveProvider: () => "anthropic",
        prepareToolAssembly: () => {
          callbacks.push("tools");
          return { ok: true, forkTools: {}, availableToolNames: [] };
        },
        startRuntime: () => {
          callbacks.push("runtime");
          throw new Error("unexpected runtime start");
        },
      }),
    TypeError,
    UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE,
  );

  assertEquals(callbacks, []);
});

Deno.test("executeHostedChildForkToolInput honors full result mode", async () => {
  const rawText =
    '<function_calls><invoke name="run_bash">cat report.md</invoke></function_calls><function_result>Exact delegated output.</function_result>';

  const result = await executeHostedChildForkToolInput({
    authToken: "token",
    apiUrl: "https://api.example.com",
    kind: "invoke_agent",
    forkInput: {
      description: "Return exact output",
      prompt: "Return exact output.",
      context: {},
      result_mode: "full",
    },
    toolCallId: "tool-call-full",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    resolveModelId: (modelId) => modelId,
    resolveProvider: () => "anthropic",
    prepareToolAssembly: () => ({
      ok: true,
      forkTools: {},
      availableToolNames: [],
    }),
    startRuntime: () => ({
      forkStreamAbortController: new AbortController(),
      childRunMonitorAbortController: null,
      childRunMonitorPromise: Promise.resolve(),
      forkToolNames: [],
      streamResult: {
        fullStream: (async function* () {
          yield { type: "text-delta", text: rawText } as const;
        })(),
        steps: Promise.resolve([
          {
            text: rawText,
            finishReason: "stop",
            messages: [],
            toolCalls: [],
            toolResults: [],
          },
        ]),
        totalUsage: Promise.resolve(undefined),
      },
    }),
  });

  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.summary.text, rawText);
  }
});

Deno.test("executeHostedChildForkToolInput preserves root invocation context for nested child forks", async () => {
  await executeHostedChildForkToolInput({
    authToken: "token",
    apiUrl: "https://api.example.com",
    projectId: "project-1",
    parentConversationId: "conversation-parent-2",
    conversationId: "conversation-parent-2",
    parentRunId: "run-parent-2",
    parentMessageId: "message-parent-2",
    trustedInvocationContext: {
      root_conversation_id: "conversation-root-1",
      parent_conversation_id: "conversation-parent-1",
      root_run_id: "run-root-1",
      parent_run_id: "run-parent-1",
      parent_message_id: "message-parent-1",
      tool_call_id: "tool-call-parent",
      delegation_depth: 1,
    },
    kind: "invoke_agent",
    forkInput: {
      description: "Review nested handoff",
      prompt: "Review the nested handoff.",
      context: {
        veryfront_invocation_context: {
          root_conversation_id: "conversation-root-1",
          parent_conversation_id: "conversation-parent-1",
          root_run_id: "run-root-1",
          parent_run_id: "run-parent-1",
          tool_call_id: "tool-call-parent",
        },
      },
    },
    toolCallId: "tool-call-2",
    defaultModel: "haiku",
    defaultMaxSteps: 80,
    resolveModelId: (modelId) => modelId,
    resolveProvider: () => "anthropic",
    prepareToolAssembly: ({ runtimeConfig }) => {
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"root_conversation_id":"conversation-root-1"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"parent_conversation_id":"conversation-parent-2"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"root_run_id":"run-root-1"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"parent_run_id":"run-parent-2"'),
        true,
      );
      assertEquals(
        runtimeConfig.effectivePrompt.includes('"parent_message_id":"message-parent-2"'),
        true,
      );
      assertEquals(runtimeConfig.effectivePrompt.includes('"delegation_depth":2'), true);
      assertEquals(runtimeConfig.effectivePrompt.includes('"tool_call_id":"tool-call-2"'), true);
      assertEquals(runtimeConfig.effectivePrompt.includes('"tool-call-parent"'), false);
      return {
        ok: true,
        forkTools: {},
        availableToolNames: [],
      };
    },
    startRuntime: () => ({
      forkStreamAbortController: new AbortController(),
      childRunMonitorAbortController: null,
      childRunMonitorPromise: Promise.resolve(),
      forkToolNames: [],
      streamResult: {
        fullStream: (async function* () {
          yield { type: "text-delta", text: "Resolved." } as const;
        })(),
        steps: Promise.resolve([
          {
            text: "Resolved.",
            finishReason: "stop",
            messages: [],
            toolCalls: [],
            toolResults: [],
          },
        ]),
        totalUsage: Promise.resolve(undefined),
      },
    }),
  });
});

Deno.test("executeHostedChildForkWithPreparedTools exports stable default timeout constants", () => {
  assertEquals(DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS, 2_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS, 45_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS, 5 * 60_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS, 2 * 60_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS, 10_000);
});

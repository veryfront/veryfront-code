import { assertEquals } from "@std/assert";
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
      assertEquals(input.system.includes('project_reference: "project-1"'), true);
      assertEquals(input.system.includes("Available Skills"), true);
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

Deno.test("executeHostedChildForkWithPreparedTools allows injecting the run context factory", async () => {
  let createRunContextCalls = 0;
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
    createRunContext: (input) => {
      createRunContextCalls += 1;
      assertEquals(input.authToken, "token");
      assertEquals(input.apiUrl, "https://api.example.com");
      return createHostedDurableChildForkRunContext({
        authToken: input.authToken,
        apiUrl: input.apiUrl,
        durableChildRun: input.durableChildRun,
        instrumentation: input.instrumentation,
        pendingToolLogContext: {
          conversationId: input.conversationId,
          parentRunId: input.parentRunId,
          description: input.description,
        },
        pendingToolLogWriter: input.pendingToolLogWriter,
      });
    },
    startRuntime: () => ({
      forkStreamAbortController: new AbortController(),
      childRunMonitorAbortController: null,
      childRunMonitorPromise: Promise.resolve(),
      forkToolNames: [],
      streamResult: {
        fullStream: (async function* () {
          yield { type: "text-delta", text: "Injected context." } as const;
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
    }),
  });

  assertEquals(createRunContextCalls, 1);
  assertEquals(result.success, true);
  if (result.success) {
    assertEquals(result.summary.text, "Injected context.");
  }
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
      project_id: "project-2",
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

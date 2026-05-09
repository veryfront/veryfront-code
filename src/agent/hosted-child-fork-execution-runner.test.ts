import { assertEquals } from "@std/assert";
import type { HostToolSet } from "#veryfront/tool";
import {
  DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS,
  DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS,
  executeHostedChildForkWithPreparedTools,
} from "./hosted-child-fork-execution-runner.ts";
import { createHostedDurableChildForkRunContext } from "./hosted-child-fork-run-context.ts";
import type { AgentResponse } from "./schemas/index.ts";

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
      assertEquals(input.forkToolNames, ["noop", "web_fetch", "web_search"]);
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
    startRuntime: (input) => {
      startRuntimeCalls += 1;
      assertEquals(input.forkModel, "anthropic/claude-sonnet-4");
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

Deno.test("executeHostedChildForkWithPreparedTools exports stable default timeout constants", () => {
  assertEquals(DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS, 2_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS, 45_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS, 5 * 60_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS, 2 * 60_000);
  assertEquals(DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS, 10_000);
});

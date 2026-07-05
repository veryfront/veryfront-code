import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import type { ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import type { HostedAgentRunSpan, HostedAgentRunTracer } from "./agent-run-lifecycle.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeToUiMessageStreamOptions,
} from "./chat-runtime-contract.ts";
import type { HostedConversationRootRunContext } from "../conversation/root-run-lifecycle.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";
import {
  type PreparedHostedChatExecution,
  type PreparedHostedChatExecutionRuntimeOptions,
  runPreparedHostedChatExecutionDetached,
  streamPreparedHostedChatExecutionToAgUiResponse,
} from "./prepared-chat-execution.ts";

async function* emptyStream(): AsyncIterable<ChatUiMessageChunk<MessageMetadata>> {}

function createRootRunContext(): HostedConversationRootRunContext {
  return {
    durableRootRun: null,
    durableRunMirror: null,
  };
}

function createAgUiInput(): AgUiRuntimeRequest {
  return {
    runId: "ag-ui-run-1",
    threadId: "thread-1",
    messages: [],
    tools: [],
    context: [],
  };
}

function createTracer() {
  const attributes: Array<Parameters<HostedAgentRunSpan["setAttributes"]>[0]> = [];
  const spanNames: string[] = [];
  let contextCount = 0;
  let finishCount = 0;
  const tracer: HostedAgentRunTracer = {
    startSpan: (name) => {
      spanNames.push(name);
      return {
        setAttributes: (nextAttributes) => {
          attributes.push(nextAttributes);
        },
        finish: () => {
          finishCount += 1;
        },
        withContext: (fn) => {
          contextCount += 1;
          return fn();
        },
      };
    },
  };

  return {
    tracer,
    attributes,
    spanNames,
    get contextCount() {
      return contextCount;
    },
    get finishCount() {
      return finishCount;
    },
  };
}

function createRuntimeOptions(input?: {
  traces?: string[];
  activeAttributes?: Record<string, unknown>[];
}): PreparedHostedChatExecutionRuntimeOptions {
  const tracer = createTracer();
  return {
    apiUrl: "https://api.example.test",
    tracer: tracer.tracer,
    resolveProvider: (modelId) => modelId.split("/")[0] ?? "unknown",
    createRootStreamWatchdog: () => ({
      signal: new AbortController().signal,
      get lastTimeoutState() {
        return null;
      },
      observe: () => {},
      dispose: () => {},
    }),
    trace: async (operationName, operation) => {
      input?.traces?.push(operationName);
      return await operation();
    },
    setActiveSpanAttributes: (attributes) => {
      input?.activeAttributes?.push(attributes);
    },
    logger: {
      error: () => {},
      warn: () => {},
    },
  };
}

function createPreparedExecution(input?: {
  captureStreamOptions?: (options?: HostedChatRuntimeToUiMessageStreamOptions) => void;
  waitForSteps?: Promise<readonly unknown[]>;
  cleanup?: () => Promise<void>;
  stream?: HostedChatRuntimeAgent["stream"];
}): PreparedHostedChatExecution {
  return {
    authToken: "auth-token",
    agent: {
      stream: input?.stream ?? (async () => ({
        steps: input?.waitForSteps ?? Promise.resolve([{}]),
        toUIMessageStream: (options) => {
          input?.captureStreamOptions?.(options);
          return emptyStream();
        },
      })),
    },
    agentId: "agent-1",
    modelId: "openai/gpt-test",
    cleanup: input?.cleanup ?? (async () => {}),
    messages: [],
    finalMessages: [],
    projectId: "project-1",
    userId: "user-1",
    rootRunContext: createRootRunContext(),
    runtimeKind: "framework",
  };
}

describe("agent/prepared-hosted-chat-execution", () => {
  it("streams a prepared execution to an AG-UI response with stable defaults", async () => {
    const traces: string[] = [];
    const activeAttributes: Record<string, unknown>[] = [];
    let capturedOptions: HostedChatRuntimeToUiMessageStreamOptions | undefined;

    const response = await streamPreparedHostedChatExecutionToAgUiResponse({
      execution: {
        ...createPreparedExecution({
          captureStreamOptions: (options) => {
            capturedOptions = options;
          },
        }),
        requestAbortSignal: new AbortController().signal,
        agUiInput: createAgUiInput(),
      },
      runtime: createRuntimeOptions({ traces, activeAttributes }),
    });

    if (!capturedOptions) {
      throw new Error("Expected stream options to be captured");
    }

    assertEquals(response instanceof Response, true);
    assertEquals(traces, ["chat.streamToAgUiResponse"]);
    assertEquals(activeAttributes, [{
      "conversation.id": undefined,
      "project.id": "project-1",
      "agent.runtime.kind": "framework",
    }]);
    assertEquals(capturedOptions.generateMessageId?.(), "ag-ui-run-1:assistant");
  });

  it("passes stream bootstrap watchdog timing through prepared runtime options", async () => {
    using time = new FakeTime();
    const observedChunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const runtime = {
      ...createRuntimeOptions(),
      streamBootstrapKeepaliveIntervalMs: 1,
      createRootStreamWatchdog: () => ({
        signal: new AbortController().signal,
        get lastTimeoutState() {
          return null;
        },
        observe: (chunk) => {
          observedChunks.push(chunk);
        },
        dispose: () => {},
      }),
    } as PreparedHostedChatExecutionRuntimeOptions & {
      streamBootstrapKeepaliveIntervalMs: number;
    };
    const responsePromise = streamPreparedHostedChatExecutionToAgUiResponse({
      execution: {
        ...createPreparedExecution({
          stream: async () => {
            await streamGate;
            return {
              steps: Promise.resolve([{}]),
              toUIMessageStream: () => emptyStream(),
            };
          },
        }),
        requestAbortSignal: new AbortController().signal,
        agUiInput: createAgUiInput(),
      },
      runtime,
    });

    try {
      time.tick(1);
      await Promise.resolve();

      assertEquals(observedChunks.length > 0, true);
    } finally {
      releaseStream();
      const response = await responsePromise;
      await response.body?.cancel();
    }
  });

  it("preserves stream bootstrap watchdog timing from prepared execution input", async () => {
    using time = new FakeTime();
    const observedChunks: ChatUiMessageChunk<MessageMetadata>[] = [];
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const responsePromise = streamPreparedHostedChatExecutionToAgUiResponse({
      execution: {
        ...createPreparedExecution({
          stream: async () => {
            await streamGate;
            return {
              steps: Promise.resolve([{}]),
              toUIMessageStream: () => emptyStream(),
            };
          },
        }),
        streamBootstrapKeepaliveIntervalMs: 1,
        requestAbortSignal: new AbortController().signal,
        agUiInput: createAgUiInput(),
      },
      runtime: {
        ...createRuntimeOptions(),
        createRootStreamWatchdog: () => ({
          signal: new AbortController().signal,
          get lastTimeoutState() {
            return null;
          },
          observe: (chunk) => {
            observedChunks.push(chunk);
          },
          dispose: () => {},
        }),
      },
    });

    try {
      time.tick(1);
      await Promise.resolve();

      assertEquals(observedChunks.length > 0, true);
    } finally {
      releaseStream();
      const response = await responsePromise;
      await response.body?.cancel();
    }
  });

  it("runs a prepared execution detached and waits for finalization", async () => {
    const traces: string[] = [];
    let cleanupCount = 0;

    await runPreparedHostedChatExecutionDetached({
      execution: {
        ...createPreparedExecution({
          cleanup: async () => {
            cleanupCount += 1;
          },
        }),
        abortSignal: new AbortController().signal,
      },
      runtime: createRuntimeOptions({ traces }),
    });

    assertEquals(traces, ["chat.runDetached"]);
    assertEquals(cleanupCount, 1);
  });
});

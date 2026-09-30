/**
 * veryfront/veryfront-issue-inbox#2117: the hosted run stream reports a
 * schema-bound agent's parsed `outputSchema` value as `RunFinished.result`, so
 * the API can store the object as `run.output` instead of the agent's JSON text.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type Agent,
  agent as createAgent,
  type AgentResponse,
  AgentRuntime,
} from "#veryfront/agent";
import { streamWithAgentRuntimeDispatch } from "#veryfront/agent/runtime/index.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

const getTicketClassificationSchema = defineSchema((v) =>
  v.object({ category: v.string(), confidence: v.number() })
);

const CLASSIFICATION_TEXT = '{"category":"billing","confidence":0.93}';

function parseSseFrames(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body.split("\n\n").flatMap((frame) => {
    const event = /^event: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) as Record<string, unknown> }] : [];
  });
}

function createTextModel(text: string): ModelRuntime<ModelRuntimeCallOptions> {
  return {
    provider: "test",
    modelId: "test/structured-result",
    executionMode: "remote",
    runtimeCapabilities: { structuredOutput: true },
    doGenerate: () => Promise.reject(new Error("generate must not be called")),
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            controller.enqueue({ type: "text-delta", delta: text });
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            });
            controller.close();
          },
        }),
      }),
  };
}

function createTicketAgent(input: { id: string; text: string; outputSchema: boolean }): Agent {
  return createAgent({
    id: input.id,
    system: "Classify the ticket.",
    skills: false,
    ...(input.outputSchema ? { outputSchema: getTicketClassificationSchema() } : {}),
    resolveModelTransport: () => Promise.resolve({ model: createTextModel(input.text) }),
  });
}

async function streamRunFrames(runtimeAgent: Agent, runId: string) {
  const response = await createRuntimeAgentStreamResponse(
    {
      threadId: crypto.randomUUID(),
      runId,
      messages: [{ id: "message-1", role: "user", content: "I was charged twice." }],
      tools: [],
      context: [],
    },
    runtimeAgent,
    { sessionManager: new AgentRunSessionManager() },
  );
  return parseSseFrames(await response.text());
}

function overrideAgent(id: string): Agent {
  return {
    id,
    config: { id, model: "anthropic/claude-opus-4-6", system: "test" },
  } as unknown as Agent;
}

type RuntimeStreamCallbacks = { onFinish?: (response: AgentResponse) => void };

async function streamOverrideRunFrames(
  runId: string,
  stream: (callbacks: RuntimeStreamCallbacks | undefined) => ReadableStream<Uint8Array>,
  sessionManager = new AgentRunSessionManager(),
) {
  const response = await createRuntimeAgentStreamResponse(
    { threadId: crypto.randomUUID(), runId, messages: [], tools: [], context: [] },
    overrideAgent(`agent-${runId}`),
    {
      sessionManager,
      createRuntime: () => ({
        stream: (_messages, _context, callbacks) => Promise.resolve(stream(callbacks)),
      }),
    },
  );
  return parseSseFrames(await response.text());
}

function textStream(text: string, trailing: string[] = []): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          [
            'data: {"type":"message-start","messageId":"assistant-1"}',
            'data: {"type":"text-start","id":"text-1"}',
            `data: ${JSON.stringify({ type: "text-delta", id: "text-1", delta: text })}`,
            'data: {"type":"text-end","id":"text-1"}',
            ...trailing,
            "",
            "",
          ].join("\n\n"),
        ),
      );
      controller.close();
    },
  });
}

function completedResponse(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    text: CLASSIFICATION_TEXT,
    messages: [],
    toolCalls: [],
    status: "completed",
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    ...overrides,
  };
}

describe("internal agent run stream structured result (#2117)", () => {
  it("ends a schema-bound agent run with RunFinished.result equal to the same run's onFinish object", async () => {
    // Drive the real framework runtime through the override seam so the test can
    // observe the exact `onFinish` response the hosted run consumes.
    let onFinishObject: unknown = "not called";
    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run_issue_2117_schema_bound",
        messages: [{ id: "message-1", role: "user", content: "I was charged twice." }],
        tools: [],
        context: [],
      },
      createTicketAgent({
        id: "ticket-classifier",
        text: CLASSIFICATION_TEXT,
        outputSchema: true,
      }),
      {
        sessionManager: new AgentRunSessionManager(),
        createRuntime: (runtimeAgent) => {
          const runtime = new AgentRuntime(runtimeAgent.id, runtimeAgent.config);
          return {
            stream: (messages, context, callbacks, ...rest) =>
              streamWithAgentRuntimeDispatch(runtime, messages, context, {
                ...callbacks,
                onFinish: (finished: AgentResponse) => {
                  onFinishObject = finished.object;
                  callbacks?.onFinish?.(finished);
                },
              }, ...rest),
          };
        },
      },
    );
    const frames = parseSseFrames(await response.text());
    const runFinished = frames.find((frame) => frame.event === "RunFinished");

    assertEquals(onFinishObject, { category: "billing", confidence: 0.93 });
    assertExists(runFinished);
    assertEquals(runFinished.data.result, onFinishObject);
    assertEquals(typeof runFinished.data.metadata, "object");
  });

  it("emits no result key for an agent without an outputSchema", async () => {
    const frames = await streamRunFrames(
      createTicketAgent({ id: "ticket-echo", text: CLASSIFICATION_TEXT, outputSchema: false }),
      "run_issue_2117_no_schema",
    );
    const runFinished = frames.find((frame) => frame.event === "RunFinished");

    assertExists(runFinished);
    assertEquals(Object.hasOwn(runFinished.data, "result"), false);
  });

  it("emits no RunFinished and no result when the output does not parse", async () => {
    const frames = await streamRunFrames(
      createTicketAgent({
        id: "ticket-classifier-unparsable",
        text: "Billing, fairly sure.",
        outputSchema: true,
      }),
      "run_issue_2117_unparsable",
    );

    assertEquals(frames.some((frame) => frame.event === "RunError"), true);
    assertEquals(frames.some((frame) => frame.event === "RunFinished"), false);
    assertEquals(frames.some((frame) => Object.hasOwn(frame.data, "result")), false);
  });

  it("reports an explicit null object as a null result", async () => {
    const frames = await streamOverrideRunFrames("run_issue_2117_null_object", (callbacks) => {
      callbacks?.onFinish?.(completedResponse({ text: "null", object: null }));
      return textStream("null");
    });
    const runFinished = frames.find((frame) => frame.event === "RunFinished");

    assertExists(runFinished);
    assertEquals(Object.hasOwn(runFinished.data, "result"), true);
    assertEquals(runFinished.data.result, null);
  });

  it("emits no result for a step-budget exit whose output did not parse", async () => {
    const frames = await streamOverrideRunFrames("run_issue_2117_max_steps", (callbacks) => {
      callbacks?.onFinish?.(completedResponse({
        text: "Still working on it",
        metadata: {
          warning: "Max steps (2) reached",
          outputSchemaError: "is not valid JSON for its outputSchema",
        },
      }));
      return textStream("Still working on it");
    });
    const runFinished = frames.find((frame) => frame.event === "RunFinished");

    assertExists(runFinished);
    assertEquals(Object.hasOwn(runFinished.data, "result"), false);
  });

  it("emits no result when the runtime fails after reporting an object", async () => {
    const frames = await streamOverrideRunFrames("run_issue_2117_failed", (callbacks) => {
      callbacks?.onFinish?.(
        completedResponse({ object: { category: "billing", confidence: 0.93 } }),
      );
      return textStream(CLASSIFICATION_TEXT, [
        'data: {"type":"error","error":"Provider stream failed"}',
      ]);
    });

    assertEquals(frames.some((frame) => frame.event === "RunError"), true);
    assertEquals(frames.some((frame) => frame.event === "RunFinished"), false);
    assertEquals(frames.some((frame) => Object.hasOwn(frame.data, "result")), false);
  });

  it("emits no result when the run is cancelled after the runtime reported an object", async () => {
    const sessionManager = new AgentRunSessionManager();
    const runId = "run_issue_2117_cancelled";
    const frames = await streamOverrideRunFrames(runId, (callbacks) => {
      callbacks?.onFinish?.(
        completedResponse({ object: { category: "billing", confidence: 0.93 } }),
      );
      sessionManager.cancelRun(runId);
      return new ReadableStream<Uint8Array>();
    }, sessionManager);

    assertEquals(frames.some((frame) => frame.event === "RunFinished"), false);
    assertEquals(frames.some((frame) => Object.hasOwn(frame.data, "result")), false);
  });
});

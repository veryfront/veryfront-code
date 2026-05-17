import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { AgentResponse, Message as AgentMessage } from "../schemas/index.ts";
import {
  buildForkRuntimeStepFromResponse,
  buildRecoveredStepParts,
  createForkRuntimeStreamMappingState,
  createInitialForkRuntimeMessages,
  createStreamedStepState,
  type ForkPart,
  type ForkRuntimeStep,
  mapAgUiRuntimeEventToForkParts,
  resolveForkRuntimeContinuationState,
  resolveForkStepResponse,
  type RunAgentRuntimeForkStepInput,
  shouldContinueForkRuntimeStep,
  startAgentRuntimeFork,
  startAgentRuntimeForkWithHostTools,
  type StartAgentRuntimeForkWithHostToolsInput,
} from "./fork-runtime-stream.ts";

const encoder = new TextEncoder();

function createRuntimeEventStream(
  events: readonly Record<string, unknown>[],
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}

describe("agent/fork-runtime-stream", () => {
  it("maps AG-UI runtime tool input and output events into fork parts", () => {
    const state = createForkRuntimeStreamMappingState();

    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" },
        state,
      ),
      [{ type: "tool-input-start", toolCallId: "tool-1", toolName: "create_file" }],
    );
    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '{"path":' },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: '{"path":' }],
    );
    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: '"/plans/a.md"}' },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: '"/plans/a.md"}' }],
    );
    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-available", toolCallId: "tool-1", toolName: "create_file", input: {} },
        state,
      ),
      [{
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "/plans/a.md" },
      }],
    );
    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-output-available", toolCallId: "tool-1", output: { path: "/plans/a.md" } },
        state,
      ),
      [
        {
          type: "tool-result",
          toolCallId: "tool-1",
          toolName: "create_file",
          input: { path: "/plans/a.md" },
          output: { path: "/plans/a.md" },
        },
      ],
    );
  });

  it("routes stream recovery warnings through the injected logger", () => {
    const warnings: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    const logger = {
      warn: (message: string, metadata?: Record<string, unknown>) => {
        warnings.push({ message, metadata });
      },
    };
    const state = createForkRuntimeStreamMappingState({ logger });

    assertEquals(
      mapAgUiRuntimeEventToForkParts(
        { type: "tool-input-delta", toolCallId: "tool-1", inputTextDelta: "{}" },
        state,
      ),
      [{ type: "tool-input-delta", toolCallId: "tool-1", delta: "{}" }],
    );

    const step: ForkRuntimeStep = {
      text: "done",
      messages: [],
      toolCalls: [{
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "/plans/a.md" },
      }],
      toolResults: [],
      finishReason: "stop",
    };
    const recovered = buildRecoveredStepParts(step, state);

    assertEquals(recovered, [
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "/plans/a.md" },
      },
    ]);
    assertEquals(warnings.length, 2);
    assertEquals(
      warnings[0]?.message,
      "Child fork received tool-input-delta before tool-input-start",
    );
    assertEquals(warnings[1]?.message, "Child fork recovered missing tool-call from final step");
  });

  it("recovers a timed-out final response from previously written artifacts", async () => {
    const responsePromise = new Promise<never>(() => {});
    const currentMessages: AgentMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        timestamp: Date.now(),
        parts: [
          {
            type: "tool-create_file",
            toolCallId: "tool-1",
            toolName: "create_file",
            args: { path: "research/report.md", content: "# Report" },
          },
        ],
      },
      {
        id: "tool-1-result",
        role: "tool",
        timestamp: Date.now(),
        parts: [
          {
            type: "tool-result",
            toolCallId: "tool-1",
            toolName: "create_file",
            result: { path: "research/report.md" },
          },
        ],
      },
    ];

    const response = await resolveForkStepResponse({
      responsePromise,
      responseTimeoutMs: 1,
      currentMessages,
      streamedStepState: createStreamedStepState(),
    });

    assertEquals(
      response.text,
      "Completed child tool work. Project artifact(s): research/report.md.",
    );
    assertEquals(response.status, "completed");
    assertExists(response.messages.find((message) => message.role === "assistant"));
  });

  it("builds fork runtime steps and continuation decisions from agent responses", () => {
    const response: AgentResponse = {
      text: "Saved.",
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{
            type: "tool-create_file",
            toolCallId: "tool-1",
            toolName: "create_file",
            args: { path: "plans/a.md" },
          }],
        },
      ],
      toolCalls: [
        {
          id: "tool-1",
          name: "create_file",
          args: { path: "plans/a.md" },
          status: "completed",
          result: { path: "plans/a.md", success: true },
        },
      ],
      status: "completed",
      metadata: { finishReason: "tool-calls" },
    };

    const step = buildForkRuntimeStepFromResponse(response);

    assertEquals(step, {
      text: "Saved.",
      messages: response.messages,
      toolCalls: [{ toolCallId: "tool-1", toolName: "create_file", input: { path: "plans/a.md" } }],
      toolResults: [{
        toolCallId: "tool-1",
        toolName: "create_file",
        input: { path: "plans/a.md" },
        output: { path: "plans/a.md", success: true },
      }],
      finishReason: "tool-calls",
    });
    assertEquals(shouldContinueForkRuntimeStep(step, response), true);
  });

  it("creates initial fork messages and resolves constrained continuation state", async () => {
    const initialMessages: AgentMessage[] = [
      {
        id: "user-1",
        role: "user",
        timestamp: 1,
        parts: [{ type: "text", text: "Existing context" }],
      },
    ];
    const messages = createInitialForkRuntimeMessages({
      initialMessages,
      prompt: "Continue the task.",
    });

    assertEquals(messages.length, 2);
    assertEquals(messages[0]?.parts, [{ type: "text", text: "Existing context" }]);
    assertEquals(messages[1]?.role, "user");
    assertEquals(messages[1]?.parts, [{ type: "text", text: "Continue the task." }]);

    const continuation = await resolveForkRuntimeContinuationState({
      continuationStepsRemaining: 1,
      step: {
        text: "Ready.",
        messages: [],
        toolCalls: [],
        toolResults: [],
        finishReason: "stop",
      },
      currentMessages: messages,
      stepIndex: 0,
      onBeforeStop: () => "Write the artifact now.",
    });

    assertExists(continuation);
    assertEquals(continuation.continuationStepsRemaining, 0);
    assertEquals(continuation.currentMessages.at(-1)?.parts, [
      { type: "text", text: "Write the artifact now." },
    ]);
  });

  it("runs a high-level agent runtime fork stream with injectable step preparation", async () => {
    const capturedInputs: RunAgentRuntimeForkStepInput[] = [];
    const response: AgentResponse = {
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
      usage: {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
      },
      metadata: { finishReason: "stop" },
    };
    const streamResult = startAgentRuntimeFork({
      apiUrl: "https://api.example.com",
      authToken: "auth-token",
      projectId: "project-1",
      model: "model-1",
      maxSteps: 4,
      prompt: "Do the work.",
      forkToolNames: ["create_file"],
      runtimeTools: {},
      buildInstructions: () => "Base instructions.",
      prepareStep: ({ messages, buildInstructions, forkToolNames }) => ({
        messages,
        system: `${buildInstructions()} Tools: ${forkToolNames.join(", ")}`,
      }),
      runStep: async (input) => {
        capturedInputs.push(input);
        return {
          stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
          responsePromise: Promise.resolve(response),
        };
      },
    });

    const parts: ForkPart[] = [];
    for await (const part of streamResult.fullStream) {
      parts.push(part);
    }

    assertEquals(parts, [{ type: "text-delta", text: "Done." }]);
    assertEquals(capturedInputs.length, 1);
    assertEquals(capturedInputs[0]?.system, "Base instructions. Tools: create_file");
    assertEquals(capturedInputs[0]?.messages.at(-1)?.parts, [
      { type: "text", text: "Do the work." },
    ]);
    assertEquals(await streamResult.steps, [buildForkRuntimeStepFromResponse(response)]);
    assertEquals(await streamResult.totalUsage, {
      inputTokens: 3,
      outputTokens: 4,
    });
  });

  it("does not leak unhandled rejections from side promises when the fork stream fails", async () => {
    const unhandledRejections: unknown[] = [];
    const handler = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
      event.preventDefault();
    };

    globalThis.addEventListener("unhandledrejection", handler);
    try {
      const streamError = new Error("provider failed");
      const streamResult = startAgentRuntimeFork({
        apiUrl: "https://api.example.com",
        authToken: "auth-token",
        projectId: "project-1",
        model: "model-1",
        maxSteps: 1,
        prompt: "Do the work.",
        forkToolNames: [],
        runtimeTools: {},
        buildInstructions: () => "Base instructions.",
        runStep: async () => ({
          stream: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(streamError);
            },
          }),
          responsePromise: new Promise<AgentResponse>(() => {}),
        }),
      });

      let thrown: unknown;
      try {
        for await (const _part of streamResult.fullStream) {
          // The stream errors before yielding parts.
        }
      } catch (error) {
        thrown = error;
      }

      assertEquals(thrown, streamError);
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(unhandledRejections, []);
      await assertRejects(() => Promise.resolve(streamResult.steps), Error, "provider failed");
      await assertRejects(() => Promise.resolve(streamResult.totalUsage), Error, "provider failed");
    } finally {
      globalThis.removeEventListener("unhandledrejection", handler);
    }
  });

  it("starts a high-level agent runtime fork from host tool definitions", async () => {
    const capturedInputs: RunAgentRuntimeForkStepInput[] = [];
    const traceCalls: string[] = [];
    const attributes: Record<string, unknown>[] = [];
    const response: AgentResponse = {
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
      usage: {
        promptTokens: 1,
        completionTokens: 2,
        totalTokens: 3,
      },
      metadata: { finishReason: "stop" },
    };

    const { streamResult, forkToolNames } = startAgentRuntimeForkWithHostTools({
      apiUrl: "https://api.example.com",
      authToken: "auth-token",
      projectId: "project-1",
      provider: "anthropic",
      forkModel: "anthropic/claude-sonnet-4",
      maxSteps: 1,
      prompt: "Do the work.",
      forkTools: {
        create_file: {
          description: "Create a file.",
          inputSchema: defineSchema((v) => v.object({ path: v.string() }))(),
          execute: () => ({ ok: true }),
        },
      },
      traceTools: {
        trace: (spanName, operation) => {
          traceCalls.push(spanName);
          return operation();
        },
        buildAttributes: ({ toolName, toolCallId }) => ({ toolName, toolCallId }),
        setAttributes: (nextAttributes) => {
          attributes.push(nextAttributes);
        },
      },
      runStep: async (input) => {
        capturedInputs.push(input);
        const createFileTool = input.runtimeTools.create_file;
        if (createFileTool && typeof createFileTool !== "boolean") {
          await createFileTool.execute({ path: "artifact.md" }, { toolCallId: "tool-call-1" });
        }

        return {
          stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
          responsePromise: Promise.resolve(response),
        };
      },
      buildInstructions: () => "Base instructions.",
    });

    const parts: ForkPart[] = [];
    for await (const part of streamResult.fullStream) {
      parts.push(part);
    }

    assertEquals(forkToolNames, ["create_file", "web_fetch", "web_search"]);
    assertEquals(capturedInputs[0]?.forkToolNames, forkToolNames);
    assertEquals(Object.keys(capturedInputs[0]?.runtimeTools ?? {}), ["create_file"]);
    assertEquals(traceCalls, ["tool.create_file"]);
    assertEquals(attributes, [{ toolName: "create_file", toolCallId: "tool-call-1" }]);
    assertEquals(parts, [{ type: "text-delta", text: "Done." }]);
  });

  it("preserves typed trace attributes for high-level host-tool forks", () => {
    type NarrowTraceAttributes = {
      toolName: string;
      toolCallId: string | undefined;
    };
    const attributeNames: string[] = [];
    const input: StartAgentRuntimeForkWithHostToolsInput<NarrowTraceAttributes> = {
      apiUrl: "https://api.example.com",
      authToken: "auth-token",
      projectId: "project-1",
      provider: "anthropic",
      forkModel: "anthropic/claude-sonnet-4",
      maxSteps: 1,
      forkTools: {},
      buildInstructions: () => "Base instructions.",
      traceTools: {
        trace: (_spanName, operation) => operation(),
        buildAttributes: ({ toolName, toolCallId }) => ({ toolName, toolCallId }),
        setAttributes: (attributes) => {
          attributeNames.push(attributes.toolName);
        },
      },
    };

    input.traceTools?.setAttributes?.({ toolName: "create_file", toolCallId: undefined });

    assertEquals(attributeNames, ["create_file"]);
  });

  it("continues a high-level agent runtime fork when the continuation resolver returns a prompt", async () => {
    const responses: AgentResponse[] = [
      {
        text: "Ready.",
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            timestamp: 2,
            parts: [{ type: "text", text: "Ready." }],
          },
        ],
        toolCalls: [],
        status: "completed",
        metadata: { finishReason: "stop" },
      },
      {
        text: "Artifact written.",
        messages: [
          {
            id: "assistant-2",
            role: "assistant",
            timestamp: 3,
            parts: [{ type: "text", text: "Artifact written." }],
          },
        ],
        toolCalls: [],
        status: "completed",
        metadata: { finishReason: "stop" },
      },
    ];
    let runCount = 0;
    const streamResult = startAgentRuntimeFork({
      apiUrl: "https://api.example.com",
      authToken: "auth-token",
      projectId: null,
      model: "model-1",
      maxSteps: 1,
      maxContinuationSteps: 1,
      prompt: "Prepare.",
      forkToolNames: [],
      runtimeTools: {},
      buildInstructions: () => "Base instructions.",
      onBeforeStop: ({ stepIndex }) => stepIndex === 0 ? "Write it now." : null,
      runStep: async () => {
        const response = responses[runCount];
        runCount += 1;
        if (!response) {
          throw new Error("Unexpected extra run step");
        }

        return {
          stream: createRuntimeEventStream([{ type: "text-delta", delta: response.text }]),
          responsePromise: Promise.resolve(response),
        };
      },
    });

    for await (const _part of streamResult.fullStream) {
      // Drain stream.
    }

    assertEquals(runCount, 2);
    assertEquals((await streamResult.steps).map((step) => step.text), [
      "Ready.",
      "Artifact written.",
    ]);
  });
});

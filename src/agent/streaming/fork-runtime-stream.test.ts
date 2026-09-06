import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import { createToolsFromRemoteDefinitions, type RemoteToolSource } from "#veryfront/tool";
import type { AgentResponse, Message as AgentMessage } from "../schemas/index.ts";
import type { AgentRunModelCallContextEvent } from "../../runtime/model-call-context.ts";
import { runWithRunEventSink } from "../../runtime/run-event-sink-context.ts";
import {
  applyPartToStreamedStepState,
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
  runAgentRuntimeForkStep,
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

function observeUnhandledRejections(): {
  readonly unhandledRejections: unknown[];
  readonly dispose: () => void;
} {
  const unhandledRejections: unknown[] = [];
  const globalEventTarget = globalThis as typeof globalThis & {
    addEventListener?: typeof globalThis.addEventListener;
    removeEventListener?: typeof globalThis.removeEventListener;
  };

  if (
    typeof globalEventTarget.addEventListener === "function" &&
    typeof globalEventTarget.removeEventListener === "function"
  ) {
    const handler = (event: PromiseRejectionEvent) => {
      unhandledRejections.push(event.reason);
      event.preventDefault();
    };
    globalEventTarget.addEventListener("unhandledrejection", handler);
    return {
      unhandledRejections,
      dispose: () => globalEventTarget.removeEventListener?.("unhandledrejection", handler),
    };
  }

  const nodeProcess = (globalThis as { process?: typeof import("node:process") }).process;
  if (
    nodeProcess && typeof nodeProcess.on === "function" && typeof nodeProcess.off === "function"
  ) {
    const handler = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    nodeProcess.on("unhandledRejection", handler);
    return {
      unhandledRejections,
      dispose: () => nodeProcess.off("unhandledRejection", handler),
    };
  }

  throw new Error("No unhandled rejection observer is available");
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

  it("preserves a terminal stream error when a fork response never finishes", async () => {
    const responsePromise = new Promise<never>(() => {});
    const streamedStepState = createStreamedStepState();
    applyPartToStreamedStepState(streamedStepState, {
      type: "error",
      error: new Error(
        'veryfront-cloud request failed: {"slug":"insufficient-credits","error":"AI credit limit exceeded","suggestion":"Purchase credits."}',
      ),
    });

    await assertRejects(
      () =>
        resolveForkStepResponse({
          responsePromise,
          responseTimeoutMs: 1,
          currentMessages: [],
          streamedStepState,
        }),
      Error,
      "Purchase credits.",
    );
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

  it("uses the step preparer forkToolNames override for the child step", async () => {
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
    };
    const streamResult = startAgentRuntimeFork({
      apiUrl: "https://api.example.com",
      authToken: "auth-token",
      projectId: "project-1",
      model: "model-1",
      maxSteps: 1,
      prompt: "Do the work.",
      forkToolNames: ["create_file"],
      runtimeTools: {},
      buildInstructions: () => "Base instructions.",
      prepareStep: ({ messages, buildInstructions }) => ({
        messages,
        system: buildInstructions(),
        forkToolNames: ["create_file", "gmail__list_emails"],
      }),
      runStep: async (input) => {
        capturedInputs.push(input);
        return {
          stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
          responsePromise: Promise.resolve(response),
        };
      },
    });

    for await (const _part of streamResult.fullStream) {
      // Drain the stream so the step runs.
    }
    await streamResult.steps;

    assertEquals(
      capturedInputs[0]?.forkToolNames,
      ["create_file", "gmail__list_emails"],
      "prepared forkToolNames must reach the child step",
    );
  });

  it("preserves structured provider options in the default fork step runner", async () => {
    const providerId = "fork-structured-system";
    let observedSystem: unknown;
    const model: ModelRuntime = {
      provider: providerId,
      modelId: `${providerId}/demo`,
      async doGenerate() {
        return {
          content: [{ type: "text", text: "Done." }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream(options: unknown) {
        observedSystem = (options as { prompt?: unknown[] }).prompt?.filter((message) =>
          (message as { role?: unknown }).role === "system"
        );
        return {
          stream: new ReadableStream<unknown>({
            start(controller) {
              controller.enqueue({ type: "text-delta", text: "Done." });
              controller.enqueue({ type: "finish", finishReason: "stop" });
              controller.close();
            },
          }),
        };
      },
    };
    const unregister = registerModelProvider(providerId, () => model);
    try {
      const result = await runAgentRuntimeForkStep({
        apiUrl: "https://api.example.com",
        authToken: "test-token",
        projectId: "project-1",
        model: `${providerId}/demo`,
        messages: [{
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Do the work." }],
        }],
        system: [{
          role: "system",
          content: "Cached fork instructions.",
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
          },
        }],
        forkToolNames: [],
        runtimeTools: {},
      });

      await new Response(result.stream).text();
      await result.responsePromise;
      assertEquals((observedSystem as unknown[] | undefined)?.[0], {
        role: "system",
        content: "Cached fork instructions.",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      });
    } finally {
      unregister();
    }
  });

  it("rejects the response promise when the fork step starts with an aborted signal", async () => {
    const providerId = "fork-aborted-step";
    const model: ModelRuntime = {
      provider: providerId,
      modelId: `${providerId}/demo`,
      async doGenerate() {
        return {
          content: [{ type: "text", text: "Done." }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return {
          stream: new ReadableStream<unknown>({
            start(controller) {
              controller.enqueue({ type: "text-delta", text: "Done." });
              controller.enqueue({ type: "finish", finishReason: "stop" });
              controller.close();
            },
          }),
        };
      },
    };
    const unregister = registerModelProvider(providerId, () => model);
    const controller = new AbortController();
    controller.abort();

    try {
      const result = await runAgentRuntimeForkStep({
        apiUrl: "https://api.example.com",
        authToken: "test-token",
        projectId: "project-1",
        model: `${providerId}/demo`,
        messages: [{
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Do the work." }],
        }],
        system: "Fork instructions.",
        abortSignal: controller.signal,
        forkToolNames: [],
        runtimeTools: {},
      });

      const error = await assertRejects(() => result.responsePromise, Error);
      assertInstanceOf(
        error,
        Error,
        "an aborted fork step must reject with an Error",
      );
      assertEquals(
        error.name,
        "AbortError",
        "an aborted fork step must settle responsePromise",
      );

      await new Response(result.stream).text().catch(() => undefined);
    } finally {
      unregister();
    }
  });

  it("does not leak unhandled rejections from side promises when the fork stream fails", async () => {
    const unhandledRejectionObserver = observeUnhandledRejections();

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

      assertEquals(unhandledRejectionObserver.unhandledRejections, []);
      await assertRejects(() => Promise.resolve(streamResult.steps), Error, "provider failed");
      await assertRejects(() => Promise.resolve(streamResult.totalUsage), Error, "provider failed");
    } finally {
      unhandledRejectionObserver.dispose();
    }
  });

  it("preserves terminal error codes through the public fork stream", async () => {
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
      responseTimeoutMs: 1,
      runStep: async () => ({
        stream: createRuntimeEventStream([{
          type: "error",
          error: "Resource limit exceeded",
          code: "RESOURCE_LIMIT_EXCEEDED",
        }]),
        responsePromise: new Promise<AgentResponse>(() => {}),
      }),
    });

    let thrown: unknown;
    try {
      for await (const _part of streamResult.fullStream) {
        // Drain until the streamed error terminates the fork.
      }
    } catch (error) {
      thrown = error;
    }

    assertEquals(thrown instanceof Error ? thrown.message : undefined, "Resource limit exceeded");
    assertEquals(
      thrown && typeof thrown === "object" && "code" in thrown ? thrown.code : undefined,
      "RESOURCE_LIMIT_EXCEEDED",
    );
    await Promise.resolve(streamResult.steps).catch(() => undefined);
    await Promise.resolve(streamResult.totalUsage).catch(() => undefined);
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

    assertEquals(forkToolNames, ["create_file"]);
    assertEquals(capturedInputs[0]?.forkToolNames, forkToolNames);
    assertEquals(Object.keys(capturedInputs[0]?.runtimeTools ?? {}), ["create_file"]);
    assertEquals(traceCalls, ["tool.create_file"]);
    assertEquals(attributes, [{ toolName: "create_file", toolCallId: "tool-call-1" }]);
    assertEquals(parts, [{ type: "text-delta", text: "Done." }]);
  });

  it("preserves and executes an authorized remote alias across repeated child runtimes", async () => {
    const providerId = "child-remote-tool-regression";
    let streamCalls = 0;
    let providerToolNames: string[] = [];
    const remoteExecutions: Array<{
      toolName: string;
      args: Record<string, unknown>;
      toolCallId: string | undefined;
    }> = [];
    const model: ModelRuntime = {
      provider: providerId,
      modelId: `${providerId}/demo`,
      async doGenerate() {
        return {
          content: [{ type: "text", text: "Done." }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream(options: unknown) {
        streamCalls++;
        const childOrdinal = Math.ceil(streamCalls / 2);
        const tools = (options as { tools?: Array<{ name?: string }> }).tools ?? [];
        providerToolNames = tools.flatMap((tool) =>
          typeof tool.name === "string" ? [tool.name] : []
        );
        return {
          stream: new ReadableStream<unknown>({
            start(controller) {
              if (streamCalls % 2 === 1) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: `upload-call-${childOrdinal}`,
                  toolName: "upload_attachment",
                  input: { attachmentId: `attachment-${childOrdinal}` },
                });
                controller.enqueue({ type: "finish", finishReason: "tool-calls" });
              } else {
                controller.enqueue({ type: "text-delta", text: "Done." });
                controller.enqueue({ type: "finish", finishReason: "stop" });
              }
              controller.close();
            },
          }),
        };
      },
    };
    registerModelProvider(providerId, () => model);

    const source: RemoteToolSource = {
      id: "veryfront-api",
      listTools: async () => [],
      executeTool: async (toolName, args, context) => {
        remoteExecutions.push({
          toolName,
          args,
          toolCallId: context?.toolCallId,
        });
        return { uploaded: true };
      },
    };
    const remoteTools = createToolsFromRemoteDefinitions(source, [{
      name: "gmail__upload_attachment",
      description: "Upload an attachment to Gmail.",
      parameters: {
        type: "object",
        properties: {
          attachmentId: { type: "string" },
        },
        required: ["attachmentId"],
      },
    }]);
    const uploadAttachment = remoteTools.gmail__upload_attachment;
    assertExists(uploadAttachment);
    const forkTools = { upload_attachment: uploadAttachment };

    const childParts: ForkPart[][] = [];
    const childContexts: AgentRunModelCallContextEvent[][] = [];
    for (const childOrdinal of [1, 2]) {
      const { streamResult, forkToolNames } = startAgentRuntimeForkWithHostTools({
        apiUrl: "https://api.example.com",
        authToken: "auth-token",
        projectId: "project-1",
        provider: providerId,
        forkModel: `${providerId}/demo`,
        maxSteps: 2,
        prompt: `Inspect attachment ${childOrdinal}.`,
        forkTools,
        buildInstructions: () => "Base instructions.",
        traceTools: {
          trace: (_spanName, operation) => operation(),
        },
      });
      assertEquals(forkToolNames, ["upload_attachment"]);

      const parts: ForkPart[] = [];
      const contexts: AgentRunModelCallContextEvent[] = [];
      await runWithRunEventSink(
        (event) => {
          contexts.push(event as unknown as AgentRunModelCallContextEvent);
        },
        async () => {
          for await (const part of streamResult.fullStream) {
            parts.push(part);
          }
        },
      );
      childParts.push(parts);
      childContexts.push(contexts);
    }

    assertEquals(providerToolNames, ["upload_attachment"]);
    assertEquals(streamCalls, 4);
    assertEquals(childContexts.map((contexts) => contexts.length), [2, 2]);
    for (let index = 0; index < childContexts.length; index += 1) {
      const contexts = childContexts[index] ?? [];
      const first = JSON.stringify(contexts[0]);
      const second = JSON.stringify(contexts[1]);
      assertEquals(first.includes(`Inspect attachment ${index + 1}.`), true);
      assertEquals(first.includes("Base instructions."), true);
      assertEquals(second.includes(`upload-call-${index + 1}`), true);
      assertEquals(second.includes(`attachment-${index + 1}`), true);
      assertEquals(second.includes("uploaded"), true);
      assertEquals(second.includes("ROOT_CROSS_RUN_SENTINEL"), false);
    }
    assertEquals(remoteExecutions, [
      {
        toolName: "gmail__upload_attachment",
        args: { attachmentId: "attachment-1" },
        toolCallId: "upload-call-1",
      },
      {
        toolName: "gmail__upload_attachment",
        args: { attachmentId: "attachment-2" },
        toolCallId: "upload-call-2",
      },
    ]);
    for (const parts of childParts) {
      assertEquals(
        parts.some((part) =>
          part.type === "tool-call" &&
          part.toolName === "upload_attachment"
        ),
        true,
      );
      assertEquals(
        parts.some((part) =>
          part.type === "tool-result" &&
          part.toolName === "upload_attachment" &&
          (part.output as { uploaded?: boolean }).uploaded === true
        ),
        true,
      );
      assertEquals(parts.at(-1), { type: "text-delta", text: "Done." });
    }
  });

  it("keeps denied integration tools out of child runtime requests", async () => {
    const capturedInputs: RunAgentRuntimeForkStepInput[] = [];
    let localExecutions = 0;
    const sourceIntegrationPolicy = {
      schemaVersion: 1 as const,
      mode: "allowlist" as const,
      integrations: { gmail: { allowedToolIds: ["list_emails"] } },
    };
    const response: AgentResponse = {
      text: "Done.",
      messages: [],
      toolCalls: [],
      status: "completed",
      metadata: { finishReason: "stop" },
    };

    const { streamResult, forkToolNames } = startAgentRuntimeForkWithHostTools({
      apiUrl: "https://api.example.com",
      authToken: "auth-token",
      projectId: "project-1",
      provider: "anthropic",
      forkModel: "anthropic/claude-sonnet-4",
      maxSteps: 1,
      prompt: "Inspect mail.",
      sourceIntegrationPolicy,
      forkToolNames: [
        "gmail__delete_email",
        "futureconnector__read",
        "gmail__list_emails",
        "local_search",
      ],
      forkTools: {
        local_search: {
          description: "Search local data.",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => {
            localExecutions += 1;
            return { ok: true };
          },
        },
      },
      runStep: async (input) => {
        capturedInputs.push(input);
        const localSearch = input.runtimeTools.local_search;
        if (localSearch && typeof localSearch !== "boolean") {
          await localSearch.execute({}, { toolCallId: "call-local-search" });
        }
        return {
          stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
          responsePromise: Promise.resolve(response),
        };
      },
      buildInstructions: () => "Base instructions.",
    });

    for await (const _part of streamResult.fullStream) {
      // Consume stream.
    }

    assertEquals(forkToolNames.sort(), ["gmail__list_emails", "local_search"]);
    assertEquals(capturedInputs[0]?.forkToolNames.sort(), [
      "gmail__list_emails",
      "local_search",
    ]);
    assertEquals(Object.keys(capturedInputs[0]?.runtimeTools ?? {}), ["local_search"]);
    assertEquals(localExecutions, 1);
  });

  it("passes requested provider-native tools into child fork runtime steps", async () => {
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
      prompt: "Research with web tools.",
      forkTools: {},
      forkToolNames: ["web_fetch", "web_search"],
      runStep: async (input) => {
        capturedInputs.push(input);
        return {
          stream: createRuntimeEventStream([{ type: "text-delta", delta: "Done." }]),
          responsePromise: Promise.resolve(response),
        };
      },
      buildInstructions: () => "Base instructions.",
    });

    for await (const _part of streamResult.fullStream) {
      // Consume stream.
    }

    assertEquals(forkToolNames, ["web_fetch", "web_search"]);
    assertEquals(capturedInputs[0]?.forkToolNames, ["web_fetch", "web_search"]);
    assertEquals(capturedInputs[0]?.providerToolNames, ["web_fetch", "web_search"]);
    assertEquals(Object.keys(capturedInputs[0]?.runtimeTools ?? {}), []);
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

  it("passes reasoning options to fork run steps", async () => {
    let capturedReasoning: unknown;
    const streamResult = startAgentRuntimeFork(
      {
        apiUrl: "https://api.example.com",
        authToken: "auth-token",
        projectId: null,
        model: "model-1",
        maxSteps: 1,
        prompt: "Prepare.",
        forkToolNames: [],
        runtimeTools: {},
        reasoning: { enabled: true, budgetTokens: 2048 },
        buildInstructions: () => "Base instructions.",
        runStep: async (input) => {
          capturedReasoning = (input as Record<string, unknown>).reasoning;
          return {
            stream: createRuntimeEventStream([{ type: "text-delta", delta: "Ready." }]),
            responsePromise: Promise.resolve({
              text: "Ready.",
              messages: [],
              toolCalls: [],
              status: "completed",
              metadata: { finishReason: "stop" },
            }),
          };
        },
      } as Parameters<typeof startAgentRuntimeFork>[0] & {
        reasoning: { enabled: boolean; budgetTokens: number };
      },
    );

    for await (const _part of streamResult.fullStream) {
      // Drain stream.
    }

    assertEquals(capturedReasoning, { enabled: true, budgetTokens: 2048 });
  });
});

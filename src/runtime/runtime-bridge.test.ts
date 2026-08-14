import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { metricsManager } from "#veryfront/observability/metrics/index.ts";
import { type AgentRunEvent, runWithRunEventSink } from "../agent/index.ts";
import { runWithMandatoryRunEventSink } from "./run-event-sink-context.ts";
import { generateText, streamText } from "./runtime-bridge.ts";
import {
  collectAsync,
  createGenerateModel,
  createStreamModel,
} from "./runtime-bridge.test-helpers.ts";

function readableStreamFrom<T>(values: Iterable<T>): ReadableStream<T> {
  return new ReadableStream({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
  });
}

describe("runtime-bridge", () => {
  it("skips non-cloneable model context without failing model dispatch", async () => {
    const sensitiveValue = "CUSTOMER_SECRET_123";
    for (
      const testCase of [
        {
          name: "message input",
          messages: [{
            role: "assistant" as const,
            content: [{
              type: "tool-call" as const,
              toolCallId: "call-1",
              toolName: "unsafe",
              input: { secret: Symbol(sensitiveValue) },
            }],
          }, { role: "user" as const, content: "Continue" }],
          tools: undefined,
        },
        {
          name: "tool schema",
          messages: [{ role: "user" as const, content: "Call the tool" }],
          tools: {
            unsafe: {
              inputSchema: {
                jsonSchema: { type: "object", validate: () => true },
              },
            },
          },
        },
      ]
    ) {
      let sinkCalls = 0;
      let dispatches = 0;
      const model = createGenerateModel("test", `test/${testCase.name}`, async () => {
        dispatches += 1;
        return {
          content: [{ type: "text", text: "dispatched" }],
          finishReason: "stop",
          usage: {},
        };
      });

      const result = await runWithRunEventSink(
        () => {
          sinkCalls += 1;
        },
        () =>
          generateText({
            model,
            messages: testCase.messages,
            tools: testCase.tools as never,
          }),
      );
      assertEquals(result.text, "dispatched");
      assertEquals(sinkCalls, 0);
      assertEquals(dispatches, 1);
    }
  });

  it("emits one exact run event with normalized messages and resolved tools before direct generate", async () => {
    const order: string[] = [];
    let recorded: unknown;
    const model = createGenerateModel("test", "test/model-call-context", async (options) => {
      order.push("dispatch");
      const event = recorded as Record<string, unknown>;
      assertEquals(event.messages, options.prompt);
      assertEquals(event.tools, options.tools);
      assertEquals(recorded, {
        type: "AGENT_RUN_MODEL_CALL_CONTEXT",
        messages: options.prompt,
        tools: options.tools,
      });
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });

    await runWithRunEventSink(
      (event) => {
        order.push("persist");
        recorded = event;
      },
      () =>
        generateText({
          model,
          system: "System instructions",
          messages: [
            { role: "user", content: "Load the skill" },
            {
              role: "assistant",
              content: [{
                type: "tool-call",
                toolCallId: "skill-1",
                toolName: "load_skill",
                input: { id: "review" },
              }],
            },
            {
              role: "tool",
              content: [{
                type: "tool-result",
                toolCallId: "skill-1",
                toolName: "load_skill",
                output: { type: "json", value: { instructions: "Review carefully" } },
              }],
            },
            { role: "assistant", content: [{ type: "text", text: "removed prefill" }] },
          ],
          tools: {
            search: {
              description: "Search",
              inputSchema: { jsonSchema: Promise.resolve({ type: "object" }) },
              execute: () => "secret handler",
            },
            web_search: {
              type: "provider",
              id: "anthropic.web_search_20250305",
              args: { maxUses: 2 },
              inputSchema: () => ({ jsonSchema: { type: "object" } }),
            },
          },
          temperature: 0.7,
          headers: { authorization: "secret" },
        }),
    );

    assertEquals(order, ["persist", "dispatch"]);
    assertEquals(recorded, {
      type: "AGENT_RUN_MODEL_CALL_CONTEXT",
      messages: [
        { role: "system", content: "System instructions" },
        { role: "user", content: [{ type: "text", text: "Load the skill" }] },
        {
          role: "assistant",
          content: [{
            type: "tool-call",
            toolCallId: "skill-1",
            toolName: "load_skill",
            input: { id: "review" },
          }],
        },
        {
          role: "tool",
          content: [{
            type: "tool-result",
            toolCallId: "skill-1",
            toolName: "load_skill",
            output: { type: "json", value: { instructions: "Review carefully" } },
          }],
        },
      ],
      tools: [
        {
          type: "function",
          name: "search",
          description: "Search",
          inputSchema: { type: "object" },
        },
        {
          type: "provider",
          name: "web_search",
          id: "anthropic.web_search_20250305",
          args: { maxUses: 2 },
        },
      ],
    });
  });

  it("records exactly one ordered context for each evolving skill-backed dispatch", async () => {
    const contexts: unknown[] = [];
    const order: string[] = [];
    let providerDispatches = 0;
    const model = createGenerateModel("test", "test/evolving-skill-context", async () => {
      providerDispatches += 1;
      order.push(`dispatch:${providerDispatches}`);
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: {},
      };
    });
    const sink = (event: unknown) => {
      contexts.push(event);
      order.push(`persist:${contexts.length}`);
    };
    const tools = {
      load_skill: {
        description: "Load one available skill",
        inputSchema: { jsonSchema: { type: "object" } },
      },
    };
    const system = "Available skills:\n- repo-review: Review a repository carefully.";

    await runWithRunEventSink(sink, () =>
      generateText({
        model,
        system,
        messages: [{ role: "user", content: "Review this change." }],
        tools,
      }));
    await runWithRunEventSink(sink, () =>
      generateText({
        model,
        system,
        messages: [
          { role: "user", content: "Review this change." },
          {
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "load-1",
              toolName: "load_skill",
              input: { id: "repo-review" },
            }],
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "load-1",
              toolName: "load_skill",
              output: {
                type: "json",
                value: { instructions: "Inspect behavior, tests, and regressions." },
              },
            }],
          },
          {
            role: "assistant",
            content: [{ type: "text", text: "REMOVE THIS TRAILING PREFILL" }],
          },
        ],
        tools,
      }));

    const resolvedTools = [{
      type: "function",
      name: "load_skill",
      description: "Load one available skill",
      inputSchema: { type: "object" },
    }];
    assertEquals(contexts, [
      {
        type: "AGENT_RUN_MODEL_CALL_CONTEXT",
        messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "text", text: "Review this change." }] },
        ],
        tools: resolvedTools,
      },
      {
        type: "AGENT_RUN_MODEL_CALL_CONTEXT",
        messages: [
          { role: "system", content: system },
          { role: "user", content: [{ type: "text", text: "Review this change." }] },
          {
            role: "assistant",
            content: [{
              type: "tool-call",
              toolCallId: "load-1",
              toolName: "load_skill",
              input: { id: "repo-review" },
            }],
          },
          {
            role: "tool",
            content: [{
              type: "tool-result",
              toolCallId: "load-1",
              toolName: "load_skill",
              output: {
                type: "json",
                value: { instructions: "Inspect behavior, tests, and regressions." },
              },
            }],
          },
        ],
        tools: resolvedTools,
      },
    ]);
    assertEquals(providerDispatches, 2);
    assertEquals(contexts.length, providerDispatches);
    assertEquals(order, ["persist:1", "dispatch:1", "persist:2", "dispatch:2"]);
    assertEquals(JSON.stringify(contexts).includes("REMOVE THIS TRAILING PREFILL"), false);
  });

  it("emits before stream-backed generate and direct stream dispatch", async () => {
    for (const mode of ["generate", "stream"] as const) {
      const order: string[] = [];
      const model = {
        ...createStreamModel("test", `test/${mode}-record`, async () => {
          order.push("dispatch");
          return {
            stream: readableStreamFrom([
              { type: "text-delta", delta: "ok" },
              { type: "finish", finishReason: "stop", usage: {} },
            ]),
          };
        }),
        ...(mode === "generate" ? { _generateViaStream: true as const } : {}),
      };
      const operation = () => {
        const options = {
          model,
          messages: [{ role: "user" as const, content: "Hello" }],
        };
        return mode === "generate"
          ? generateText(options)
          : collectAsync(streamText(options).fullStream);
      };

      await runWithRunEventSink(
        async () => {
          await Promise.resolve();
          order.push("persist");
        },
        operation,
      );
      assertEquals(order, ["persist", "dispatch"]);
    }
  });

  it("propagates sink failures without dispatching", async () => {
    for (const mode of ["generate", "stream"] as const) {
      let dispatches = 0;
      const model = createGenerateModel("test", "test/rejected-record", async () => {
        dispatches += 1;
        throw new Error("unexpected dispatch");
      });
      const error = new Error(`persist ${mode} failed`);
      const operation = async () => {
        if (mode === "generate") {
          await generateText({
            model,
            messages: [{ role: "user", content: "Hello" }],
          });
          return;
        }
        await collectAsync(
          streamText({
            model: createStreamModel("test", "test/rejected-stream-record", async () => {
              dispatches += 1;
              throw new Error("unexpected dispatch");
            }),
            messages: [{ role: "user", content: "Hello" }],
          }).fullStream,
        );
      };

      await assertRejects(
        () => runWithRunEventSink(() => Promise.reject(error), operation),
        Error,
        error.message,
      );
      assertEquals(dispatches, 0);
    }
  });

  it("awaits the mandatory sink before the public sink and provider dispatch", async () => {
    const order: string[] = [];
    const model = createGenerateModel("test", "test/composed-run-event-sinks", async () => {
      order.push("dispatch");
      return { content: [], finishReason: "stop", usage: {} };
    });

    await runWithMandatoryRunEventSink(
      async () => {
        await Promise.resolve();
        order.push("mandatory");
      },
      () =>
        runWithRunEventSink(
          async () => {
            await Promise.resolve();
            order.push("public");
          },
          () => generateText({ model, messages: [{ role: "user", content: "Hello" }] }),
        ),
    );

    assertEquals(order, ["mandatory", "public", "dispatch"]);
  });

  it("delivers a successful sink clone and sanitizes another clone failure", async () => {
    const sensitiveFailureClass = "CUSTOMER_SECRET_FAILURE_CLASS";
    const cloneError = new Error("clone failed");
    cloneError.name = sensitiveFailureClass;
    let cloneReads = 0;
    const statefulInput = {};
    Object.defineProperty(statefulInput, "value", {
      enumerable: true,
      get() {
        cloneReads += 1;
        if (cloneReads === 1) throw cloneError;
        return "safe";
      },
    });

    const recorder = metricsManager.getRecorder();
    const originalRecordError = recorder?.recordError;
    const failureClasses: string[] = [];
    if (recorder) {
      recorder.recordError = (attributes) => {
        if (
          attributes?.slug === "model-call-context-clone-failed" &&
          typeof attributes.failure_class === "string"
        ) {
          failureClasses.push(attributes.failure_class);
        }
      };
    }

    let mandatoryCalls = 0;
    let publicEvent: AgentRunEvent | undefined;
    let dispatches = 0;
    const model = createGenerateModel("test", "test/partial-clone", async () => {
      dispatches += 1;
      return { content: [], finishReason: "stop", usage: {} };
    });

    try {
      await runWithMandatoryRunEventSink(
        () => {
          mandatoryCalls += 1;
        },
        () =>
          runWithRunEventSink(
            (event) => {
              publicEvent = event;
            },
            () =>
              generateText({
                model,
                messages: [{
                  role: "assistant",
                  content: [{
                    type: "tool-call",
                    toolCallId: "call-1",
                    toolName: "stateful",
                    input: statefulInput,
                  }],
                }, { role: "user", content: "Continue" }],
              }),
          ),
      );
    } finally {
      if (recorder && originalRecordError) recorder.recordError = originalRecordError;
    }

    assertEquals(mandatoryCalls, 0);
    assertEquals(publicEvent?.type, "AGENT_RUN_MODEL_CALL_CONTEXT");
    assertEquals(dispatches, 1);
    assertEquals(failureClasses, ["unknown"]);
  });

  it("calls a sink shared by both lanes only once", async () => {
    let calls = 0;
    const sink = () => {
      calls += 1;
    };
    const model = createGenerateModel("test", "test/deduplicated-run-event-sink", async () => ({
      content: [],
      finishReason: "stop",
      usage: {},
    }));

    await runWithMandatoryRunEventSink(
      sink,
      () =>
        runWithRunEventSink(
          sink,
          () => generateText({ model, messages: [{ role: "user", content: "Hello" }] }),
        ),
    );

    assertEquals(calls, 1);
  });

  it("fails closed in either sink lane", async () => {
    for (const failingLane of ["mandatory", "public"] as const) {
      let dispatches = 0;
      let publicCalls = 0;
      const error = new Error(`${failingLane} sink failed`);
      const model = createGenerateModel("test", `test/${failingLane}-sink-failure`, async () => {
        dispatches += 1;
        return { content: [], finishReason: "stop", usage: {} };
      });

      await assertRejects(
        () =>
          runWithMandatoryRunEventSink(
            failingLane === "mandatory" ? () => Promise.reject(error) : () => {},
            () =>
              runWithRunEventSink(
                () => {
                  publicCalls += 1;
                  return failingLane === "public" ? Promise.reject(error) : undefined;
                },
                async () =>
                  await generateText({ model, messages: [{ role: "user", content: "Hello" }] }),
              ),
          ),
        Error,
        error.message,
      );
      assertEquals(dispatches, 0);
      assertEquals(publicCalls, failingLane === "mandatory" ? 0 : 1);
    }
  });

  it("isolates nested sink mutations from generate and stream provider inputs", async () => {
    for (const mode of ["generate", "stream"] as const) {
      const expectedPrompt = [{
        role: "user" as const,
        content: [{ type: "text" as const, text: "keep me" }],
      }];
      const expectedTools = [{
        type: "function" as const,
        name: "lookup",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
      }];
      const assertProviderInput = (options: Record<string, unknown>) => {
        assertEquals(options.prompt, expectedPrompt);
        assertEquals(options.tools, expectedTools);
      };
      const model = mode === "generate"
        ? createGenerateModel("test", "test/mutation-generate", async (options) => {
          assertProviderInput(options);
          return { content: [], finishReason: "stop", usage: {} };
        })
        : createStreamModel("test", "test/mutation-stream", async (options) => {
          assertProviderInput(options);
          return {
            stream: readableStreamFrom([
              { type: "finish", finishReason: "stop", usage: {} },
            ]),
          };
        });
      const options = {
        model,
        messages: [{ role: "user" as const, content: "keep me" }],
        tools: {
          lookup: {
            inputSchema: {
              jsonSchema: {
                type: "object",
                properties: { id: { type: "string" } },
              },
            },
          },
        },
      };

      const sink = (event: AgentRunEvent) => {
        const context = event as unknown as Record<string, unknown>;
        const messages = context.messages as Array<Record<string, unknown>>;
        const message = messages[0] as { role?: string; content?: Array<Record<string, unknown>> };
        const content = message?.content;
        if (message?.role === "user" && content?.[0]?.type === "text") {
          content[0].text = "mutated messages";
        }
        const tool = (context.tools as Array<Record<string, unknown>> | undefined)?.[0];
        if (tool?.type === "function") {
          const schema = tool.inputSchema as {
            properties: { id: { type: string } };
          };
          schema.properties.id.type = "number";
        }
      };

      if (mode === "generate") {
        await runWithRunEventSink(sink, () => generateText(options));
      } else {
        await runWithRunEventSink(sink, () => collectAsync(streamText(options).fullStream));
      }
    }
  });

  it("uses the direct generate path for models without tools", async () => {
    let called = false;

    const model = createGenerateModel("test", "test/direct-generate", async (options) => {
      called = true;
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }]);
      return {
        content: [{ type: "text", text: "World" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 3 },
          outputTokens: { total: 4 },
        },
      };
    });

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0,
    });

    assertEquals(called, true);
    assertEquals(result.text, "World");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.usage, {
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    });
  });

  it("forwards reasoning options to direct generate models", async () => {
    const model = createGenerateModel("test", "test/reasoning-generate", async (options) => {
      assertEquals(options.reasoning, { enabled: false });
      return {
        content: [{ type: "text", text: "ok" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    });

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { enabled: false },
    });

    assertEquals(result.text, "ok");
  });

  it("buffers the stream path for models that prefer streamed generate", async () => {
    let called = false;

    const model = {
      ...createStreamModel(
        "veryfront-cloud",
        "veryfront-cloud/openai/gpt-test",
        async (options) => {
          called = true;
          assertEquals(options.prompt, [{
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          }]);
          return {
            stream: readableStreamFrom([
              { type: "text-delta", delta: "Hel" },
              { type: "text-delta", delta: "lo" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage: {
                  inputTokens: { total: 2 },
                  outputTokens: { total: 5 },
                },
              },
            ]),
          };
        },
      ),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0,
    });

    assertEquals(called, true);
    assertEquals(result.text, "Hello");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.usage, {
      inputTokens: 2,
      outputTokens: 5,
      totalTokens: 7,
    });
  });

  it("buffers streamed tool calls for models that prefer streamed generate", async () => {
    const model = {
      ...createStreamModel("veryfront-cloud", "veryfront-cloud/anthropic/claude-test", async () => {
        return {
          stream: readableStreamFrom([
            { type: "tool-input-start", id: "tool-1", toolName: "search" },
            { type: "tool-input-delta", id: "tool-1", delta: '{"query":' },
            { type: "tool-input-delta", id: "tool-1", delta: '"webgpu"}' },
            { type: "tool-input-end", id: "tool-1" },
            {
              type: "finish",
              finishReason: "tool-calls",
              usage: { inputTokens: 4, outputTokens: 3 },
            },
          ]),
        };
      }),
      _generateViaStream: true,
    };

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Search" }],
      temperature: 0,
    });

    assertEquals(result.finishReason, "tool-calls");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-1",
      toolName: "search",
      input: { query: "webgpu" },
    }]);
    assertEquals(result.usage, {
      inputTokens: 4,
      outputTokens: 3,
      totalTokens: 7,
    });
  });

  it("uses the direct stream path for models without tools", async () => {
    const model = createStreamModel("test", "test/direct-stream", async (options) => {
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      }]);
      return {
        stream: readableStreamFrom([
          { type: "text-delta", delta: "Hel" },
          { type: "text-delta", delta: "lo" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: {
              inputTokens: { total: 2 },
              outputTokens: { total: 5, reasoning: 3 },
            },
          },
        ]),
      };
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, ["Hel", "lo"]);
    assertEquals(fullStreamParts, [
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 2,
          outputTokens: 5,
          reasoningTokens: 3,
        },
      },
    ]);
  });

  it("rejects a second stream view started after direct consumption", async () => {
    const model = createStreamModel("test", "test/late-second-stream", async () => ({
      stream: readableStreamFrom([
        { type: "text-delta", delta: "Hel" },
        { type: "text-delta", delta: "lo" },
      ]),
    }));
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    const fullIterator = result.fullStream[Symbol.asyncIterator]();
    assertEquals(await fullIterator.next(), {
      value: { type: "text-delta", text: "Hel" },
      done: false,
    });
    await assertRejects(
      () => collectAsync(result.textStream),
      Error,
      "must start consumption concurrently",
    );
    await fullIterator.return?.();
  });

  it("cancels a sole stream consumer without waiting for an unused branch", async () => {
    let cancelled = false;
    const model = createStreamModel("test", "test/sole-stream-cancel", async () => ({
      stream: new ReadableStream({
        pull(controller) {
          controller.enqueue({ type: "text-delta", delta: "chunk" });
        },
        cancel() {
          cancelled = true;
        },
      }),
    }));
    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });

    for await (const _part of result.fullStream) break;

    assertEquals(cancelled, true);
  });

  it("handles an abandoned stream request rejection", async () => {
    let called = false;
    const model = createStreamModel("test", "test/abandoned-stream", async () => {
      called = true;
      throw new Error("stream failed");
    });

    streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEquals(called, true);
  });

  it("forwards reasoning options to direct stream models", async () => {
    const model = createStreamModel("test", "test/reasoning-stream", async (options) => {
      assertEquals(options.reasoning, { enabled: true, budgetTokens: 2048 });
      return {
        stream: readableStreamFrom([
          { type: "text-delta", delta: "ok" },
          { type: "finish", finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } },
        ]),
      };
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Hello" }],
      reasoning: { enabled: true, budgetTokens: 2048 },
    });

    assertEquals(await collectAsync(result.textStream), ["ok"]);
  });

  it("uses the direct generate path for ordinary function tools", async () => {
    let called = false;

    const model = createGenerateModel("test", "test/direct-generate-tools", async (options) => {
      called = true;
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }]);
      assertEquals(options.tools, [{
        type: "function",
        name: "weather",
        description: "Get the weather",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
          additionalProperties: false,
        },
      }]);
      return {
        content: [{
          type: "tool-call",
          toolCallId: "tool-1",
          toolName: "weather",
          input: '{"city":"Tokyo"}',
        }],
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage: {
          inputTokens: { total: 8 },
          outputTokens: { total: 2 },
        },
      };
    });

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Check weather" }],
      tools: {
        weather: {
          description: "Get the weather",
          inputSchema: {
            jsonSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
              additionalProperties: false,
            },
          },
        },
      },
      temperature: 0,
    });

    assertEquals(called, true);
    assertEquals(result.text, "");
    assertEquals(result.finishReason, "tool-calls");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-1",
      toolName: "weather",
      input: { city: "Tokyo" },
    }]);
  });

  it("uses the direct stream path for ordinary function tools", async () => {
    const model = createStreamModel("test", "test/direct-stream-tools", async (options) => {
      assertEquals(options.prompt, [{
        role: "user",
        content: [{ type: "text", text: "Check weather" }],
      }]);
      assertEquals(options.tools, [{
        type: "function",
        name: "weather",
        description: "Get the weather",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
          additionalProperties: false,
        },
      }]);
      return {
        stream: readableStreamFrom([
          { type: "tool-input-start", id: "tool-1", toolName: "weather" },
          { type: "tool-input-delta", id: "tool-1", delta: '{"city":' },
          { type: "tool-input-delta", id: "tool-1", delta: '"Tokyo"}' },
          {
            type: "tool-call",
            toolCallId: "tool-1",
            toolName: "weather",
            input: '{"city":"Tokyo"}',
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_use" },
            usage: {
              inputTokens: { total: 8 },
              outputTokens: { total: 2 },
            },
          },
        ]),
      };
    });

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Check weather" }],
      tools: {
        weather: {
          description: "Get the weather",
          inputSchema: {
            jsonSchema: {
              type: "object",
              properties: {
                city: { type: "string" },
              },
              required: ["city"],
              additionalProperties: false,
            },
          },
        },
      },
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, []);
    assertEquals(fullStreamParts, [
      { type: "tool-input-start", id: "tool-1", toolName: "weather" },
      { type: "tool-input-delta", id: "tool-1", delta: '{"city":' },
      { type: "tool-input-delta", id: "tool-1", delta: '"Tokyo"}' },
      {
        type: "tool-call",
        toolCallId: "tool-1",
        toolName: "weather",
        input: '{"city":"Tokyo"}',
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        totalUsage: {
          inputTokens: 8,
          outputTokens: 2,
        },
      },
    ]);
  });

  it("uses the direct stream path for provider-native tools", async () => {
    const model = createStreamModel(
      "anthropic",
      "anthropic/test-direct-provider-tools",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Research Veryfront" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_search",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
        }]);

        return {
          stream: readableStreamFrom([
            {
              type: "tool-call",
              toolCallId: "tool-web-1",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "tool-web-1",
              toolName: "web_search",
              result: [{
                url: "https://veryfront.com",
                title: "Veryfront",
                pageAge: null,
                encryptedContent: "opaque",
                type: "web_search_result",
              }],
              providerExecuted: true,
            },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 6 },
                outputTokens: { total: 9 },
              },
            },
          ]),
        };
      },
    );

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Research Veryfront" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "array",
            },
          }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, []);
    assertEquals(fullStreamParts, [
      {
        type: "tool-call",
        toolCallId: "tool-web-1",
        toolName: "web_search",
        input: '{"query":"Veryfront"}',
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "tool-web-1",
        toolName: "web_search",
        result: [{
          url: "https://veryfront.com",
          title: "Veryfront",
          pageAge: null,
          encryptedContent: "opaque",
          type: "web_search_result",
        }],
        providerExecuted: true,
      },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 6,
          outputTokens: 9,
        },
      },
    ]);
  });

  it("uses the direct generate path for provider-native tools", async () => {
    const model = createGenerateModel(
      "anthropic",
      "anthropic/test-direct-provider-generate",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Research Veryfront" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_search",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
        }]);

        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-web-2",
              toolName: "web_search",
              input: '{"query":"Veryfront"}',
            },
            {
              type: "tool-result",
              toolCallId: "tool-web-2",
              toolName: "web_search",
              result: [{
                url: "https://veryfront.com",
                title: "Veryfront",
                pageAge: null,
                encryptedContent: "opaque",
                type: "web_search_result",
              }],
            },
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 6 },
            outputTokens: { total: 9 },
          },
        };
      },
    );

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Research Veryfront" }],
      tools: {
        web_search: {
          type: "provider",
          id: "anthropic.web_search_20250305",
          args: {
            maxUses: 5,
          },
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
              required: ["query"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "array",
            },
          }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    assertEquals(result.text, "");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-web-2",
      toolName: "web_search",
      input: { query: "Veryfront" },
    }]);
    assertEquals(result.toolResults, [{
      toolCallId: "tool-web-2",
      toolName: "web_search",
      result: [{
        url: "https://veryfront.com",
        title: "Veryfront",
        pageAge: null,
        encryptedContent: "opaque",
        type: "web_search_result",
      }],
    }]);
  });

  it("keeps providerExecuted on direct generate provider tool results", async () => {
    // Mirrors what ext-llm-anthropic's buildAnthropicGenerateResult and
    // ext-llm-openai's Responses normalizer actually return from doGenerate:
    // server-side tool results always carry providerExecuted: true.
    const model = createGenerateModel(
      "anthropic",
      "anthropic/test-direct-provider-executed-generate",
      async () => ({
        content: [
          {
            type: "tool-call",
            toolCallId: "tool-web-3",
            toolName: "web_search",
            input: '{"query":"Veryfront"}',
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "tool-web-3",
            toolName: "web_search",
            result: [{ url: "https://veryfront.com", title: "Veryfront" }],
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "tool-web-4",
            toolName: "web_fetch",
            result: { message: "fetch blocked" },
            isError: true,
            providerExecuted: true,
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 6 },
          outputTokens: { total: 9 },
        },
      }),
    );

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Research Veryfront" }],
      temperature: 0,
    });

    assertEquals(result.toolResults, [
      {
        toolCallId: "tool-web-3",
        toolName: "web_search",
        result: [{ url: "https://veryfront.com", title: "Veryfront" }],
        providerExecuted: true,
      },
      {
        toolCallId: "tool-web-4",
        toolName: "web_fetch",
        result: { message: "fetch blocked" },
        isError: true,
        providerExecuted: true,
      },
    ]);
  });

  it("uses the direct stream path for provider-native web_fetch", async () => {
    const model = createStreamModel(
      "anthropic",
      "anthropic/test-direct-provider-web-fetch-stream",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Fetch the docs page" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_fetch",
          id: "anthropic.web_fetch_20250910",
          args: {},
        }]);

        return {
          stream: readableStreamFrom([
            {
              type: "tool-call",
              toolCallId: "tool-fetch-1",
              toolName: "web_fetch",
              input: '{"url":"https://veryfront.com/docs"}',
              providerExecuted: true,
            },
            {
              type: "tool-result",
              toolCallId: "tool-fetch-1",
              toolName: "web_fetch",
              result: {
                type: "web_fetch_result",
                url: "https://veryfront.com/docs",
                content: {
                  type: "document",
                  source: {
                    type: "text",
                    mediaType: "text/plain",
                    data: "Veryfront docs",
                  },
                },
                retrievedAt: "2026-04-11T10:10:00Z",
              },
              providerExecuted: true,
            },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: { total: 5 },
                outputTokens: { total: 8 },
              },
            },
          ]),
        };
      },
    );

    const result = streamText({
      model,
      messages: [{ role: "user", content: "Fetch the docs page" }],
      tools: {
        web_fetch: {
          type: "provider",
          id: "anthropic.web_fetch_20250910",
          args: {},
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "object",
            },
          }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    const [textDeltas, fullStreamParts] = await Promise.all([
      collectAsync(result.textStream),
      collectAsync(result.fullStream),
    ]);

    assertEquals(textDeltas, []);
    assertEquals(fullStreamParts, [
      {
        type: "tool-call",
        toolCallId: "tool-fetch-1",
        toolName: "web_fetch",
        input: '{"url":"https://veryfront.com/docs"}',
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "tool-fetch-1",
        toolName: "web_fetch",
        result: {
          type: "web_fetch_result",
          url: "https://veryfront.com/docs",
          content: {
            type: "document",
            source: {
              type: "text",
              mediaType: "text/plain",
              data: "Veryfront docs",
            },
          },
          retrievedAt: "2026-04-11T10:10:00Z",
        },
        providerExecuted: true,
      },
      {
        type: "finish",
        finishReason: "stop",
        totalUsage: {
          inputTokens: 5,
          outputTokens: 8,
        },
      },
    ]);
  });

  it("uses the direct generate path for provider-native web_fetch", async () => {
    const model = createGenerateModel(
      "anthropic",
      "anthropic/test-direct-provider-web-fetch-generate",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Fetch the docs page" }],
        }]);
        assertEquals(options.tools, [{
          type: "provider",
          name: "web_fetch",
          id: "anthropic.web_fetch_20250910",
          args: {},
        }]);

        return {
          content: [
            {
              type: "tool-call",
              toolCallId: "tool-fetch-2",
              toolName: "web_fetch",
              input: '{"url":"https://veryfront.com/docs"}',
            },
            {
              type: "tool-result",
              toolCallId: "tool-fetch-2",
              toolName: "web_fetch",
              result: {
                type: "web_fetch_result",
                url: "https://veryfront.com/docs",
                content: {
                  type: "document",
                  source: {
                    type: "text",
                    mediaType: "text/plain",
                    data: "Veryfront docs",
                  },
                },
                retrievedAt: "2026-04-11T10:12:00Z",
              },
            },
          ],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 4 },
            outputTokens: { total: 6 },
          },
        };
      },
    );

    const result = await generateText({
      model,
      messages: [{ role: "user", content: "Fetch the docs page" }],
      tools: {
        web_fetch: {
          type: "provider",
          id: "anthropic.web_fetch_20250910",
          args: {},
          inputSchema: () => ({
            jsonSchema: {
              type: "object",
              properties: {
                url: { type: "string" },
              },
              required: ["url"],
              additionalProperties: false,
            },
          }),
          outputSchema: () => ({
            jsonSchema: {
              type: "object",
            },
          }),
          supportsDeferredResults: true,
        },
      },
      temperature: 0,
    });

    assertEquals(result.text, "");
    assertEquals(result.finishReason, "stop");
    assertEquals(result.toolCalls, [{
      toolCallId: "tool-fetch-2",
      toolName: "web_fetch",
      input: { url: "https://veryfront.com/docs" },
    }]);
    assertEquals(result.toolResults, [{
      toolCallId: "tool-fetch-2",
      toolName: "web_fetch",
      result: {
        type: "web_fetch_result",
        url: "https://veryfront.com/docs",
        content: {
          type: "document",
          source: {
            type: "text",
            mediaType: "text/plain",
            data: "Veryfront docs",
          },
        },
        retrievedAt: "2026-04-11T10:12:00Z",
      },
    }]);
  });

  it("drops trailing assistant prefill messages before direct stream requests", async () => {
    const model = createStreamModel(
      "anthropic",
      "anthropic/test-drop-prefill-stream",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Continue after the tool result." }],
        }]);
        return {
          stream: readableStreamFrom([
            { type: "text-delta", delta: "Continuing" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" } },
          ]),
        };
      },
    );

    const result = streamText({
      model,
      messages: [
        { role: "user", content: "Continue after the tool result." },
        { role: "assistant", content: [{ type: "text", text: "Draft prefill" }] },
      ],
    });

    assertEquals(await collectAsync(result.textStream), ["Continuing"]);
  });

  it("drops trailing assistant prefill messages before direct generate requests", async () => {
    const model = createGenerateModel(
      "anthropic",
      "anthropic/test-drop-prefill-generate",
      async (options) => {
        assertEquals(options.prompt, [{
          role: "user",
          content: [{ type: "text", text: "Continue after the tool result." }],
        }]);
        return {
          content: [{ type: "text", text: "Continuing" }],
          finishReason: { unified: "stop", raw: "stop" },
        };
      },
    );

    const result = await generateText({
      model,
      messages: [
        { role: "user", content: "Continue after the tool result." },
        { role: "assistant", content: [{ type: "text", text: "Draft prefill" }] },
      ],
    });

    assertEquals(result.text, "Continuing");
  });
});

import { isTerminalRunControlError } from "#veryfront/agent/runtime/terminal-run-control.ts";
import { registerTurnProviderRequestValidator } from "#veryfront/agent/middleware/turn-validation.ts";
import { securityMiddleware } from "#veryfront/agent/middleware/security/validator.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createChatUiMessageStreamFromDataStream } from "#veryfront/agent/streaming/chat-ui-message-stream.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { AgentRuntime, type AgentRuntimeInternalOptions } from "#veryfront/agent/runtime/index.ts";
import type { AgentConfig, Message } from "#veryfront/agent/types.ts";
import {
  scriptedModel,
  type ScriptedTurn,
} from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";

const failure = { code: "INGEST_FAILED", message: "no email ingested" };
const failCall = {
  id: "fail-1",
  name: "veryfront__finalize",
  input: { status: "failed", error: failure },
};
const markerCall = { id: "marker-1", name: "veryfront__marker", input: {} };
const failedResult = {
  completed: true,
  run: { run_id: "run-current", status: "failed", error: failure },
};

async function fixture(
  turns: ScriptedTurn[],
  run: (
    runtime: AgentRuntime,
    model: ReturnType<typeof scriptedModel>,
    dispatched: string[],
  ) => Promise<void>,
  reply: (name: string, count: number) => unknown = () => ({
    structuredContent: failedResult,
    content: [],
  }),
  outputSchema?: AgentConfig["outputSchema"],
  middleware?: AgentConfig["middleware"],
  resumeToolCall?: AgentRuntimeInternalOptions["resumeToolCall"],
  resolverToolCallId?: string,
) {
  const dispatched: string[] = [];
  const model = Object.assign(scriptedModel(turns, { modelId: "hosted/fail-run" }), {
    runtimeCapabilities: { structuredOutput: true },
  });
  await withMockFetch(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const result = request.method === "tools/list"
      ? {
        tools: [failCall.name, markerCall.name].map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object", properties: {} },
        })),
      }
      : await (() => {
        dispatched.push(request.params.name);
        return reply(request.params.name, dispatched.length);
      })();
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  }, async () => {
    const runtime = new AgentRuntime("failure-fixture", {
      model: "hosted/fail-run",
      system: "Fail the run",
      tools: { veryfront__finalize: true, veryfront__marker: true },
      maxSteps: 3,
      outputSchema,
      middleware,
      resolveRuntimeState: ({ context }) => ({
        context: {
          runId: context?.runId,
          runIdBindsToolAuthorization: context?.runIdBindsToolAuthorization,
          refreshed: true,
          ...(resolverToolCallId ? { toolCallId: resolverToolCallId } : {}),
        },
      }),
      memory: { type: "buffer", enabled: true },
      resolveModelTransport: async () => ({ model }),
      ...{
        __vfRemoteToolSources: [
          markTrustedPlatformSource(
            createRemoteMCPToolSource({ endpoint: "https://runtime-test.example/mcp" }),
          ),
        ],
      },
    }, { resumeToolCall });
    await run(runtime, model, dispatched);
  });
}

describe("runtime finalize terminal control", () => {
  for (const mode of ["generate", "stream", "resume"] as const) {
    for (const collision of ["none", "caller", "resolver"] as const) {
      for (const status of ["completed", "failed", "cancelled", "unknown"] as const) {
        it(`pairs admitted terminal receipts: ${mode}/${collision}/${status}`, async () => {
          const call = { ...failCall, input: { status: "completed", output: "done" } };
          await fixture(
            [{ toolCalls: [call, markerCall] }],
            async (runtime, model, dispatched) => {
              const context = {
                runId: "run-current",
                ...(collision === "caller" ? { toolCallId: "outer" } : {}),
              };
              const input = [{
                id: "matrix-input",
                role: "user" as const,
                parts: [{ type: "text" as const, text: "run" }],
              }];
              if (mode === "resume") {
                await runtime.getMemory().add({
                  id: "parked-turn",
                  role: "assistant",
                  parts: [call, markerCall].map((item) => ({
                    type: "tool-call" as const,
                    toolCallId: item.id,
                    toolName: item.name,
                    args: item.input,
                  })),
                });
              }
              if (mode === "generate") {
                if (status === "completed") {
                  assertEquals((await runtime.generate(input, context)).object, "done");
                } else await assertRejects(() => runtime.generate(input, context));
              } else {
                const body = await new Response(await runtime.stream(input, context)).text();
                for (const id of ["fail-1", "marker-1"]) {
                  const outputs = body.split("\n").filter((line) =>
                    line.includes(`"toolCallId":"${id}"`) &&
                    /"type":"tool-output-(available|error)"/.test(line)
                  );
                  assertEquals(outputs.length, 1, body);
                }
                assertEquals(
                  body.includes('"type":"message-finish"'),
                  status === "completed",
                  body,
                );
              }
              const receipts = (await runtime.getMemory().getMessages()).flatMap((message) =>
                message.parts.flatMap((part) => part.type === "tool-result" ? [part] : [])
              );
              assertEquals(receipts.map((part) => part.toolCallId), ["fail-1", "marker-1"]);
              assertEquals(
                dispatched,
                status === "unknown" ? [failCall.name, failCall.name] : [failCall.name],
              );
              assertEquals(model.callCount, mode === "resume" ? 0 : 1);
            },
            () => {
              if (status === "unknown") throw new Error("transport unavailable");
              return {
                content: [],
                structuredContent: {
                  completed: true,
                  run: {
                    run_id: "run-current",
                    status,
                    ...(status === "completed" ? { output: "done" } : { error: failure }),
                  },
                },
              };
            },
            undefined,
            undefined,
            mode === "resume" ? call : undefined,
            collision === "resolver" ? "resolver-call" : undefined,
          );
        });
      }
    }
  }

  for (const mode of ["generate", "stream", "resume"] as const) {
    for (const status of ["completed", "failed", "unknown"] as const) {
      it(`keeps terminal receipts private from replaced intrinsics: ${mode}/${status}`, async () => {
        const call = { ...failCall, input: { status: "completed", output: "done" } };
        await fixture(
          [{ toolCalls: [call, markerCall] }],
          async (runtime, model, dispatched) => {
            if (mode === "resume") {
              await runtime.getMemory().add({
                id: "parked-private-turn",
                role: "assistant",
                parts: [call, markerCall].map((item) => ({
                  type: "tool-call" as const,
                  toolCallId: item.id,
                  toolName: item.name,
                  args: item.input,
                })),
              });
            }
            const iterator = Array.prototype[Symbol.iterator];
            const get = Reflect.get;
            const apply = Reflect.apply;
            const observations: string[] = [];
            let output;
            try {
              Array.prototype[Symbol.iterator] = function () {
                for (let index = 0; index < this.length; index++) {
                  const value = this[index];
                  if (
                    value && typeof value === "object" &&
                    (value.type === "tool-call" || value.type === "tool-result") &&
                    (value.toolCallId === "fail-1" || value.toolCallId === "marker-1")
                  ) observations.push("private terminal part");
                }
                if (
                  this[0] === "RUN_TERMINAL" || this[0] === "RUN_OUTCOME_UNKNOWN" ||
                  this[0] === failure.code
                ) observations.push("terminal outcome arguments");
                if (this[0] === "runId") observations.push("execution context keys");
                return apply(iterator, this, []);
              };
              Reflect.get = (target, key, receiver) => {
                if (key === "runId" && target.runId === "run-current") {
                  observations.push("execution context read");
                }
                return get(target, key, receiver);
              };
              const context = { runId: "run-current" };
              if (mode === "generate") {
                if (status === "completed") output = await runtime.generate("run", context);
                else await assertRejects(() => runtime.generate("run", context));
              } else {
                output = await new Response(await runtime.stream("run", context)).text();
              }
            } finally {
              Array.prototype[Symbol.iterator] = iterator;
              Reflect.get = get;
            }
            assertEquals(observations, []);
            if (mode === "generate" && status === "completed") {
              assertEquals((output as { object: unknown }).object, "done");
            }
            const receipts = (await runtime.getMemory().getMessages()).flatMap((message) =>
              message.parts.filter((part) => part.type === "tool-result")
            );
            assertEquals(receipts.map((part) => part.toolCallId), ["fail-1", "marker-1"]);
            assertEquals(dispatched, status === "unknown" ? [call.name, call.name] : [call.name]);
            assertEquals(model.callCount, mode === "resume" ? 0 : 1);
          },
          () => {
            if (status === "unknown") throw new Error("transport unavailable");
            return {
              content: [],
              structuredContent: {
                completed: true,
                run: {
                  run_id: "run-current",
                  status,
                  ...(status === "completed" ? { output: "done" } : { error: failure }),
                },
              },
            };
          },
          undefined,
          undefined,
          mode === "resume" ? call : undefined,
        );
      });
    }
  }

  it("retains admitted turn recovery data after an acknowledged receipt cannot persist", async () => {
    await fixture(
      [{
        toolCalls: [{ ...failCall, input: { status: "completed", output: "done" } }, markerCall],
      }],
      async (runtime, model, dispatched) => {
        const memory = runtime.getMemory();
        const begin = memory.beginTransaction!.bind(memory);
        memory.beginTransaction = async () => {
          const transaction = await begin();
          return {
            ...transaction,
            add: async (message) => {
              if (message.parts.some((part) => part.type === "tool-result")) {
                throw new Error("Receipt persistence unavailable");
              }
              await transaction.add(message);
            },
          };
        };
        await assertRejects(
          () => runtime.generate("run", { runId: "run-current" }),
          Error,
          "Receipt persistence unavailable",
        );
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 1);
        const durable = await memory.getMessages();
        assert(
          durable.some((message) =>
            message.role === "assistant" &&
            message.parts.some((part) => "toolCallId" in part && part.toolCallId === "fail-1")
          ),
          "Acknowledged terminal operation has no admitted call in the committed memory view",
        );
      },
      () => ({
        content: [],
        structuredContent: {
          completed: true,
          run: { run_id: "run-current", status: "completed", output: "done" },
        },
      }),
      undefined,
      [async (context, next) => {
        registerTurnProviderRequestValidator(context, async () => {});
        return await next();
      }],
    );
  });

  it("retains admitted receipts when runtime-state context replaces the active call ID", async () => {
    await fixture(
      [{
        toolCalls: [{ ...failCall, input: { status: "completed", output: "done" } }, markerCall],
      }],
      async (runtime, model, dispatched) => {
        const result = await runtime.generate("run", {
          runId: "run-current",
          toolCallId: "caller-call",
        });
        assertEquals(result.object, "done");
        const receiptIds = result.messages.flatMap((message) =>
          message.parts.flatMap((part) => part.type === "tool-result" ? [part.toolCallId] : [])
        );
        assertEquals(receiptIds, ["fail-1", "marker-1"]);
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 1);
      },
      () => ({
        content: [],
        structuredContent: {
          completed: true,
          run: { run_id: "run-current", status: "completed", output: "done" },
        },
      }),
      undefined,
      undefined,
      undefined,
      "resolver-call",
    );
  });

  for (const streaming of [false, true]) {
    it(`preserves terminal receipts when application code replaces runtime prototype methods; stream=${streaming}`, async () => {
      const prototype = AgentRuntime.prototype;
      const original = Object.getOwnPropertyDescriptor(prototype, "unresolvedTerminalSiblings")!;
      let replacedCalls = 0;
      Object.defineProperty(prototype, "unresolvedTerminalSiblings", {
        ...original,
        value: () => {
          replacedCalls++;
          throw new Error("application replacement must not intercept terminal history");
        },
      });
      try {
        await fixture(
          [{
            toolCalls: [
              { ...failCall, input: { status: "completed", output: "done" } },
              markerCall,
            ],
          }],
          async (runtime, model, dispatched) => {
            if (streaming) {
              const body = await new Response(
                await runtime.stream([{
                  id: "input-1",
                  role: "user",
                  parts: [{ type: "text", text: "run" }],
                }], { runId: "run-current" }),
              ).text();
              assert(body.includes('"type":"message-finish"'), body);
              assert(body.includes('"toolCallId":"marker-1"'), body);
              assert(!body.includes('"type":"error"'), body);
            } else {
              const result = await runtime.generate("run", { runId: "run-current" });
              assertEquals(result.object, "done");
              assert(
                result.messages.some((message) =>
                  message.parts.some((part) =>
                    part.type === "tool-result" && part.toolCallId === "marker-1"
                  )
                ),
              );
            }
            assertEquals(replacedCalls, 0);
            assertEquals(dispatched, [failCall.name]);
            assertEquals(model.callCount, 1);
          },
          () => ({
            content: [],
            structuredContent: {
              completed: true,
              run: { run_id: "run-current", status: "completed", output: "done" },
            },
          }),
        );
      } finally {
        Object.defineProperty(prototype, "unresolvedTerminalSiblings", original);
      }
    });
  }

  for (const streaming of [false, true]) {
    it(`retains schema-valid finalize strings through security middleware; stream=${streaming}`, async () => {
      await fixture(
        [{ toolCalls: [{ ...failCall, input: { status: "completed", output: "done" } }] }],
        async (runtime) => {
          if (streaming) {
            const body = await new Response(
              await runtime.stream([{
                id: "input-1",
                role: "user",
                parts: [{ type: "text", text: "run" }],
              }], { runId: "run-current" }),
            ).text();
            assert(body.includes('"type":"message-finish"'), body);
            assert(body.includes('"object":"done"'), body);
          } else {
            assertEquals((await runtime.generate("run", { runId: "run-current" })).object, "done");
          }
        },
        () => ({
          content: [],
          structuredContent: {
            completed: true,
            run: { run_id: "run-current", status: "completed", output: "done" },
          },
        }),
        defineSchema((v) => v.string())(),
        [securityMiddleware({ output: { filterPII: true } })],
      );
    });
  }

  for (const streaming of [false, true]) {
    it(`preserves schema-valid finalize strings through security middleware; stream=${streaming}`, async () => {
      const output = "done";
      await fixture(
        [{ toolCalls: [{ ...failCall, input: { status: "completed", output } }] }],
        async (runtime, model, dispatched) => {
          if (streaming) {
            const body = await new Response(
              await runtime.stream([{
                id: "input-1",
                role: "user",
                parts: [{ type: "text", text: "run" }],
              }], { runId: "run-current" }),
            ).text();
            assert(body.includes('"type":"message-finish"'), body);
            assert(!body.includes('"type":"error"'), body);
            assert(body.includes("done"), body);
          } else {
            const response = await runtime.generate("run", { runId: "run-current" });
            assertEquals(response.object, output);
          }
          assertEquals(model.callCount, 1);
          assertEquals(dispatched, [failCall.name]);
        },
        () => ({
          content: [],
          structuredContent: {
            completed: true,
            run: { run_id: "run-current", status: "completed", output },
          },
        }),
        defineSchema((v) => v.string())(),
        [securityMiddleware({ output: { filterPII: true } })],
      );
    });
  }

  for (const streaming of [false, true]) {
    it(`revalidates filtered finalize output against its schema; stream=${streaming}`, async () => {
      const output = { email: "john@example.com" };
      await fixture(
        [{ toolCalls: [{ ...failCall, input: { status: "completed", output } }] }],
        async (runtime) => {
          if (streaming) {
            const body = await new Response(
              await runtime.stream([{
                id: "input-1",
                role: "user",
                parts: [{ type: "text", text: "run" }],
              }], { runId: "run-current" }),
            ).text();
            assert(!body.includes('"type":"message-finish"'), body);
            assert(body.includes('"type":"error"'), body);
          } else {
            await assertRejects(
              () => runtime.generate("run", { runId: "run-current" }),
              Error,
              "failed outputSchema validation",
            );
          }
        },
        () => ({
          content: [],
          structuredContent: {
            completed: true,
            run: { run_id: "run-current", status: "completed", output },
          },
        }),
        defineSchema((v) => v.object({ email: v.string().email() }))(),
        [securityMiddleware({ output: { filterPII: true } })],
      );
    });
  }

  for (const streaming of [false, true]) {
    it(`passes finalize success through output middleware; stream=${streaming}`, async () => {
      let processed = 0;
      await fixture(
        [{ toolCalls: [{ ...failCall, input: { status: "completed", output: "secret" } }] }],
        async (runtime) => {
          if (streaming) {
            const body = await new Response(
              await runtime.stream([{
                id: "input-1",
                role: "user",
                parts: [{ type: "text", text: "run" }],
              }], { runId: "run-current" }),
            ).text();
            assert(body.includes("REDACTED"));
            assert(!body.includes('"delta":"secret"'));
          } else {
            assertEquals(
              (await runtime.generate("run", { runId: "run-current" })).text,
              "REDACTED",
            );
          }
          assertEquals(processed, 1);
        },
        () => ({
          content: [],
          structuredContent: {
            completed: true,
            run: { run_id: "run-current", status: "completed", output: "secret" },
          },
        }),
        undefined,
        [async (_context, next) => {
          const response = await next();
          processed++;
          return { ...response, text: "REDACTED", object: "REDACTED" };
        }],
      );
    });
  }

  it("returns committed output for finalize success without further model or tools", async () => {
    const output = { ingested: 3 };
    await fixture(
      [{ toolCalls: [{ ...failCall, input: { status: "completed", output } }, markerCall] }, {
        text: "must not run",
      }],
      async (runtime, model, dispatched) => {
        const result = await runtime.generate("run", { runId: "run-current" });
        assertEquals(result.status, "completed");
        assertEquals(result.object, output);
        assert(
          result.messages.some((message) =>
            message.parts.some((part) =>
              part.type === "tool-result" && part.toolCallId === "fail-1"
            )
          ),
        );
        assert(
          result.toolCalls?.some((call) =>
            call.name === failCall.name && call.status === "completed"
          ),
        );
        assert(
          result.messages.some((message) =>
            message.parts.some((part) =>
              part.type === "tool-result" && part.toolCallId === "marker-1"
            )
          ),
        );
        assert((result.usage?.totalTokens ?? 0) > 0);
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 1);
      },
      () => ({
        content: [],
        structuredContent: {
          completed: true,
          run: { run_id: "run-current", status: "completed", output },
        },
      }),
    );
  });

  it("rejects schema-invalid finalization then accepts valid output without ending early", async () => {
    const output = { ingested: 3 };
    await fixture(
      [
        {
          toolCalls: [{
            ...failCall,
            input: { status: "completed", output: { ingested: "invalid" } },
          }],
        },
        { toolCalls: [{ ...failCall, input: { status: "completed", output } }, markerCall] },
      ],
      async (runtime, model, dispatched) => {
        const result = await runtime.generate("run", { runId: "run-current" });
        assertEquals(result.object, output);
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 2);
      },
      () => ({
        content: [],
        structuredContent: {
          completed: true,
          run: { run_id: "run-current", status: "completed", output },
        },
      }),
      {
        type: "object",
        properties: { ingested: { type: "number" } },
        required: ["ingested"],
      },
    );
  });

  it("streams finalize success and its committed output without an error", async () => {
    const output = { ingested: 3 };
    await fixture(
      [{ toolCalls: [{ ...failCall, input: { status: "completed", output } }, markerCall] }, {
        text: "must not run",
      }],
      async (runtime, model, dispatched) => {
        const stream = await runtime.stream([{
          id: "input-1",
          role: "user",
          parts: [{ type: "text", text: "run" }],
        }], { runId: "run-current" });
        const text = await new Response(stream).text();
        assert(text.includes('"type":"message-finish"'), text);
        assert(text.includes('"object":{"ingested":3}'), text);
        assert(!text.includes('"type":"error"'), text);
        assert(text.includes('"type":"tool-output-available","toolCallId":"fail-1"'), text);
        assert(text.includes('"type":"tool-output-error","toolCallId":"marker-1"'), text);
        const history = await runtime.getMemory().getMessages();
        assert(
          history.some((message) =>
            message.parts.some((part) =>
              part.type === "tool-result" && part.toolCallId === "fail-1"
            )
          ),
          JSON.stringify(history),
        );
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 1);
      },
      () => ({
        content: [],
        structuredContent: {
          completed: true,
          run: { run_id: "run-current", status: "completed", output },
        },
      }),
    );
  });

  it("streams committed string output after preliminary model text", async () => {
    const output = "Three emails ingested";
    await fixture(
      [{
        parts: [
          { type: "text-delta", text: "Preparing the result." },
          {
            type: "tool-call",
            toolCallId: failCall.id,
            toolName: failCall.name,
            input: { status: "completed", output },
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
      }],
      async (runtime) => {
        const stream = await runtime.stream([{
          id: "input-1",
          role: "user",
          parts: [{ type: "text", text: "run" }],
        }], { runId: "run-current" });
        let responseMessage: ChatUiMessage | undefined;
        for await (
          const _chunk of createChatUiMessageStreamFromDataStream({ stream }, {
            onFinish: (finish) => {
              responseMessage = finish.responseMessage;
            },
          })
        ) { /* Drain the collected response. */ }
        const parts = responseMessage?.parts ?? [];
        assertEquals(parts.filter((part) => part.type === "text").map((part) => part.text), [
          "Preparing the result.",
          output,
        ]);
        const terminalToolIndex = parts.findIndex((part) =>
          "toolCallId" in part && part.toolCallId === failCall.id
        );
        assert(terminalToolIndex > 0);
        assertEquals(parts.at(-1), { type: "text", text: output });
      },
      () => ({
        content: [],
        structuredContent: {
          completed: true,
          run: { run_id: "run-current", status: "completed", output },
        },
      }),
    );
  });

  it("stops generation and later tools after the real MCP failure is accepted", async () => {
    await fixture(
      [{ toolCalls: [failCall, markerCall] }, { text: "must not run" }],
      async (runtime, model, dispatched) => {
        await assertRejects(
          () => runtime.generate("run", { runId: "run-current" }),
          Error,
          failure.message,
        );
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 1);
        assertEquals(model.calls[0]?.abortSignal?.aborted, true);
      },
    );
  });

  it("streams a terminal error without later tools, model turns or successful finish", async () => {
    await fixture(
      [{ toolCalls: [failCall, markerCall] }, { text: "must not run" }],
      async (runtime, model, dispatched) => {
        let finished = false;
        const stream = await runtime.stream(
          [{ id: "input-1", role: "user", parts: [{ type: "text", text: "run" }] }],
          { runId: "run-current" },
          {
            onFinish: () => {
              finished = true;
            },
          },
        );
        const text = await new Response(stream).text();
        assert(text.includes(failure.code), text);
        assert(!text.includes('"type":"message-finish"'), text);
        assertEquals(finished, false);
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 1);
      },
    );
  });

  it("reconciles a lost reply with the same idempotent failure call", async () => {
    await fixture([{ toolCalls: [failCall, markerCall] }], async (runtime, model, dispatched) => {
      await assertRejects(
        () => runtime.generate("run", { runId: "run-current" }),
        Error,
        failure.message,
      );
      assertEquals(dispatched, [failCall.name, failCall.name]);
      assertEquals(model.callCount, 1);
    }, (_name, count) => {
      if (count === 1) throw new TypeError("reply lost after commit");
      return { structuredContent: { ...failedResult, completed: false }, content: [] };
    });
  });

  it("stops locally when neither terminal write response can be confirmed", async () => {
    await fixture([{ toolCalls: [failCall, markerCall] }], async (runtime, model, dispatched) => {
      await assertRejects(
        () => runtime.generate("run", { runId: "run-current" }),
        Error,
        "could not be confirmed",
      );
      assertEquals(dispatched, [failCall.name, failCall.name]);
      assertEquals(model.callCount, 1);
    }, () => {
      throw new TypeError("connection lost");
    });
  });

  it("stops after an unrecognized terminal reply instead of starting another model turn", async () => {
    await fixture(
      [{ toolCalls: [failCall, markerCall] }, { text: "must not run" }],
      async (runtime, model, dispatched) => {
        await assertRejects(
          () => runtime.generate("run", { runId: "run-current" }),
          Error,
          "could not be confirmed",
        );
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 1);
      },
      () => ({ content: [], structuredContent: { completed: true } }),
    );
  });

  for (const streaming of [false, true]) {
    for (const lostReply of [false, true]) {
      it(`closes unknown finalize calls and undispatched siblings; stream=${streaming}, lost=${lostReply}`, async () => {
        await fixture(
          [{ toolCalls: [failCall, markerCall] }],
          async (runtime, model, dispatched) => {
            if (streaming) {
              const text = await new Response(
                await runtime.stream([
                  { id: "input-1", role: "user", parts: [{ type: "text", text: "run" }] },
                ], { runId: "run-current" }),
              ).text();
              assert(text.includes('"type":"tool-output-error","toolCallId":"fail-1"'), text);
              assert(text.includes('"type":"tool-output-error","toolCallId":"marker-1"'), text);
              assert(!text.includes('"type":"message-finish"'), text);
            } else {
              await assertRejects(
                () => runtime.generate("run", { runId: "run-current" }),
                Error,
                "could not be confirmed",
              );
            }
            const history = await runtime.getMemory().getMessages();
            for (const id of [failCall.id, markerCall.id]) {
              const results = history.flatMap((message) => message.parts).filter((part) =>
                part.type === "tool-result" && part.toolCallId === id
              );
              assertEquals(results.length, 1, JSON.stringify(history));
            }
            assertEquals(dispatched, lostReply ? [failCall.name, failCall.name] : [failCall.name]);
            assertEquals(model.callCount, 1);
          },
          () => {
            if (lostReply) throw new TypeError("connection lost");
            return { content: [], structuredContent: { completed: true } };
          },
        );
      });
    }
  }

  for (const status of ["failed", "cancelled"] as const) {
    it(`preserves a resumed ${status} terminal result through transactional validation`, async () => {
      let validated = false;
      await fixture(
        [{ text: "must not run" }],
        async (runtime, model, dispatched) => {
          const text = await new Response(
            await runtime.stream([
              { id: "resume-input", role: "user", parts: [{ type: "text", text: "resume" }] },
            ], { runId: "run-current" }),
          ).text();
          assert(!text.includes('"type":"message-finish"'), text);
          const history = await runtime.getMemory().getMessages();
          assert(
            history.some((message) =>
              message.parts.some((part) =>
                part.type === "tool-result" && part.toolCallId === "fail-1:resume-1"
              )
            ),
            JSON.stringify(history),
          );
          assert(validated);
          assertEquals(model.callCount, 0);
          assertEquals(dispatched, [failCall.name]);
        },
        () => ({
          content: [],
          structuredContent: {
            completed: true,
            run: { run_id: "run-current", status, error: failure },
          },
        }),
        undefined,
        [async (context, next) => {
          registerTurnProviderRequestValidator(context, async () => {
            validated = true;
          });
          return await next();
        }],
        { ...failCall, id: "fail-1:resume-1" },
      );
    });
  }

  it("rolls back a rejected resumed turn before dispatching its terminal action", async () => {
    await fixture(
      [{ text: "must not run" }],
      async (runtime, model, dispatched) => {
        const text = await new Response(
          await runtime.stream([
            { id: "resume-input", role: "user", parts: [{ type: "text", text: "rejected" }] },
          ], { runId: "run-current" }),
        ).text();
        assert(!text.includes('"type":"message-finish"'), text);
        assertEquals(dispatched, []);
        assertEquals(model.callCount, 0);
        assertEquals(await runtime.getMemory().getMessages(), []);
      },
      undefined,
      undefined,
      [async (context, next) => {
        registerTurnProviderRequestValidator(context, async () => {
          throw new Error("Turn rejected");
        });
        return await next();
      }],
      { ...failCall, id: "fail-1:resume-1" },
    );
  });

  it("keeps invalid failure arguments recoverable and dispatches no terminal write", async () => {
    await fixture([{ toolCalls: [{ ...failCall, input: { code: "", message: "" } }, markerCall] }, {
      text: "recovered",
    }], async (runtime, model, dispatched) => {
      const response = await runtime.generate("run", { runId: "run-current" });
      assertEquals(response.text, "recovered");
      assertEquals(dispatched, [markerCall.name]);
      assertEquals(model.callCount, 2);
    }, () => ({ content: [], structuredContent: { ok: true } }));
  });

  it("rejects missing current-run binding without dispatching a terminal write", async () => {
    await fixture(
      [{ toolCalls: [failCall] }, { text: "recovered" }],
      async (runtime, _model, dispatched) => {
        const response = await runtime.generate("run", {
          runId: "unbound",
          runIdBindsToolAuthorization: false,
        });
        assertEquals(response.text, "recovered");
        assertEquals(dispatched, []);
      },
    );
  });

  it("keeps a rejected authority error recoverable", async () => {
    await fixture(
      [{ toolCalls: [failCall] }, { text: "recovered" }],
      async (runtime, model, dispatched) => {
        const response = await runtime.generate("run", { runId: "run-current" });
        assertEquals(response.text, "recovered");
        assertEquals(dispatched, [failCall.name]);
        assertEquals(model.callCount, 2);
      },
      () => ({
        isError: true,
        content: [{ type: "text", text: "Current execution authority required" }],
      }),
    );
  });

  for (const existingActiveReceipt of [false, true]) {
    it(`retries a trusted resume after receipt persistence fails without duplicating admission; activeReceipt=${existingActiveReceipt}`, async () => {
      const call = { ...failCall, input: { status: "completed", output: "done" } };
      await fixture(
        [{ text: "must not dispatch" }],
        async (runtime, model, dispatched) => {
          const memory = runtime.getMemory();
          const original: Message = {
            id: "original-parked-turn",
            role: "assistant",
            parts: [call, markerCall].map((item) => ({
              type: "tool-call",
              toolCallId: item.id,
              toolName: item.name,
              args: item.input,
            })),
          };
          await memory.add(original);
          if (existingActiveReceipt) {
            await memory.add({
              id: "existing-active-receipt",
              role: "tool",
              parts: [{
                type: "tool-result",
                toolCallId: call.id,
                toolName: call.name,
                result: { retained: "original receipt" },
              }],
            });
          }
          const begin = memory.beginTransaction!.bind(memory);
          let rejectReceipts = true;
          memory.beginTransaction = async () => {
            const transaction = await begin();
            return {
              ...transaction,
              add: async (message) => {
                if (rejectReceipts && message.parts.some((part) => part.type === "tool-result")) {
                  throw new Error("First resume receipt unavailable");
                }
                await transaction.add(message);
              },
            };
          };
          const first = await new Response(
            await runtime.stream([{
              id: "first-resume-input",
              role: "user",
              parts: [{ type: "text", text: "resume" }],
            }], { runId: "run-current" }),
          ).text();
          assert(first.includes("First resume receipt unavailable"), first);
          assert(!first.includes('"type":"message-finish"'), first);
          assertEquals(
            (await memory.getMessages()).filter((message) => message.role === "assistant").map((
              message,
            ) => message.id),
            [original.id],
          );
          rejectReceipts = false;
          const body = await new Response(
            await runtime.stream([{
              id: "second-resume-input",
              role: "user",
              parts: [{ type: "text", text: "resume" }],
            }], { runId: "run-current" }),
          ).text();
          assert(body.includes('"type":"message-finish"'), body);
          const history = await memory.getMessages();
          assertEquals(
            history.filter((message) => message.role === "assistant").map((message) => message.id),
            [original.id],
          );
          const receipts = history.flatMap((message) =>
            message.parts.flatMap((part) => part.type === "tool-result" ? [part] : [])
          );
          assertEquals(receipts.map((part) => part.toolCallId), [call.id, markerCall.id]);
          if (existingActiveReceipt) {
            assertEquals((receipts[0] as { result?: unknown })?.result, {
              retained: "original receipt",
            });
          }
          assertEquals(dispatched, [call.name, call.name]);
          assertEquals(model.callCount, 0);
          const siblingOutputs = body.split("\n").filter((line) =>
            line.includes('"toolCallId":"marker-1"') && line.includes('"type":"tool-output-error"')
          );
          assertEquals(siblingOutputs.length, 1, body);
        },
        () => ({
          content: [],
          structuredContent: {
            completed: true,
            run: { run_id: "run-current", status: "completed", output: "done" },
          },
        }),
        undefined,
        [async (context, next) => {
          registerTurnProviderRequestValidator(context, async () => {});
          return await next();
        }],
        call,
      );
    });
  }

  for (const sameArguments of [false, true]) {
    it(`trusted resume never joins an older turn with reused call identity; sameArguments=${sameArguments}`, async () => {
      const call = { ...failCall, input: { status: "completed", output: "current" } };
      const oldCall = {
        ...call,
        input: { status: "completed", output: sameArguments ? "current" : "old" },
      };
      await fixture(
        [{ text: "must not dispatch" }],
        async (runtime, model, dispatched) => {
          const memory = runtime.getMemory();
          await memory.add({
            id: "old-multi-call",
            role: "assistant",
            parts: [oldCall, markerCall].map((item) => ({
              type: "tool-call",
              toolCallId: item.id,
              toolName: item.name,
              args: item.input,
            })),
          });
          await memory.add({
            id: "old-active-receipt",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: call.id,
              toolName: call.name,
              result: { old: "receipt" },
            }],
          });
          await memory.add({
            id: "later-user-turn",
            role: "user",
            parts: [{ type: "text", text: "new operation" }],
          });
          await memory.add({
            id: "genuine-later-singleton",
            role: "assistant",
            parts: [{
              type: "tool-call",
              toolCallId: call.id,
              toolName: call.name,
              args: call.input,
            }],
          });
          const body = await new Response(
            await runtime.stream([{
              id: "resume-input",
              role: "user",
              parts: [{ type: "text", text: "resume" }],
            }], { runId: "run-current" }),
          ).text();
          assert(body.includes('"type":"message-finish"'), body);
          assert(!body.includes('"toolCallId":"marker-1"'), body);
          const history = await memory.getMessages();
          assertEquals(
            history.filter((message) => message.role === "assistant").map((message) => message.id),
            ["old-multi-call", "genuine-later-singleton"],
          );
          const receipts = history.flatMap((message) =>
            message.parts.flatMap((part) => part.type === "tool-result" ? [part] : [])
          );
          assertEquals(receipts.map((part) => part.toolCallId), [call.id, call.id]);
          assertEquals((receipts[0] as { result?: unknown })?.result, { old: "receipt" });
          assertEquals(
            (receipts[1] as { result?: { run?: { output?: unknown } } })?.result?.run?.output,
            "current",
          );
          assertEquals(dispatched, [call.name]);
          assertEquals(model.callCount, 0);
        },
        () => ({
          content: [],
          structuredContent: {
            completed: true,
            run: { run_id: "run-current", status: "completed", output: "current" },
          },
        }),
        undefined,
        undefined,
        call,
      );
    });
  }

  for (const streaming of [false, true]) {
    it(`keeps receipt membership scoped to the current admitted turn; stream=${streaming}`, async () => {
      const earlier = { ...markerCall, id: "earlier-completed" };
      const secondPending = { ...markerCall, id: "marker-2" };
      const terminal = { ...failCall, input: { status: "completed", output: "done" } };
      await fixture(
        [{ toolCalls: [earlier, terminal, markerCall, secondPending] }],
        async (runtime, model, dispatched) => {
          const memory = runtime.getMemory();
          await memory.add({
            id: "unrelated-earlier-turn",
            role: "assistant",
            parts: [{
              type: "tool-call",
              toolCallId: markerCall.id,
              toolName: markerCall.name,
              args: {},
            }],
          });
          await memory.add({
            id: "unrelated-earlier-result",
            role: "tool",
            parts: [{
              type: "tool-result",
              toolCallId: markerCall.id,
              toolName: markerCall.name,
              result: { old: "must remain" },
            }],
          });
          if (streaming) {
            const body = await new Response(
              await runtime.stream([{
                id: "input",
                role: "user",
                parts: [{ type: "text", text: "run" }],
              }], { runId: "run-current" }),
            ).text();
            assert(body.includes('"type":"message-finish"'), body);
          } else {assertEquals(
              (await runtime.generate("run", { runId: "run-current" })).object,
              "done",
            );}
          const receipts = (await memory.getMessages()).flatMap((message) =>
            message.parts.flatMap((part) => part.type === "tool-result" ? [part] : [])
          );
          assertEquals(receipts.map((part) => part.toolCallId), [
            markerCall.id,
            earlier.id,
            terminal.id,
            markerCall.id,
            secondPending.id,
          ]);
          assertEquals((receipts[0] as { result?: unknown })?.result, { old: "must remain" });
          assertEquals((receipts[1] as { result?: unknown })?.result, { already: "completed" });
          assertEquals(dispatched, [markerCall.name, failCall.name]);
          assertEquals(model.callCount, 1);
        },
        (name) => ({
          content: [],
          structuredContent: name === markerCall.name ? { already: "completed" } : {
            completed: true,
            run: { run_id: "run-current", status: "completed", output: "done" },
          },
        }),
      );
    });
  }

  for (const phase of ["add", "commit"] as const) {
    for (const streaming of [false, true]) {
      for (const status of ["completed", "failed"] as const) {
        it(`preserves the acknowledged winner when receipt ${phase} fails; stream=${streaming}, status=${status}`, async () => {
          const output = { canonical: "retained" };
          const call = { ...failCall, input: { status: "completed", output } };
          let observedError: unknown;
          await fixture(
            [{ toolCalls: [call, markerCall] }],
            async (runtime, model, dispatched) => {
              const memory = runtime.getMemory();
              const begin = memory.beginTransaction!.bind(memory);
              const persistenceError = new Error(`Receipt ${phase} unavailable`);
              memory.beginTransaction = async () => {
                const transaction = await begin();
                let hasReceipt = false;
                return {
                  ...transaction,
                  add: async (message) => {
                    if (message.parts.some((part) => part.type === "tool-result")) {
                      hasReceipt = true;
                      if (phase === "add") throw persistenceError;
                    }
                    await transaction.add(message);
                  },
                  commit: async () => {
                    if (phase === "commit" && hasReceipt) throw persistenceError;
                    await transaction.commit();
                  },
                };
              };
              if (streaming) {
                const body = await new Response(
                  await runtime.stream([{
                    id: "input",
                    role: "user",
                    parts: [{ type: "text", text: "run" }],
                  }], { runId: "run-current" }),
                ).text();
                assert(!body.includes('"type":"message-finish"'), body);
                assert(body.includes('"type":"error"'), body);
                assert(!body.includes("RUN_OUTCOME_UNKNOWN"), body);
                assert(body.includes(`Receipt ${phase} unavailable`), body);
              } else {
                observedError = await assertRejects(
                  () => runtime.generate("run", { runId: "run-current" }),
                  Error,
                  `Receipt ${phase} unavailable`,
                );
              }
              if (!streaming) {
                assert(
                  observedError instanceof Error,
                  "Persistence error must retain its acknowledged terminal cause",
                );
                const cause = observedError.cause as {
                  terminalOutcome: unknown;
                  persistenceError: unknown;
                };
                assert(cause && isTerminalRunControlError(cause.terminalOutcome));
                assertEquals(cause.persistenceError, persistenceError);
                assertEquals(cause.terminalOutcome.status, status);
                assertEquals(
                  cause.terminalOutcome.output,
                  status === "completed" ? output : undefined,
                );
              }
              const admitted = await memory.getMessages();
              assert(admitted.some((message) =>
                message.role === "assistant" &&
                message.parts.some((part) => "toolCallId" in part && part.toolCallId === call.id)
              ));
              assertEquals(dispatched, [failCall.name]);
              assertEquals(model.callCount, 1);
            },
            () => ({
              content: [],
              structuredContent: {
                completed: true,
                run: {
                  run_id: "run-current",
                  status,
                  ...(status === "completed" ? { output } : { error: failure }),
                },
              },
            }),
            undefined,
            [async (context, next) => {
              registerTurnProviderRequestValidator(context, async () => {});
              try {
                return await next();
              } catch (error) {
                observedError = error;
                throw error;
              }
            }],
          );
        });
      }
    }
  }

  it("stream callback mutation cannot replace admitted call identity", async () => {
    const call = { ...failCall, input: { status: "completed", output: "done" } };
    await fixture([{ toolCalls: [call, markerCall] }], async (runtime, model, dispatched) => {
      const body = await new Response(
        await runtime.stream(
          [{
            id: "input",
            role: "user",
            parts: [{ type: "text", text: "run" }],
          }],
          { runId: "run-current" },
          {
            onToolCall: (toolCall) => {
              toolCall.id = "application-replacement";
              toolCall.name = "application-name";
            },
          },
        ),
      ).text();
      assert(body.includes('"type":"message-finish"'), body);
      const receiptIds = (await runtime.getMemory().getMessages()).flatMap((message) =>
        message.parts.flatMap((part) => part.type === "tool-result" ? [part.toolCallId] : [])
      );
      assertEquals(receiptIds, [call.id, markerCall.id]);
      assertEquals(dispatched, [failCall.name]);
      assertEquals(model.callCount, 1);
    }, () => ({
      content: [],
      structuredContent: {
        completed: true,
        run: { run_id: "run-current", status: "completed", output: "done" },
      },
    }));
  });
});

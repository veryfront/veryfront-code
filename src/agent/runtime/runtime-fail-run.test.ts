import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { AgentRuntime } from "./index.ts";
import type { AgentConfig } from "#veryfront/agent/types.ts";
import { scriptedModel, type ScriptedTurn } from "./model-runtime.test-helpers.ts";

const failure = { code: "INGEST_FAILED", message: "no email ingested" };
const failCall = {
  id: "fail-1",
  name: "veryfront__finalized",
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
      tools: { veryfront__finalized: true, veryfront__marker: true },
      maxSteps: 3,
      outputSchema,
      resolveRuntimeState: ({ context }) => ({
        context: {
          runId: context?.runId,
          runIdBindsToolAuthorization: context?.runIdBindsToolAuthorization,
          refreshed: true,
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
    });
    await run(runtime, model, dispatched);
  });
}

describe("runtime finalized terminal control", () => {
  it("returns committed output for finalized success without further model or tools", async () => {
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

  it("streams finalized success and its committed output without an error", async () => {
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

  it("streams committed string output as a visible text delta", async () => {
    const output = "Three emails ingested";
    await fixture(
      [{ toolCalls: [{ ...failCall, input: { status: "completed", output } }] }],
      async (runtime) => {
        const stream = await runtime.stream([{
          id: "input-1",
          role: "user",
          parts: [{ type: "text", text: "run" }],
        }], { runId: "run-current" });
        const body = await new Response(stream).text();
        assert(body.includes('"type":"text-delta"'), body);
        assert(body.includes('"delta":"Three emails ingested"'), body);
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
});

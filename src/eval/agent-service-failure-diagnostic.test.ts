import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { datasets, evalAgent } from "veryfront/eval";
import { createAgentServiceEvalAdapter } from "veryfront/eval/agent-service";

const definition = evalAgent({
  id: "eval:failure-diagnostic",
  target: "agent:assistant",
  dataset: datasets.inline([{ id: "example", input: "Fixture" }]),
});

function context() {
  return { definition, example: { id: "example", input: "Fixture" }, repetition: 1 };
}

describe("agent-service failure diagnostic", () => {
  it("retains only fixed failure metadata while preserving the original fetch failure", async () => {
    const cause = new Error("private transport detail");
    Object.defineProperty(cause, "code", { value: "ECONNREFUSED" });
    const adapter = createAgentServiceEvalAdapter({
      authToken: "fixture-token",
      fetch: () => Promise.reject(new TypeError("fetch failed", { cause })),
    });
    const result = await adapter(context());
    assert(typeof result !== "string");
    assertEquals(result.completed, false);
    assertEquals(result.error, "fetch failed");
    assertEquals(result.output, {
      text: "",
      agUi: {
        responseStatus: 0,
        eventTypes: [],
        runError: "fetch failed",
        failure: { stage: "request-fetch", errorName: "TypeError", transportCode: "ECONNREFUSED" },
      },
    });
    assertEquals(result.trace, { events: [], toolCalls: [] });
  });
});

describe("agent-service failure stages", () => {
  it("distinguishes request construction from transport failures", async () => {
    const input: { recursive?: unknown } = {};
    input.recursive = input;
    let requests = 0;
    const adapter = createAgentServiceEvalAdapter({
      authToken: "fixture-token",
      fetch: () => {
        requests++;
        return Promise.resolve(new Response(""));
      },
    });
    const result = await adapter({ ...context(), example: { id: "example", input } });
    assert(typeof result !== "string");
    assertEquals(requests, 0);
    assertEquals(failure(result.output).stage, "request-build");
    assertEquals(result.completed, false);
  });

  it("distinguishes failed response consumption", async () => {
    const adapter = createAgentServiceEvalAdapter({
      authToken: "fixture-token",
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new SyntaxError("private stream detail"));
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
    });
    const result = await adapter(context());
    assert(typeof result !== "string");
    assertEquals(failure(result.output), {
      stage: "response-read",
      errorName: "SyntaxError",
      transportCode: "redacted",
    });
    assertEquals(result.completed, false);
    assertEquals(result.error, "private stream detail");
  });

  it("keeps progress callback failures inside response reading", async () => {
    const adapter = createAgentServiceEvalAdapter({
      authToken: "fixture-token",
      onProgress: () => {
        throw new RangeError("private callback detail");
      },
      progressThrottleMs: 0,
      fetch: () =>
        Promise.resolve(
          new Response(
            'event: RunStarted\ndata: {"runId":"fixture"}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
    });
    const result = await adapter(context());
    assert(typeof result !== "string");
    assertEquals(failure(result.output).stage, "response-read");
    assertEquals(failure(result.output).errorName, "RangeError");
    assertEquals(result.completed, false);
  });

  it("labels failures after response parsing as result processing", async () => {
    let calls = 0;
    const adapter = createAgentServiceEvalAdapter({
      authToken: "fixture-token",
      now: () => {
        if (++calls === 2) throw new RangeError("private clock detail");
        return 10;
      },
      fetch: () =>
        Promise.resolve(
          new Response(
            'event: RunFinished\ndata: {"runId":"fixture"}\n\n',
            { headers: { "content-type": "text/event-stream" } },
          ),
        ),
    });
    const result = await adapter(context());
    assert(typeof result !== "string");
    assertEquals(failure(result.output), {
      stage: "result-processing",
      errorName: "RangeError",
      transportCode: "redacted",
    });
    assertEquals(result.completed, false);
  });

  it("does not add catch diagnostics to successful or HTTP failure results", async () => {
    for (const status of [200, 500]) {
      const adapter = createAgentServiceEvalAdapter({
        authToken: "fixture-token",
        fetch: () =>
          Promise.resolve(
            new Response(
              'event: RunFinished\ndata: {"runId":"fixture"}\n\n',
              { status, headers: { "content-type": "text/event-stream" } },
            ),
          ),
      });
      const result = await adapter(context());
      assert(typeof result !== "string");
      assertEquals(result.completed, status === 200);
      assertEquals("failure" in agUi(result.output), false);
    }
  });
});

function agUi(output: unknown): Record<string, unknown> {
  if (
    !output || typeof output !== "object" || !("agUi" in output) ||
    !output.agUi || typeof output.agUi !== "object"
  ) throw new Error("Missing AG-UI output");
  return Object.fromEntries(Object.entries(output.agUi));
}
function failure(output: unknown): Record<string, unknown> {
  const value = agUi(output).failure;
  if (!value || typeof value !== "object") throw new Error("Missing failure diagnostic");
  return Object.fromEntries(Object.entries(value));
}

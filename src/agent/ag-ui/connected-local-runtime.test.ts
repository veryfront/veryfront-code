import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { createConnectedLocalRuntime } from "./connected-local-runtime.ts";
import type { ExternalAgentWorkerClient } from "../service/external-worker-client.ts";

function fixture(
  options: {
    abortOnPath?: string;
    controller?: AbortController;
    claimNull?: boolean;
    requireExactClaim?: boolean;
    appendGate?: Promise<void>;
    appendFailure?: boolean;
    renewOutcome?: "missing" | "error";
    renew?: () => Promise<unknown>;
    studioUrl?: string;
    apiFailure?: { path: string; status: number; detail?: string; invalidJson?: boolean };
    registerFailureOnce?: boolean;
    completeFailure?: boolean;
    claimConversationMismatch?: boolean;
  } = {},
) {
  const requests: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = [];
  const completed: string[] = [];
  const logs: string[] = [];
  let markAppendStarted!: () => void;
  const appendStarted = new Promise<void>((resolve) => markAppendStarted = resolve);
  const batches: unknown[][] = [];
  let id = 0;
  let registrations = 0;
  const sequences: number[] = [];
  const client = {
    registerWorker: () => {
      registrations++;
      if (options.registerFailureOnce && registrations === 1) {
        return Promise.reject(new Error("registration offline"));
      }
      return Promise.resolve({ id: "worker" });
    },
    heartbeatWorker: () => Promise.resolve({}),
    claimRun: (input: { canonicalRunId?: string }) =>
      Promise.resolve(
        options.claimNull || (options.requireExactClaim && input.canonicalRunId !== `run-${id}`)
          ? null
          : {
            run_id: `run-${id}`,
            conversation_id: options.claimConversationMismatch
              ? "foreign-conversation"
              : `conversation-${id}`,
            message_id: "message",
            latest_external_event_sequence: 0,
          },
      ),
    renewLease: () =>
      options.renew
        ? options.renew()
        : options.renewOutcome === "error"
        ? Promise.reject(new Error("API offline"))
        : Promise.resolve(options.renewOutcome === "missing" ? null : {}),
    appendRunEvents: (input: { events: unknown[] }) => {
      batches.push(input.events);
      return Promise.resolve();
    },
    completeRun: (input: { status: string }) => {
      completed.push(input.status);
      return options.completeFailure
        ? Promise.reject(new Error("finalization offline"))
        : Promise.resolve();
    },
  } as unknown as ExternalAgentWorkerClient;
  const runtime = createConnectedLocalRuntime({
    apiBaseUrl: "http://localhost:4400",
    apiToken: "private",
    projectId: "project",
    projectSlug: "sample",
    environmentId: "env",
    studioUrl: options.studioUrl ?? "http://localhost:3440",
  }, {
    client,
    append: async (events, sequence) => {
      markAppendStarted();
      await options.appendGate;
      if (options.appendFailure) throw new Error("event append failed");
      sequences.push(sequence);
      batches.push(events);
      return { latestExternalEventSequence: sequence + events.length };
    },
    fetch: ((_url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(_url)).pathname;
      const body = JSON.parse(String(init?.body ?? "{}"));
      requests.push({ path, body, headers: new Headers(init?.headers) });
      if (path === options.apiFailure?.path) {
        return Promise.resolve(
          options.apiFailure.invalidJson
            ? new Response("not-json", { status: options.apiFailure.status })
            : Response.json({ detail: options.apiFailure.detail }, {
              status: options.apiFailure.status,
            }),
        );
      }
      if (path === options.abortOnPath) options.controller?.abort();
      if (path === "/conversations") {
        id++;
        return Promise.resolve(Response.json({ id: `conversation-${id}` }));
      }
      return Promise.resolve(Response.json({ id: `run-${id}` }));
    }) as typeof fetch,
    log: (message) => logs.push(message),
  });
  return {
    runtime,
    requests,
    completed,
    batches,
    sequences,
    logs,
    registrations: () => registrations,
    appendStarted,
  };
}

describe("connected local execution", () => {
  it("admits the selected project/environment and persists before forwarding output", async () => {
    const f = fixture();
    const run = await f.runtime.admit({
      agentId: "assistant",
      agentName: "Local Assistant",
      threadId: "client-thread",
      messages: [],
      signal: new AbortController().signal,
    });
    assertEquals(
      (f.requests.find((r) => r.path === "/runs")?.body.config as {
        agent_admission: { agent_identity: unknown };
      }).agent_admission.agent_identity,
      { name: "Local Assistant" },
    );
    assertEquals(run.runId, "run-1");
    assertEquals(
      (f.requests.find((r) => r.path === "/runs")?.body.config as {
        agent_admission: { source_target_kind: string };
      }).agent_admission.source_target_kind,
      "project",
    );
    assertEquals(f.requests.find((r) => r.path === "/runs")?.body.execution, {
      runtime: { type: "environment", id: "env" },
    });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (
          const event of [{ type: "text-delta", id: "text", delta: "hello" }, {
            type: "message-finish",
          }]
        ) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        c.close();
      },
    });
    const output = await new Response(run.wrapStream(body)).text();
    assertEquals(output.includes("hello"), true);
    assertEquals(f.batches.length > 0, true);
    assertEquals(f.sequences[0], 0);
    assertEquals(f.completed, ["completed"]);
    assertEquals(
      f.logs.some((line) => /\d{2}:\d{2}:\d{2}Z assistant started run-1/.test(line)),
      true,
    );
    assertEquals(f.logs.some((line) => /assistant completed run-1 \(\d+\.\d+s\)/.test(line)), true);
  });
  it("reuses one process worker while admitting different threads", async () => {
    const f = fixture();
    const runs = await Promise.all(
      ["first", "second"].map((threadId) =>
        f.runtime.admit({
          agentId: "assistant",
          threadId,
          messages: [],
          signal: new AbortController().signal,
        })
      ),
    );
    assertEquals(f.registrations(), 1);
    assertEquals(new Set(runs.map((run) => run.conversationId)).size, 2);
    await f.runtime.dispose();
    assertEquals(f.completed, ["cancelled", "cancelled"]);
  });
  it("does not admit an already cancelled request", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await assertRejects(() =>
      f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: controller.signal,
      })
    );
    assertEquals(f.requests, []);
    assertEquals(f.registrations(), 0);
  });
  it("cancels its accepted canonical run when abort arrives during admission", async () => {
    const controller = new AbortController();
    const f = fixture({ controller, abortOnPath: "/runs" });
    await assertRejects(() =>
      f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: controller.signal,
      })
    );
    assertEquals(f.requests.some((request) => request.path === "/runs/run-1/cancel"), true);
    assertEquals(f.completed, []);
  });
  it("cancels accepted execution when the worker claim is missing", async () => {
    const f = fixture({ claimNull: true });
    await assertRejects(() =>
      f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      })
    );
    assertEquals(f.requests.some((request) => request.path === "/runs/run-1/cancel"), true);
  });
  it("claims its accepted run even when another conversation is queued first", async () => {
    const f = fixture({ requireExactClaim: true });
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    await run.finish("completed");
    assertEquals(f.completed, ["completed"]);
    await f.runtime.dispose();
  });
  it("sends a stable canonical cancellation idempotency key", async () => {
    const f = fixture({ claimNull: true });
    await assertRejects(() =>
      f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      })
    );
    const cancellation = f.requests.find((request) => request.path === "/runs/run-1/cancel");
    assertEquals(cancellation?.headers.get("Idempotency-Key"), "local-cancel:run-1");
  });
  it("settles pending event appends before cancellation finalizes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => release = resolve);
    const f = fixture({ appendGate: gate });
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    const stream = run.wrapStream(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"type":"text-delta","delta":"hello"}\n\n'));
          c.close();
        },
      }),
    );
    const reader = stream.getReader();
    const read = reader.read();
    await f.appendStarted;
    const terminal = run.finish("cancelled");
    await Promise.resolve();
    assertEquals(f.completed, []);
    release();
    await terminal;
    await read;
    await reader.cancel().catch(() => {});
    assertEquals(f.completed, ["cancelled"]);
  });
  for (const outcome of ["missing", "error"] as const) {
    it(`records ${outcome} lease renewal as failure`, async () => {
      using time = new FakeTime();
      const f = fixture({ renewOutcome: outcome });
      const run = await f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      });
      await time.tickAsync(20_000);
      await assertRejects(() =>
        new Response(run.wrapStream(
          new ReadableStream({
            start(c) {
              c.close();
            },
          }),
        )).text()
      );
      assertEquals(f.completed, ["failed"]);
    });
  }
  for (const outcome of ["missing", "error"] as const) {
    it(`waits for in-flight ${outcome} renewal before successful finalization`, async () => {
      using time = new FakeTime();
      let resolveRenewal!: (value: unknown) => void;
      let rejectRenewal!: (error: unknown) => void;
      const pending = new Promise<unknown>((resolve, reject) => {
        resolveRenewal = resolve;
        rejectRenewal = reject;
      });
      const f = fixture({ renew: () => pending });
      const run = await f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      });
      await time.tickAsync(20_000);
      const terminal = run.finish("completed");
      await Promise.resolve();
      assertEquals(f.completed, []);
      if (outcome === "missing") resolveRenewal(null);
      else rejectRenewal(new Error("API offline"));
      await terminal;
      assertEquals(f.completed, ["failed"]);
      assertEquals(f.logs.some((line) => line.includes("assistant completed")), false);
    });
  }
  it("cleans accepted execution before allocating timers for an invalid Studio URL", async () => {
    using time = new FakeTime();
    let renewals = 0;
    const f = fixture({
      studioUrl: "not-a-url",
      renew: async () => {
        renewals++;
        return {};
      },
    });
    await assertRejects(() =>
      f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      })
    );
    assertEquals(f.requests.some((request) => request.path === "/runs/run-1/cancel"), true);
    await time.tickAsync(40_000);
    assertEquals(renewals, 0);
    await f.runtime.dispose();
    assertEquals(f.completed, []);
  });
  it("cancels canonical execution on disconnect", async () => {
    const f = fixture();
    const controller = new AbortController();
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "client-thread",
      messages: [],
      signal: controller.signal,
    });
    controller.abort();
    await run.finish("cancelled");
    assertEquals(run.signal.aborted, true);
    assertEquals(f.completed, ["cancelled"]);
  });
  it("rejects incomplete stream instead of recording success", async () => {
    const f = fixture();
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "client-thread",
      messages: [],
      signal: new AbortController().signal,
    });
    await assertRejects(() =>
      new Response(run.wrapStream(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
      )).text()
    );
    assertEquals(f.completed, ["failed"]);
  });
  it("retries registration after an outage without poisoning later admissions", async () => {
    const f = fixture({ registerFailureOnce: true });
    const input = {
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    };
    await assertRejects(() => f.runtime.admit(input), Error, "registration offline");
    const run = await f.runtime.admit(input);
    assertEquals(f.registrations(), 2);
    await run.finish("cancelled");
  });
  for (
    const [status, detail, expected] of [
      [401, "private server detail", "Veryfront login expired"],
      [403, "private server detail", "You do not have access"],
      [
        409,
        "selected environment has no deployed release",
        "The selected environment has no deployed release",
      ],
      [409, "account ownership missing", "Project billing is not ready"],
      [503, "private server detail", "HTTP 503"],
    ] as const
  ) {
    it(`reports actionable admission failure for HTTP ${status}: ${expected}`, async () => {
      const f = fixture({ apiFailure: { path: "/runs", status, detail } });
      await assertRejects(
        () =>
          f.runtime.admit({
            agentId: "assistant",
            threadId: "thread",
            messages: [],
            signal: new AbortController().signal,
          }),
        Error,
        expected,
      );
      assertEquals(f.logs.some((line) => line.includes("private server detail")), false);
      assertEquals(f.completed, []);
      await f.runtime.dispose();
    });
  }
  it("handles non-JSON API failures without exposing the server response", async () => {
    const f = fixture({ apiFailure: { path: "/conversations", status: 502, invalidJson: true } });
    await assertRejects(
      () =>
        f.runtime.admit({
          agentId: "assistant",
          threadId: "thread",
          messages: [],
          signal: new AbortController().signal,
        }),
      Error,
      "HTTP 502",
    );
    assertEquals(f.logs.some((line) => line.includes("not-json")), false);
  });
  it("reuses a conversation and sends only the latest user message as run input", async () => {
    const f = fixture();
    const input = {
      agentId: "assistant",
      threadId: "thread",
      messages: [
        { role: "user", parts: [{ type: "text", text: "old" }] },
        { role: "assistant", parts: [{ type: "text", text: "previous answer" }] },
        {
          role: "user",
          parts: [{ type: "text", text: "first" }, { type: "image", image: "asset" }, {
            type: "text",
            text: "second",
          }],
        },
      ],
      signal: new AbortController().signal,
    };
    const first = await f.runtime.admit(input);
    await first.finish("completed");
    const second = await f.runtime.admit(input);
    await second.finish("completed");
    assertEquals(first.conversationId, second.conversationId);
    assertEquals(f.requests.filter((r) => r.path === "/conversations").length, 1);
    assertEquals(f.requests.filter((r) => r.path.endsWith("/messages")).map((r) => r.body.parts), [
      input.messages[2].parts,
      input.messages[2].parts,
    ]);
    assertEquals(f.requests.filter((r) => r.path === "/runs").map((r) => r.body.input), [
      "first\nsecond",
      "first\nsecond",
    ]);
  });
  it("rejects a foreign conversation claim and reports failed cancellation cleanup", async () => {
    const f = fixture({
      claimConversationMismatch: true,
      apiFailure: { path: "/runs/run-1/cancel", status: 503 },
    });
    await assertRejects(
      () =>
        f.runtime.admit({
          agentId: "assistant",
          threadId: "thread",
          messages: [],
          signal: new AbortController().signal,
        }),
      Error,
      "did not return the admitted local run",
    );
    assertEquals(f.logs.some((line) => line.includes("Could not cancel local run run-1")), true);
  });
  it("fails persistence before forwarding output and releases active execution", async () => {
    const f = fixture({ appendFailure: true });
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode('data: {"type":"text-delta","delta":"unpersisted"}\n\n'),
        );
        c.close();
      },
    });
    await assertRejects(
      () => new Response(run.wrapStream(body)).text(),
      Error,
      "event append failed",
    );
    assertEquals(f.completed, ["failed"]);
    assertEquals(f.logs.some((line) => line.includes("run persistence failed")), true);
    await f.runtime.dispose();
    assertEquals(f.completed, ["failed"]);
  });
  it("keeps failed finalization observable and does not finalize twice on disposal", async () => {
    const f = fixture({ completeFailure: true });
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    await assertRejects(() => run.finish("completed"), Error, "finalization offline");
    await f.runtime.dispose();
    assertEquals(f.completed, ["completed"]);
    assertEquals(f.logs.some((line) => line.includes("run persistence failed")), true);
  });
  it("records explicit model errors as failed execution", async () => {
    const f = fixture();
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    await assertRejects(
      () =>
        new Response(run.wrapStream(
          new ReadableStream({
            start(c) {
              c.enqueue(
                new TextEncoder().encode(
                  'data: {"type":"error","errorText":"provider failed"}\n\n',
                ),
              );
              c.close();
            },
          }),
        )).text(),
      Error,
      "Local model execution failed",
    );
    assertEquals(f.completed, ["failed"]);
  });

  it("cancels upstream and finalizes once when the browser stops reading", async () => {
    const f = fixture();
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"text-delta","delta":"partial"}\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const reader = run.wrapStream(body).getReader();
    await reader.read();
    await reader.cancel();
    assertEquals(cancelled, true);
    assertEquals(run.signal.aborted, true);
    assertEquals(f.completed, ["cancelled"]);
    await f.runtime.dispose();
    assertEquals(f.completed, ["cancelled"]);
  });
  it("accepts completed tool output without requiring a text response", async () => {
    const f = fixture();
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (
          const event of [
            { type: "step-start" },
            { type: "tool-output-available", toolCallId: "call", output: { answer: 42 } },
            { type: "step-end" },
            { type: "message-finish" },
          ]
        ) {
          c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        c.close();
      },
    });
    assertEquals((await new Response(run.wrapStream(body)).text()).includes('"answer":42'), true);
    assertEquals(f.completed, ["completed"]);
    assertEquals(JSON.stringify(f.batches).includes("TOOL_CALL_RESULT"), true);
  });
});

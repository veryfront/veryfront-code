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
    appendGate?: Promise<void>;
    appendFailure?: boolean;
    renewOutcome?: "missing" | "error";
  } = {},
) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
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
      return Promise.resolve({ id: "worker" });
    },
    heartbeatWorker: () => Promise.resolve({}),
    claimRun: () =>
      Promise.resolve(
        options.claimNull ? null : {
          run_id: `run-${id}`,
          conversation_id: `conversation-${id}`,
          message_id: "message",
          latest_external_event_sequence: 0,
        },
      ),
    renewLease: () =>
      options.renewOutcome === "error"
        ? Promise.reject(new Error("API offline"))
        : Promise.resolve(options.renewOutcome === "missing" ? null : {}),
    appendRunEvents: (input: { events: unknown[] }) => {
      batches.push(input.events);
      return Promise.resolve();
    },
    completeRun: (input: { status: string }) => {
      completed.push(input.status);
      return Promise.resolve();
    },
  } as unknown as ExternalAgentWorkerClient;
  const runtime = createConnectedLocalRuntime({
    apiBaseUrl: "http://localhost:4400",
    apiToken: "private",
    projectId: "project",
    projectSlug: "sample",
    environmentId: "env",
    studioUrl: "http://localhost:3440",
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
      requests.push({ path, body });
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
      threadId: "client-thread",
      messages: [],
      signal: new AbortController().signal,
    });
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
});

import "#veryfront/schemas/_test-setup.ts";
import { getActiveRunEventSink } from "#veryfront/runtime/run-event-sink-context.ts";
import { FakeTime } from "#std/testing/time";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { createConnectedLocalRuntime } from "./connected-local-runtime.ts";
import type { ExternalAgentWorkerClient } from "../service/external-worker-client.ts";
import { createEphemeralAgent } from "../factory.ts";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { tool } from "#veryfront/tool/index.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { useServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";

function fixture(
  options: {
    lostResponseOnce?: string;
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
    complete?: (input: { runId: string; status: string }) => Promise<void>;
    claimConversationMismatch?: boolean;
    workerDisplayName?: string;
  } = {},
) {
  const requests: Array<{ path: string; body: Record<string, unknown>; headers: Headers }> = [];
  const createdMessages: unknown[] = [];
  const createdRuns: unknown[] = [];
  const admittedWrites = new Set<string>();
  let responseLost = false;
  const completed: string[] = [];
  const logs: string[] = [];
  let markAppendStarted!: () => void;
  const appendStarted = new Promise<void>((resolve) => markAppendStarted = resolve);
  const batches: unknown[][] = [];
  let id = 0;
  let registrations = 0;
  const registeredWorkers: Record<string, unknown>[] = [];
  const sequences: number[] = [];
  const client = {
    registerWorker: (input: Record<string, unknown>) => {
      registeredWorkers.push(input);
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
    completeRun: (input: { runId: string; status: string }) => {
      completed.push(input.status);
      if (options.complete) return options.complete(input);
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
    workerDisplayName: options.workerDisplayName,
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
      if (path.endsWith("/messages") || path === "/runs") {
        const key = path === "/runs"
          ? new Headers(init?.headers).get("Idempotency-Key")
          : body.idempotency_key;
        if (!key || !admittedWrites.has(`${path}:${key}`)) {
          (path === "/runs" ? createdRuns : createdMessages).push(body);
          if (key) admittedWrites.add(`${path}:${key}`);
        }
        if (path === options.lostResponseOnce && !responseLost) {
          responseLost = true;
          return Promise.reject(new Error("accepted response lost"));
        }
      }
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
    createdMessages,
    createdRuns,
    batches,
    sequences,
    logs,
    registrations: () => registrations,
    registeredWorkers,
    appendStarted,
  };
}

describe("connected local execution", () => {
  it("registers the configured worker name without changing its implementation or unique key", async () => {
    const f = fixture({ workerDisplayName: "Kentaro laptop" });
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    assertEquals(f.registeredWorkers[0]!.displayName, "Kentaro laptop");
    assertEquals(f.registeredWorkers[0]!.implementationKind, "veryfront-local");
    assertEquals(typeof f.registeredWorkers[0]!.workerKey, "string");
    await run.finish("completed");
  });
  it("logs the actual model when a model call is recorded", async () => {
    const f = fixture();
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    await run.execute(async () => {
      const sink = getActiveRunEventSink()!;
      for (
        const id of ["provider/selected-model", "provider/selected-model", "provider/fallback"]
      ) {
        await sink({ type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED", model: { id }, messages: [] });
      }
    });
    await run.finish("completed");
    assertEquals(
      f.logs.filter((line) => line.includes("model provider/")).map((line) => line.slice(10)),
      ["assistant model provider/selected-model run-1", "assistant model provider/fallback run-1"],
    );
  });
  for (
    const visible of [
      { type: "reasoning-delta", delta: "Thinking" },
      { type: "source-url", sourceId: "source", url: "https://example.com" },
      { type: "source-document", sourceId: "source", mediaType: "text/plain", title: "Source" },
      { type: "file", mediaType: "image/png", url: "https://example.com/image.png" },
      { type: "data-result", data: { answer: 42 } },
    ]
  ) {
    it(`completes a ${visible.type}-only response`, async () => {
      const f = fixture();
      const run = await f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const event of [visible, { type: "message-finish" }]) {
            c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          }
          c.close();
        },
      });
      await new Response(run.wrapStream(body)).text();
      assertEquals(f.completed, ["completed"]);
    });
  }
  for (const object of [{ normalized: 42 }, null, false, 0]) {
    it(`preserves parsed terminal structured output ${JSON.stringify(object)}`, async () => {
      let completedOutput: unknown = "not completed";
      const f = fixture({
        complete: (input) => {
          completedOutput = (input as { output?: unknown }).output;
          return Promise.resolve();
        },
      });
      const run = await f.runtime.admit({
        agentId: "assistant",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      });
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (
            const event of [{ type: "text-delta", delta: '{"raw":42}' }, {
              type: "message-finish",
              object,
            }]
          ) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
          c.close();
        },
      });
      await new Response(run.wrapStream(body)).text();
      assertEquals(completedOutput, object);
    });
  }
  it("completes object-only output without text", async () => {
    const f = fixture();
    const run = await f.runtime.admit({
      agentId: "assistant",
      threadId: "thread",
      messages: [],
      signal: new AbortController().signal,
    });
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(
          new TextEncoder().encode('data: {"type":"message-finish","object":{"answer":42}}\n\n'),
        );
        c.close();
      },
    });
    await new Response(run.wrapStream(body)).text();
    assertEquals(f.completed, ["completed"]);
  });

  it("prepares a tools-true agent with its bounded single-agent catalog", async () => {
    using _catalog = useServedCatalogForTests();
    const workerId = "11111111-1111-4111-8111-111111111111";
    const projectId = "22222222-2222-4222-8222-222222222222";
    const conversationId = "33333333-3333-4333-8333-333333333333";
    const messageId = "44444444-4444-4444-8444-444444444444";
    const canonicalRunId = "55555555-5555-4555-8555-555555555555";
    const runId = "run-connected-tools";
    const terminalToken = `header.${
      btoa(JSON.stringify({
        runId,
        canonicalRunId,
        tokenUse: "run_event_writer",
        writerPurpose: "current_run_terminal",
        dispatchNonce: "generation",
      }))
    }.signature`;
    const worker = {
      id: workerId,
      project_id: projectId,
      implementation_kind: "veryfront-local",
      worker_key: "local-test",
      status: "online",
    };
    const fetch = ((input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/workers")) {
        return Promise.resolve(Response.json({ worker, token: "worker-token" }));
      }
      if (path.endsWith("/heartbeat")) {
        return Promise.resolve(Response.json({ worker }));
      }
      if (path === "/conversations") {
        return Promise.resolve(Response.json({ id: conversationId }));
      }
      if (path === "/runs") {
        return Promise.resolve(Response.json({ id: canonicalRunId }));
      }
      if (path.endsWith("/claim")) {
        return Promise.resolve(Response.json({
          run: {
            run_id: runId,
            conversation_id: conversationId,
            message_id: messageId,
            project_id: projectId,
            agent_id: "coder",
            status: "running",
            request_snapshot: null,
            latest_event_id: 0,
            latest_external_event_sequence: 0,
            lease_owner: workerId,
            lease_expires_at: null,
            worker_session: null,
          },
          credentials: {
            auth_token: "run-auth-token",
            run_event_token: "run-event-token",
            run_terminal_token: terminalToken,
            inference_token: "run-inference-token",
          },
        }));
      }
      if (path.endsWith("/finalize")) {
        return Promise.resolve(Response.json({ id: canonicalRunId, status: "cancelled" }));
      }
      throw new Error(`Unexpected connected runtime request: ${path}`);
    }) as typeof globalThis.fetch;
    const makeTool = (id: string, ownerAgentId?: string) => ({
      ...tool({
        id,
        description: id,
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      }),
      ...(ownerAgentId ? { ownerAgentId } : {}),
    });
    const registered = [
      "connected-global-tool",
      "coder--connected-owner-tool",
      "writer--connected-foreign-tool",
    ];
    toolRegistryInternal.register(registered[0]!, makeTool(registered[0]!));
    toolRegistryInternal.register(registered[1]!, makeTool(registered[1]!, "coder"));
    toolRegistryInternal.register(registered[2]!, makeTool(registered[2]!, "writer"));
    const runtime = createConnectedLocalRuntime({
      apiBaseUrl: "http://localhost:4400",
      apiToken: "private",
      projectId,
      projectSlug: "sample",
      studioUrl: "http://localhost:3440",
    }, { fetch, log: () => {} });

    try {
      const run = await runtime.admit({
        agentId: "coder",
        threadId: "thread",
        messages: [],
        signal: new AbortController().signal,
      });
      const source = createEphemeralAgent({
        id: "coder",
        system: "Use the project tools.",
        tools: true,
        skills: false,
      });
      assertEquals(source.config.tools, true);

      const prepared = await run.prepareAgent(source);
      const preparedTools = prepared.config.tools;
      if (!preparedTools || preparedTools === true) {
        throw new Error("Expected an explicit connected tool catalog");
      }
      assertEquals(preparedTools[registered[0]!], true);
      assertEquals(preparedTools[registered[1]!], true);
      assertEquals(preparedTools[registered[2]!], undefined);
      assertEquals(prepared.config.delegates, undefined);
    } finally {
      await runtime.dispose().catch(() => {});
      for (const id of registered) toolRegistryInternal.delete(id);
    }
  });

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
  for (const path of ["/runs", "/conversations/conversation-1/messages"]) {
    it(`retries an ambiguously accepted ${path} without duplicating the message or run`, async () => {
      const f = fixture({ lostResponseOnce: path });
      const input = {
        agentId: "assistant",
        threadId: "thread",
        messages: [{ role: "user", parts: [{ type: "text", text: "Hello" }] }],
        signal: new AbortController().signal,
      };
      await assertRejects(() => f.runtime.admit(input), Error, "accepted response lost");
      const run = await f.runtime.admit({
        ...input,
        messages: structuredClone(input.messages),
        signal: new AbortController().signal,
      });
      try {
        assertEquals(f.createdMessages.length, 1);
        assertEquals(f.createdRuns.length, 1);
        assertEquals(
          f.requests.filter((request) => request.path === "/runs").every((request) =>
            typeof request.headers.get("Idempotency-Key") === "string"
          ),
          true,
        );
      } finally {
        await run.finish("completed");
      }
    });
  }

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
    assertEquals(f.createdMessages.length, 2);
    assertEquals(f.createdRuns.length, 2);
    assertEquals(
      new Set(
        f.requests.filter((request) => request.path === "/runs").map((request) =>
          request.headers.get("Idempotency-Key")
        ),
      ).size,
      2,
    );
    assertEquals(f.requests.filter((r) => r.path === "/conversations").length, 1);
    const latestMessage = input.messages.at(-1);
    if (!latestMessage) throw new Error("Expected the latest user message fixture");
    assertEquals(f.requests.filter((r) => r.path.endsWith("/messages")).map((r) => r.body.parts), [
      latestMessage.parts,
      latestMessage.parts,
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
  it("waits for every active finalization before reporting a disposal failure", async () => {
    let releaseDelayed!: () => void;
    const delayed = new Promise<void>((resolve) => releaseDelayed = resolve);
    let delayedFinished = false;
    const f = fixture({
      complete: ({ runId }) =>
        runId === "run-1"
          ? Promise.reject(new Error("first finalization failed"))
          : delayed.then(() => {
            delayedFinished = true;
          }),
    });
    await Promise.all(
      ["first", "second"].map((threadId) =>
        f.runtime.admit({
          agentId: "assistant",
          threadId,
          messages: [],
          signal: new AbortController().signal,
        })
      ),
    );

    let disposalSettled = false;
    const disposal = f.runtime.dispose().finally(() => disposalSettled = true);
    void disposal.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(disposalSettled, false);
    assertEquals(delayedFinished, false);

    releaseDelayed();
    await assertRejects(() => disposal, Error, "first finalization failed");
    assertEquals(delayedFinished, true);
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

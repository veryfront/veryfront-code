import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createCanonicalVeryfrontApiTransport,
  createVeryfrontApiTransport,
} from "#veryfront/platform/adapters/veryfront-api-transport.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { createRunsSdk, runsProblemOf } from "#veryfront/runs/target/client.ts";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "npm:@opentelemetry/sdk-trace-base@2.9.0";
import {
  _resetShimForTests,
  type Context,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";

describe("Runs SDK canonical transport", () => {
  it("uses the canonical transport and bounds oversized error bodies", async () => {
    let cancelled = false;
    let chunks = 0;
    await withMockFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              chunks++;
              controller.enqueue(new TextEncoder().encode("x".repeat(4096)));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status: 400 },
        ),
      ), async () => {
      const transport = createCanonicalVeryfrontApiTransport(
        "https://api.example.test",
        () => "test-token",
        { maxRetries: 0, initialDelay: 1, maxDelay: 1 },
      );
      const sdk = createRunsSdk({ transport });
      await assertRejects(() => sdk.getRun({ path: { run_id: "run-1" } }));
    });
    assertEquals(cancelled, true);
    assertEquals(chunks <= 4, true);
  });

  it("bounds successful JSON and rejects invalid UTF-8", async () => {
    const responses = [Response.json({ value: "too large" }), new Response(new Uint8Array([0xff]))];
    await withMockFetch(() => Promise.resolve(responses.shift()!), async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-token",
          { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        ),
      });
      const oversized = await assertRejects(() =>
        sdk.getRun(
          { path: { run_id: "run-1" } },
          { maxResponseBytes: 4 },
        ), VeryfrontError);
      assertInstanceOf(oversized, VeryfrontError);
      assertEquals(oversized.status, 502);
      const invalid = await assertRejects(
        () => sdk.getRun({ path: { run_id: "run-1" } }),
        VeryfrontError,
      );
      assertInstanceOf(invalid, VeryfrontError);
      assertEquals(invalid.status, 502);
    });
  });

  it("retries through the canonical stack, runs policy and response hooks, and preserves the final Problem", async () => {
    let attempts = 0;
    let spans = 0;
    const authorized: string[] = [];
    const statuses: number[] = [];
    const problem = { type: "about:blank", title: "Unavailable", status: 503, code: "UNAVAILABLE" };
    await withMockFetch((_url, init) => {
      attempts++;
      assertEquals(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
      assertEquals(init?.redirect, "manual");
      return Promise.resolve(Response.json(problem, { status: 503 }));
    }, async () => {
      const sdk = createRunsSdk({
        transport: createVeryfrontApiTransport({
          baseUrl: "https://api.example.test",
          getToken: () => "test-token",
          retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
          outboundPolicy: {
            authorizeUrl(url) {
              authorized.push(url.href);
            },
          },
          afterFetch(status) {
            statuses.push(status);
          },
          wrapFetch: async (callback) => {
            spans++;
            return await callback();
          },
        }),
      });
      const error = await assertRejects(
        () => sdk.getRun({ path: { run_id: "run-1" } }),
        VeryfrontError,
      );
      assertEquals(runsProblemOf(error), problem);
    });
    assertEquals(attempts, 2);
    assertEquals(spans, 2);
    assertEquals(statuses, [503, 503]);
    assertEquals(authorized, Array(2).fill("https://api.example.test/runs/run-1"));
  });

  it("does not reuse a previous Problem when the final retry fails at the network boundary", async () => {
    let attempts = 0;
    await withMockFetch(() => {
      if (++attempts === 1) {
        return Promise.resolve(Response.json({
          type: "about:blank",
          title: "Unavailable",
          status: 503,
          code: "UNAVAILABLE",
        }, { status: 503 }));
      }
      return Promise.reject(new TypeError("network unavailable"));
    }, async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-token",
          { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        ),
      });
      const error = await assertRejects(
        () => sdk.getRun({ path: { run_id: "run-1" } }),
        VeryfrontError,
      );
      assertEquals(runsProblemOf(error), undefined);
    });
    assertEquals(attempts, 2);
  });

  it("enforces the attempt deadline while reading a success body", async () => {
    let cancelled = false;
    await withMockFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
        ),
      ), async () => {
      const sdk = createRunsSdk({
        transport: createVeryfrontApiTransport({
          baseUrl: "https://api.example.test",
          getToken: () => "test-token",
          timeoutMs: 10,
          retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        }),
      });
      await assertRejects(() => sdk.getRun({ path: { run_id: "run-1" } }));
    });
    assertEquals(cancelled, true);
  });

  it("applies host origin authorization before making the request", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(Response.json({}));
    }, async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-token",
          { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
          {
            authorizeUrl() {
              throw new Error("host policy rejects this origin");
            },
          },
        ),
      });
      await assertRejects(() => sdk.getRun({ path: { run_id: "run-1" } }));
    });
    assertEquals(calls, 0);
  });

  it("does not retry a successful mutation when the caller's header callback throws", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(Response.json({ id: "run-1" }, { status: 201 }));
    }, async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-token",
          { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        ),
      });
      await assertRejects(() =>
        sdk.createRun({
          headers: { "Idempotency-Key": "test-key" },
          body: { project_id: "project-1", target: { type: "task", id: "test-task" } },
        }, {
          onHeaders() {
            throw new Error("caller failed");
          },
        })
      );
    });
    assertEquals(calls, 1);
  });

  it("honors the host's final-error hook after exhausting response retries", async () => {
    let hooks = 0;
    await withMockFetch(() =>
      Promise.resolve(Response.json({
        type: "about:blank",
        title: "Unavailable",
        status: 503,
        code: "UNAVAILABLE",
      }, { status: 503 })), async () => {
      const sdk = createRunsSdk({
        transport: createVeryfrontApiTransport({
          baseUrl: "https://api.example.test",
          getToken: () => "test-token",
          retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
          wrapFinalError(error) {
            hooks++;
            return error;
          },
        }),
      });
      await assertRejects(() => sdk.getRun({ path: { run_id: "run-1" } }));
    });
    assertEquals(hooks, 1);
  });

  it("records the canonical telemetry span for an SDK request", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const rootContext: Context = {
      getValue: () => undefined,
      setValue() {
        return this;
      },
      deleteValue() {
        return this;
      },
    };
    setGlobalContextAccessor({
      active: () => rootContext,
      with: (_context, callback) => callback(),
    });
    setGlobalTracerProvider({
      getTracer: (name, version) => provider.getTracer(name, version) as unknown as Tracer,
    });
    try {
      await withMockFetch(
        () => Promise.resolve(Response.json({ data: [], page_info: { next: null } })),
        async () => {
          const sdk = createRunsSdk({
            transport: createCanonicalVeryfrontApiTransport(
              "https://api.example.test",
              () => "test-token",
              { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
            ),
          });
          await sdk.listRuns();
        },
      );
      await provider.forceFlush();
      const spans = exporter.getFinishedSpans();
      assertEquals(spans.length, 1);
      assertEquals(spans[0]?.name, SpanNames.HTTP_CLIENT_FETCH);
      assertEquals(spans[0]?.attributes["http.target"], "/runs");
      assertEquals(spans[0]?.attributes["http.method"], "GET");
    } finally {
      _resetShimForTests();
      await provider.shutdown();
    }
  });

  it("cancels an event stream when the caller aborts after receiving headers", async () => {
    let cancelled = false;
    let source: ReadableStreamDefaultController<Uint8Array>;
    const controller = new AbortController();
    const event = new TextEncoder().encode(
      'id: 1\nevent: RUN_STARTED\ndata: {"event_id":1,"event_type":"RUN_STARTED","payload":{"type":"RUN_STARTED"},"is_error":false,"created_at":null}\n\n',
    );
    await withMockFetch(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              source = stream;
              stream.enqueue(event);
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
      ), async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-token",
          { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        ),
      });
      const frames = sdk.streamRunEvents({ path: { run_id: "run-1" } }, {
        signal: controller.signal,
      })[Symbol.asyncIterator]();
      assertEquals((await frames.next()).value?.id, "1");
      controller.abort();
      const watchdog = setTimeout(() => source.error(new Error("abort was not propagated")), 50);
      try {
        const error = await assertRejects(() => frames.next(), DOMException);
        assertInstanceOf(error, DOMException);
        assertEquals(error.name, "AbortError");
      } finally {
        clearTimeout(watchdog);
      }
    });
    assertEquals(cancelled, true);
  });

  it("aborts the actual in-flight fetch signal when the caller cancels", async () => {
    const started = Promise.withResolvers<void>();
    let requestSignal: AbortSignal | null | undefined;
    const controller = new AbortController();
    await withMockFetch((_url, init) => {
      requestSignal = init?.signal;
      started.resolve();
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), {
          once: true,
        });
      });
    }, async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-token",
          { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        ),
      });
      const result = sdk.getRun({ path: { run_id: "run-1" } }, { signal: controller.signal });
      await started.promise;
      controller.abort();
      await assertRejects(() => result);
      assertEquals(requestSignal?.aborted, true);
    });
  });

  it("inherits the host retry policy for a mutation without an idempotency key", async () => {
    let calls = 0;
    await withMockFetch(() => {
      calls++;
      return Promise.resolve(Response.json({
        type: "about:blank",
        title: "Unavailable",
        status: 503,
        code: "UNAVAILABLE",
      }, { status: 503 }));
    }, async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-token",
          { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
        ),
      });
      await assertRejects(() =>
        sdk.updateRun({
          path: { run_id: "run-1" },
          headers: { "If-Match": '"version-1"' },
          body: { title: "updated" },
        })
      );
    });
    assertEquals(calls, 2);
  });

  it("does not retain a stale Problem when a later tracing wrapper rejects before fetch", async () => {
    let fetches = 0;
    await withMockFetch(() => {
      fetches++;
      return Promise.resolve(Response.json({
        type: "about:blank",
        title: "Unavailable",
        status: 503,
        code: "UNAVAILABLE",
      }, { status: 503 }));
    }, async () => {
      const sdk = createRunsSdk({
        transport: createVeryfrontApiTransport({
          baseUrl: "https://api.example.test",
          getToken: () => "test-token",
          retry: { maxRetries: 1, initialDelay: 0, maxDelay: 0 },
          wrapFetch: (callback, _url, _method, attempt) =>
            attempt === 0 ? callback() : Promise.reject(new Error("circuit breaker is open")),
        }),
      });
      const error = await assertRejects(
        () => sdk.getRun({ path: { run_id: "run-1" } }),
        VeryfrontError,
      );
      assertEquals(runsProblemOf(error), undefined);
    });
    assertEquals(fetches, 1);
  });

  it("supports API-key-only authentication in the host canonical transport", async () => {
    await withMockFetch((_url, init) => {
      const headers = new Headers(init?.headers);
      assertEquals(headers.get("Authorization"), null);
      assertEquals(headers.get("X-API-Key"), "test-api-key");
      assertEquals(init?.redirect, "error");
      return Promise.resolve(Response.json({ id: "run-1" }, { status: 201 }));
    }, async () => {
      const sdk = createRunsSdk({
        transport: createCanonicalVeryfrontApiTransport(
          "https://api.example.test",
          () => "test-api-key",
          { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
          undefined,
          "api-key",
        ),
      });
      const created = await sdk.createRun({
        headers: { "Idempotency-Key": "test-api-key-root-run" },
        body: { project_id: "project-1", target: { type: "task", id: "test-task" } },
      });
      assertEquals(created.id, "run-1");
    });
  });
});

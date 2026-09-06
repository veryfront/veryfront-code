import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderGeneration } from "./render-generation.ts";

const request = () => new Request("http://localhost/page");

describe("RenderGeneration", () => {
  it("keeps completion callback failures separate from rendering and admission", async () => {
    let completions = 0;
    let stops = 0;
    let releases = 0;
    let render = async () => new Response(null, { status: 204 });
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 10_000,
      executor: {
        render: () => render(),
        stop: async () => {
          stops++;
        },
      },
      releaseArtifacts: async () => {
        releases++;
      },
    });
    const complete = () => {
      completions++;
      throw new Error("completion failed");
    };
    try {
      assertEquals((await generation.render(request(), complete)).status, 204);
      render = async () => {
        throw new Error("render failed");
      };
      await assertRejects(() => generation.render(request(), complete), Error, "render failed");
      render = async () => new Response("page");
      assertEquals(await (await generation.render(request(), complete)).text(), "page");
      render = async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error("stream failed"));
            },
          }),
        );
      const failed = await generation.render(request(), complete);
      await assertRejects(() => failed.text(), Error, "stream failed");
      render = async () => new Response(new ReadableStream());
      const cancelled = await generation.render(request(), complete);
      const closing = generation.close();
      await cancelled.body!.cancel();
      await closing;
      assertEquals([completions, stops, releases], [5, 1, 1]);
    } finally {
      await generation.close();
    }
  });

  it("rejects invalid limits before inspecting an executor", () => {
    assertThrows(() =>
      new RenderGeneration({
        maxConcurrentRenders: 0,
        drainTimeoutMs: 0,
        get executor(): never {
          throw new Error("Executor must not be inspected");
        },
        releaseArtifacts: async () => {},
      }), RangeError);
  });

  it("uses the same capacity value that passed construction validation", async () => {
    let reads = 0;
    const generation = new RenderGeneration({
      get maxConcurrentRenders() {
        return ++reads === 1 ? 1 : 0;
      },
      drainTimeoutMs: 0,
      executor: { render: async () => new Response("page"), stop: async () => {} },
      releaseArtifacts: async () => {},
    });
    assertEquals(await (await generation.render(request())).text(), "page");
    assertEquals(reads, 1);
    await generation.close();
  });

  it("captures one executor object for both rendering and shutdown", async () => {
    let reads = 0;
    let stops = 0;
    const executor = {
      render: async () => new Response("page"),
      stop: async () => {
        stops++;
      },
    };
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      get executor() {
        if (++reads > 1) throw new Error("Executor must be captured once");
        return executor;
      },
      releaseArtifacts: async () => {},
    });
    assertEquals(await (await generation.render(request())).text(), "page");
    await generation.close();
    assertEquals([reads, stops], [1, 1]);
  });

  it("drains response bodies before stopping execution and releasing artifacts", async () => {
    const pending = Promise.withResolvers<Response>();
    const stopped = Promise.withResolvers<void>();
    const calls: string[] = [];
    const generation = new RenderGeneration({
      maxConcurrentRenders: 2,
      drainTimeoutMs: 10_000,
      executor: {
        render: () => pending.promise,
        stop: () => {
          calls.push("stop");
          return stopped.promise;
        },
      },
      releaseArtifacts: async () => {
        calls.push("release");
      },
    });
    const rendering = generation.render(request());
    const closing = generation.close();
    assertEquals(generation.close(), closing, "concurrent close calls share completion");
    await assertRejects(() => generation.render(request()), Error, "draining");
    pending.resolve(new Response("page", { status: 202, headers: { "x-test": "preserved" } }));
    const response = await rendering;
    assertEquals(calls, [], "receiving headers does not finish a streamed render");
    assertEquals(response.status, 202);
    assertEquals(response.headers.get("x-test"), "preserved");
    assertEquals(await response.text(), "page");
    await Promise.resolve();
    assertEquals(calls, ["stop"], "artifacts remain owned until execution stops");
    stopped.resolve();
    await closing;
    await generation.close();
    assertEquals(calls, ["stop", "release"]);
  });

  it("bounds concurrent renders and releases admission on stream cancellation", async () => {
    let cancellations = 0;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancellations++;
              },
            }),
          ),
        stop: async () => {},
      },
      releaseArtifacts: async () => {},
    });
    const first = await generation.render(request());
    await assertRejects(() => generation.render(request()), Error, "capacity");
    await first.body!.cancel();
    const second = await generation.render(request());
    await second.body!.cancel();
    await generation.close();
    assertEquals(cancellations, 2);
  });

  it("preserves backpressure instead of reading an unconsumed response", async () => {
    let pulls = 0;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array([++pulls]));
              },
            }, { highWaterMark: 0 }),
          ),
        stop: async () => {},
      },
      releaseArtifacts: async () => {},
    });
    const response = await generation.render(request());
    assertEquals(pulls, 0);
    const reader = response.body!.getReader();
    assertEquals((await reader.read()).value, new Uint8Array([1]));
    await Promise.resolve();
    assertEquals(pulls, 1, "the owner must not prefetch a second chunk");
    await reader.cancel();
    reader.releaseLock();
    await generation.close();
  });

  it("keeps admission while cancellation races an outstanding read", async () => {
    const reading = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () =>
          new Response(
            new ReadableStream({
              pull() {
                reading.resolve();
              },
              cancel: () => cancelled.promise,
            }, { highWaterMark: 0 }),
          ),
        stop: async () => {},
      },
      releaseArtifacts: async () => {},
    });
    const response = await generation.render(request());
    const reader = response.body!.getReader();
    const read = reader.read();
    await reading.promise;
    const cancelling = reader.cancel();
    await read;
    await assertRejects(() => generation.render(request()), Error, "capacity");
    cancelled.resolve();
    await cancelling;
    reader.releaseLock();
    const next = await generation.render(request());
    await next.body!.cancel();
    await generation.close();
  });

  it("publishes close completion before invoking executor teardown", async () => {
    let observed: Promise<void> | undefined;
    let stops = 0;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () => new Response(null),
        stop: async () => {
          if (++stops === 1) observed = generation.close();
        },
      },
      releaseArtifacts: async () => {},
    });
    const closing = generation.close();
    await closing;
    assertEquals(stops, 1);
    assertEquals(observed, closing);
  });

  it("releases admission after failures before headers and during streaming", async () => {
    let attempt = 0;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () => {
          if (++attempt === 1) throw new Error("before headers");
          if (attempt === 2) {
            return new Response(
              new ReadableStream({
                pull(controller) {
                  controller.error(new Error("stream failed"));
                },
              }),
            );
          }
          return new Response(null, { status: 204 });
        },
        stop: async () => {},
      },
      releaseArtifacts: async () => {},
    });
    await assertRejects(() => generation.render(request()), Error, "before headers");
    const response = await generation.render(request());
    await assertRejects(() => response.text(), Error, "stream failed");
    assertEquals((await generation.render(request())).status, 204);
    await generation.close();
  });

  it("rejects an already aborted request without starting execution", async () => {
    let renders = 0;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () => {
          renders++;
          return new Response(null);
        },
        stop: async () => {},
      },
      releaseArtifacts: async () => {},
    });
    await assertRejects(
      () =>
        generation.render(
          new Request("http://localhost/page", {
            signal: AbortSignal.abort(new Error("request aborted")),
          }),
        ),
      Error,
      "request aborted",
    );
    assertEquals(renders, 0);
    await generation.close();
  });

  it("releases admission when a source errors before its response is consumed", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(value) {
                controller = value;
              },
            }, { highWaterMark: 0 }),
          ),
        stop: async () => {},
      },
      releaseArtifacts: async () => {},
    });
    const response = await generation.render(request());
    controller.error(new Error("source failed"));
    await Promise.resolve();
    const next = await generation.render(request());
    await next.body!.cancel();
    await assertRejects(() => response.text(), Error, "source failed");
    await generation.close();
  });

  it("cancels an unconsumed response when its request aborts", async () => {
    const aborted = new AbortController();
    const cancelled = Promise.withResolvers<void>();
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () =>
          new Response(
            new ReadableStream({
              cancel() {
                cancelled.resolve();
              },
            }),
          ),
        stop: async () => {},
      },
      releaseArtifacts: async () => {},
    });
    const response = await generation.render(
      new Request("http://localhost/page", {
        signal: aborted.signal,
      }),
    );
    aborted.abort();
    await cancelled.promise;
    assertEquals(await response.text(), "");
    const next = await generation.render(request());
    await next.body!.cancel();
    await generation.close();
  });

  it("retains artifacts when stop fails and retries only unfinished cleanup", async () => {
    let stops = 0;
    let releases = 0;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
      executor: {
        render: async () => new Response(null),
        stop: async () => {
          if (++stops === 1) throw new Error("stop failed");
        },
      },
      releaseArtifacts: async () => {
        if (++releases === 1) throw new Error("release failed");
      },
    });
    await assertRejects(() => generation.close(), Error, "stop failed");
    assertEquals(releases, 0);
    await assertRejects(() => generation.render(request()), Error, "draining");
    await assertRejects(() => generation.close(), Error, "release failed");
    assertEquals(stops, 2);
    await generation.close();
    assertEquals(stops, 2, "a successful stop is never repeated");
    assertEquals(releases, 2);
  });

  it("stops an undrained generation at its deadline before releasing artifacts", async () => {
    const pending = Promise.withResolvers<Response>();
    const stopStarted = Promise.withResolvers<void>();
    const stopped = Promise.withResolvers<void>();
    let released = false;
    const generation = new RenderGeneration({
      maxConcurrentRenders: 1,
      drainTimeoutMs: 1,
      executor: {
        render: () => pending.promise,
        stop: () => {
          stopStarted.resolve();
          return stopped.promise;
        },
      },
      releaseArtifacts: async () => {
        released = true;
      },
    });
    const rendering = generation.render(request());
    const rejected = assertRejects(() => rendering, Error, "terminated");
    const closing = generation.close();
    await stopStarted.promise;
    assertEquals(released, false);
    pending.reject(new Error("terminated"));
    stopped.resolve();
    await Promise.all([closing, rejected]);
    assertEquals(released, true);
  });

  it("rejects invalid capacity and deadline settings", () => {
    const options = {
      executor: { render: async () => new Response(null), stop: async () => {} },
      releaseArtifacts: async () => {},
      maxConcurrentRenders: 1,
      drainTimeoutMs: 0,
    };
    for (const value of [0, -1, 1.5, Infinity, NaN]) {
      assertThrows(
        () => new RenderGeneration({ ...options, maxConcurrentRenders: value }),
        RangeError,
      );
    }
    for (const value of [-1, 1.5, Infinity, NaN, 2 ** 31]) {
      assertThrows(() => new RenderGeneration({ ...options, drainTimeoutMs: value }), RangeError);
    }
  });
});

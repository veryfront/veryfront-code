import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RenderGeneration, type RenderGenerationOptions } from "./render-generation.ts";
import { RenderGenerationPool } from "./render-generation-pool.ts";

const request = () => new Request("http://localhost/page");
const identity = (generationId: string, scopeId = "project") => ({ scopeId, generationId });
const makeGeneration = (
  body: string | null = "page",
  options: Partial<RenderGenerationOptions> = {},
) =>
  new RenderGeneration({
    maxConcurrentRenders: 2,
    drainTimeoutMs: 0,
    executor: { render: async () => new Response(body), stop: async () => {} },
    releaseArtifacts: async () => {},
    ...options,
  });

describe("RenderGenerationPool", () => {
  it("retires a queued constructor without starting it and allows later explicit reuse", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    let created = 0;
    const create = () => {
      created++;
      return makeGeneration();
    };
    const pending = pool.render(request(), identity("release"), create);
    const retiring = pool.retire(identity("release"));
    await assertRejects(() => pending, Error, "draining");
    await retiring;
    assertEquals(created, 0);
    assertEquals(await (await pool.render(request(), identity("release"), create)).text(), "page");
    assertEquals(created, 1);
    await pool.close();
  });

  it("releases aggregate admission after a generation rejects its own request limit", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 2, maxConcurrentRenders: 2 });
    const first = await pool.render(
      request(),
      identity("first"),
      () => makeGeneration("first", { maxConcurrentRenders: 1 }),
    );
    await assertRejects(
      () =>
        pool.render(request(), identity("first"), () => {
          throw new Error("must reuse");
        }),
      Error,
      "capacity",
    );
    const second = await pool.render(request(), identity("second"), () => makeGeneration("second"));
    assertEquals(await first.text(), "first");
    assertEquals(await second.text(), "second");
    await pool.close();
  });

  for (const settlement of ["close", "error"] as const) {
    it(`releases aggregate admission when an unconsumed source signals ${settlement}`, async () => {
      const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
      let source!: ReadableStreamDefaultController<Uint8Array>;
      let calls = 0;
      const response = await pool.render(
        request(),
        identity("release"),
        () =>
          makeGeneration(null, {
            executor: {
              render: async () =>
                ++calls === 1
                  ? new Response(
                    new ReadableStream<Uint8Array>({
                      start(controller) {
                        source = controller;
                      },
                    }),
                  )
                  : new Response("next"),
              stop: async () => {},
            },
          }),
      );
      if (settlement === "close") source.close();
      else source.error(new Error("source failed"));
      await Promise.resolve();
      await Promise.resolve();
      try {
        assertEquals(
          await (await pool.render(request(), identity("release"), () => {
            throw new Error("must reuse");
          })).text(),
          "next",
        );
      } finally {
        await response.body!.cancel().catch(() => {});
        await pool.close();
      }
    });
  }

  it("uses the limit values it validated even when input properties change on access", async () => {
    let generationReads = 0;
    let requestReads = 0;
    const pool = new RenderGenerationPool({
      get maxGenerations() {
        return ++generationReads === 1 ? 1 : 0;
      },
      get maxConcurrentRenders() {
        return ++requestReads === 1 ? 1 : 0;
      },
    });
    assertEquals(
      await (await pool.render(request(), identity("release"), () => makeGeneration())).text(),
      "page",
    );
    assertEquals([generationReads, requestReads], [1, 1]);
    await pool.close();
  });

  it("keeps a starting generation reserved until its stop operation confirms quiescence", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 2 });
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    const stopped = Promise.withResolvers<void>();
    const rendering = pool.render(request(), identity("old"), () =>
      makeGeneration(null, {
        executor: {
          render: () => {
            started.resolve();
            return response.promise;
          },
          stop: () => stopped.promise,
        },
      }));
    await started.promise;
    const retiring = pool.retire(identity("old"));
    await assertRejects(
      () => pool.render(request(), identity("new"), () => makeGeneration()),
      Error,
      "generation capacity",
    );
    response.resolve(new Response(null));
    await rendering;
    await assertRejects(
      () => pool.render(request(), identity("new"), () => makeGeneration()),
      Error,
      "generation capacity",
    );
    stopped.resolve();
    await retiring;
    await (await pool.render(request(), identity("new"), () => makeGeneration())).text();
    await pool.close();
  });

  it("closes every owner after one fails and retries only the retained owner", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 2, maxConcurrentRenders: 2 });
    let firstStops = 0;
    let secondReleases = 0;
    await pool.render(request(), identity("first"), () =>
      makeGeneration(null, {
        executor: {
          render: async () => new Response(null),
          stop: async () => {
            if (++firstStops === 1) throw new Error("stop failed");
          },
        },
      }));
    await pool.render(request(), identity("second"), () =>
      makeGeneration(null, {
        releaseArtifacts: async () => {
          secondReleases++;
        },
      }));
    const failure = await assertRejects(() => pool.close(), AggregateError);
    assert(failure instanceof AggregateError);
    assertEquals(failure.errors.length, 1);
    assertEquals(secondReleases, 1, "one failed stop must not prevent other cleanup");
    await pool.close();
    assertEquals([firstStops, secondReleases], [2, 1]);
  });

  it("rejects incomplete identities before reserving capacity", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    await assertRejects(() =>
      pool.render(request(), identity(""), () => {
        throw new Error("must not construct");
      }), TypeError);
    assertThrows(() => pool.retire(identity("release", "")), TypeError);
    await pool.retire(identity("absent"));
    await (await pool.render(request(), identity("release"), () => makeGeneration())).text();
    await pool.close();
  });

  it("reuses one generation for concurrent requests with the same exact identity", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 2 });
    let created = 0;
    let released = 0;
    const create = () => {
      created++;
      return makeGeneration("same", {
        releaseArtifacts: async () => {
          released++;
        },
      });
    };
    const responses = await Promise.all([
      pool.render(request(), identity("release"), create),
      pool.render(request(), identity("release"), create),
    ]);
    assertEquals(await Promise.all(responses.map((response) => response.text())), ["same", "same"]);
    assertEquals(created, 1);
    await pool.close();
    assertEquals(released, 1);
  });

  it("snapshots identity before deferred construction and keeps tuple components distinct", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 2, maxConcurrentRenders: 2 });
    const key = identity("c", "a:b");
    const first = pool.render(request(), key, (selected) => {
      assertEquals(selected, identity("c", "a:b"));
      assertEquals(Object.isFrozen(selected), true);
      return makeGeneration("first");
    });
    key.scopeId = "changed";
    key.generationId = "changed";
    const second = pool.render(request(), identity("b:c", "a"), () => makeGeneration("second"));
    assertEquals(await (await first).text(), "first");
    assertEquals(await (await second).text(), "second");
    await pool.close();
  });

  it("reserves generation capacity before invoking factories", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 2 });
    let rejectedFactoryCalls = 0;
    const first = pool.render(request(), identity("first"), () => makeGeneration());
    await assertRejects(
      () =>
        pool.render(request(), identity("second"), () => {
          rejectedFactoryCalls++;
          return makeGeneration();
        }),
      Error,
      "generation capacity",
    );
    assertEquals(rejectedFactoryCalls, 0);
    await (await first).text();
    await pool.retire(identity("first"));
    assertEquals(
      await (await pool.render(request(), identity("second"), () => makeGeneration("next"))).text(),
      "next",
    );
    await pool.close();
  });

  it("bounds all admitted requests while generation startup is pending", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 2, maxConcurrentRenders: 1 });
    const pending = Promise.withResolvers<Response>();
    const first = pool.render(request(), identity("first"), () =>
      makeGeneration(null, {
        executor: { render: () => pending.promise, stop: async () => {} },
      }));
    await assertRejects(
      () => pool.render(request(), identity("second"), () => makeGeneration()),
      Error,
      "request capacity",
    );
    pending.resolve(new Response("ready"));
    const response = await first;
    await assertRejects(
      () => pool.render(request(), identity("second"), () => makeGeneration()),
      Error,
      "request capacity",
    );
    assertEquals(await response.text(), "ready");
    await (await pool.render(request(), identity("second"), () => makeGeneration())).text();
    await pool.close();
  });

  it("keeps admission until body cancellation settles and preserves backpressure", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    const cancelled = Promise.withResolvers<void>();
    let pulls = 0;
    const response = await pool.render(request(), identity("release"), () =>
      makeGeneration(null, {
        executor: {
          render: async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                pull() {
                  pulls++;
                },
                cancel: () => cancelled.promise,
              }, { highWaterMark: 0 }),
            ),
          stop: async () => {},
        },
      }));
    assertEquals(pulls, 0, "admission wrappers must not read ahead");
    const cancelling = response.body!.cancel();
    await assertRejects(
      () => pool.render(request(), identity("release"), () => makeGeneration()),
      Error,
      "request capacity",
    );
    cancelled.resolve();
    await cancelling;
    await pool.retire(identity("release"));
    await (await pool.render(request(), identity("release"), () => makeGeneration())).text();
    await pool.close();
  });

  it("retains failed shutdowns in capacity and retries without admitting into a draining generation", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    let stopCalls = 0;
    let releases = 0;
    await pool.render(request(), identity("old"), () =>
      makeGeneration(null, {
        executor: {
          render: async () => new Response(null),
          stop: async () => {
            if (++stopCalls === 1) throw new Error("stop failed");
          },
        },
        releaseArtifacts: async () => {
          releases++;
        },
      }));
    await assertRejects(() => pool.retire(identity("old")), Error, "stop failed");
    await assertRejects(
      () => pool.render(request(), identity("old"), () => makeGeneration()),
      Error,
      "draining",
    );
    await assertRejects(
      () => pool.render(request(), identity("new"), () => makeGeneration()),
      Error,
      "generation capacity",
    );
    assertEquals(releases, 0);
    await pool.retire(identity("old"));
    assertEquals([stopCalls, releases], [2, 1]);
    await (await pool.render(request(), identity("new"), () => makeGeneration())).text();
    await pool.close();
  });

  it("keeps artifact cleanup failures owned after executor shutdown", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    let stopCalls = 0;
    let releases = 0;
    await pool.render(request(), identity("release"), () =>
      makeGeneration(null, {
        executor: {
          render: async () => new Response(null),
          stop: async () => {
            stopCalls++;
          },
        },
        releaseArtifacts: async () => {
          if (++releases === 1) throw new Error("cleanup failed");
        },
      }));
    await assertRejects(() => pool.close(), AggregateError, "cleanup failed");
    await assertRejects(
      () => pool.render(request(), identity("other"), () => makeGeneration()),
      Error,
      "closed",
    );
    await pool.close();
    assertEquals([stopCalls, releases], [1, 2]);
  });

  it("does not invoke a queued factory after terminal close", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    let created = 0;
    const pending = pool.render(request(), identity("release"), () => {
      created++;
      return makeGeneration();
    });
    const closing = pool.close();
    assertStrictEquals(pool.close(), closing);
    await assertRejects(() => pending, Error, "closed");
    await closing;
    assertEquals(created, 0);
  });

  it("closes an owner returned by a factory that reenters terminal close", async () => {
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    let released = 0;
    let closing: Promise<void> | undefined;
    const pending = pool.render(request(), identity("release"), () => {
      closing = pool.close();
      return makeGeneration(null, {
        releaseArtifacts: async () => {
          released++;
        },
      });
    });
    await assertRejects(() => pending, Error, "closed");
    await closing;
    assertEquals(released, 1);
  });

  it("releases a failed factory reservation and keeps replicas independent", async () => {
    const first = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    const second = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    await assertRejects(
      () =>
        first.render(request(), identity("release"), () => {
          throw new Error("construction failed");
        }),
      Error,
      "construction failed",
    );
    await (await first.render(request(), identity("release"), () => makeGeneration())).text();
    await (await second.render(request(), identity("release"), () => makeGeneration())).text();
    await first.close();
    assertEquals(
      await (await second.render(request(), identity("release"), () => {
        throw new Error("must reuse");
      })).text(),
      "page",
    );
    await second.close();
  });

  it("rejects aborted requests and invalid limits without constructing an owner", async () => {
    for (const invalid of [0, -1, 1.5, NaN, Infinity]) {
      assertThrows(
        () => new RenderGenerationPool({ maxGenerations: invalid, maxConcurrentRenders: 1 }),
        RangeError,
      );
      assertThrows(
        () => new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: invalid }),
        RangeError,
      );
    }
    const pool = new RenderGenerationPool({ maxGenerations: 1, maxConcurrentRenders: 1 });
    const abort = new AbortController();
    abort.abort(new Error("cancelled"));
    await assertRejects(
      () =>
        pool.render(
          new Request("http://localhost/page", { signal: abort.signal }),
          identity("release"),
          () => {
            throw new Error("must not construct");
          },
        ),
      Error,
      "cancelled",
    );
    await pool.close();
  });
});

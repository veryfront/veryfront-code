import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";

import type { AgentContext, AgentResponse } from "#veryfront/agent/types.ts";
import { MiddlewareChain } from "#veryfront/agent/middleware/chain.ts";

const context = {} as AgentContext;
const response = {} as AgentResponse;
const replayError =
  "You must call agent middleware next() at most once while the middleware is active";

class PromiseSubclass<T> extends Promise<T> {}

describe("agent/middleware/chain", () => {
  it("rejects replay after a continuation completes", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        retainedNext = next;
        return await next();
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    const error = await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "middleware-error");
    assertEquals(finalHandlerCalls, 1);
  });

  it("rejects a retained continuation after middleware short-circuits", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        return Promise.resolve(response);
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("rejects concurrent continuation replay", async () => {
    let releaseFinalHandler: (() => void) | undefined;
    const finalHandlerStarted = Promise.withResolvers<void>();
    const chain = new MiddlewareChain([
      async (_context, next) => {
        const first = next();
        await finalHandlerStarted.promise;
        await assertRejects(() => next(), VeryfrontError, replayError);
        releaseFinalHandler?.();
        return await first;
      },
    ]);

    await chain.execute(context, () => {
      finalHandlerStarted.resolve();
      return new Promise<AgentResponse>((resolve) => {
        releaseFinalHandler = () => resolve(response);
      });
    });
  });

  it("preserves one awaited continuation per middleware", async () => {
    const calls: string[] = [];
    const chain = new MiddlewareChain([
      async (_context, next) => {
        calls.push("outer-before");
        const result = await next();
        calls.push("outer-after");
        return result;
      },
      async (_context, next) => {
        calls.push("inner-before");
        const result = await next();
        calls.push("inner-after");
        return result;
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        calls.push("final");
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(calls, [
      "outer-before",
      "inner-before",
      "final",
      "inner-after",
      "outer-after",
    ]);
  });

  it("rejects deferred continuation cycles", async () => {
    let continuation: Promise<AgentResponse> | undefined;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        continuation = next();
        return await continuation;
      },
    ]);
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("deferred continuation cycle did not settle")),
        20,
      );
    });

    let error: unknown;
    try {
      error = await Promise.race([
        assertRejects(
          () => chain.execute(context, () => continuation!),
          TypeError,
          "Your middleware continuation cannot resolve to itself",
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    assertInstanceOf(error, TypeError);
  });

  it("rejects indirect deferred continuation cycles", async () => {
    let continuation: Promise<AgentResponse> | undefined;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        continuation = next();
        return await continuation;
      },
    ]);
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("indirect deferred continuation cycle did not settle")),
        100,
      );
    });

    let error: unknown;
    try {
      error = await Promise.race([
        assertRejects(
          () =>
            chain.execute(context, async () => {
              await Promise.resolve();
              return continuation!;
            }),
          TypeError,
          "Your middleware continuation cannot resolve to itself",
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
    assertInstanceOf(error, TypeError);
  });

  it("allows multiple observers on a deferred continuation", async () => {
    let deferred: Promise<AgentResponse> | undefined;
    let releaseMiddleware: ((value: AgentResponse) => void) | undefined;
    let releaseFinal: ((value: AgentResponse) => void) | undefined;
    const finalStarted = Promise.withResolvers<void>();
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          deferred = next();
        });
        return new Promise<AgentResponse>((resolve) => {
          releaseMiddleware = resolve;
        });
      },
    ]);

    const execution = chain.execute(context, () => {
      finalStarted.resolve();
      return new Promise<AgentResponse>((resolve) => {
        releaseFinal = resolve;
      });
    });
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("deferred continuation observers did not dispatch")),
        100,
      );
    });

    try {
      await Promise.race([finalStarted.promise, timeout]);
      const firstFullObserver = deferred!.then(() => response, () => response);
      await Promise.resolve();
      const secondFullObserver = deferred!.then(() => response, () => response);
      const allObserver = Promise.all([deferred!, deferred!]);
      const thenResult = deferred!.then(() => response);
      const catchResult = deferred!.catch(() => response);
      const finallyResult = deferred!.finally(() => undefined);
      releaseFinal!(response);
      releaseMiddleware!(response);
      await execution;
      await Promise.all([
        firstFullObserver,
        secondFullObserver,
        allObserver,
        thenResult,
        catchResult,
        finallyResult,
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  });

  it("revokes a retained continuation after a synchronous middleware throw", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const middlewareError = new Error("middleware failed synchronously");
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        throw middlewareError;
      },
    ]);

    await assertRejects(
      () => chain.execute(context, () => Promise.resolve(response)),
      Error,
      "middleware failed synchronously",
    );
    await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
  });

  it("revokes a continuation queued before an already-settled middleware promise", async () => {
    let queuedNext: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          queuedNext = next();
        });
        return Promise.resolve(response);
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    await assertRejects(() => queuedNext!, VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("revokes a continuation queued before an already-rejected middleware promise", async () => {
    let queuedNext: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const middlewareError = new Error("middleware failed");
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          queuedNext = next();
        });
        return Promise.reject(middlewareError);
      },
    ]);

    await assertRejects(
      () =>
        chain.execute(context, () => {
          finalHandlerCalls += 1;
          return Promise.resolve(response);
        }),
      Error,
      "middleware failed",
    );
    await assertRejects(() => queuedNext!, VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("revokes a continuation queued before a fulfilled promise subclass settles", async () => {
    let queuedNext: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          const deferred = next();
          try {
            Object.defineProperty(deferred, "constructor", { value: Promise });
          } catch {
            // Internal continuation species are intentionally immutable.
          }
          queuedNext = deferred;
          void deferred.then(() => response).then(() => response);
          void deferred.catch(() => response);
          void deferred.finally(() => undefined);
        });
        return new PromiseSubclass((resolve) => resolve(response));
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    await assertRejects(() => queuedNext!, VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("allows a species-hook continuation while the middleware result is pending", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    let releaseResult: ((value: AgentResponse) => void) | undefined;
    const finalStarted = Promise.withResolvers<void>();
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        class PendingSpeciesPromise<T> extends Promise<T> {
          static override get [Symbol.species](): PromiseConstructor {
            retainedNext?.();
            return Promise;
          }
        }
        return new PendingSpeciesPromise<AgentResponse>((resolve) => {
          releaseResult = resolve;
        });
      },
    ]);

    const execution = chain.execute(context, () => {
      finalStarted.resolve();
      return Promise.resolve(response);
    });
    let timeoutId: number | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("pending species continuation did not dispatch")),
        100,
      );
    });

    try {
      await Promise.race([finalStarted.promise, timeout]);
      releaseResult!(response);
      assertEquals(await execution, response);
    } finally {
      clearTimeout(timeoutId);
    }
  });

  it("revokes a continuation queued before a rejected promise subclass settles", async () => {
    let queuedNext: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const middlewareError = new Error("middleware failed");
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          const deferred = next();
          try {
            Object.defineProperty(deferred, "constructor", { value: Promise });
          } catch {
            // Internal continuation species are intentionally immutable.
          }
          queuedNext = deferred;
          void deferred.then(() => response).then(() => response);
          void deferred.catch(() => response);
          void deferred.finally(() => undefined);
        });
        return new PromiseSubclass<AgentResponse>((_resolve, reject) => {
          reject(middlewareError);
        });
      },
    ]);

    await assertRejects(
      () =>
        chain.execute(context, () => {
          finalHandlerCalls += 1;
          return Promise.resolve(response);
        }),
      Error,
      "middleware failed",
    );
    await assertRejects(() => queuedNext!, VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("blocks continuation dispatch from promise species hooks", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    let queuedNext: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        queueMicrotask(() => {
          queuedNext = next();
        });
        class SpeciesPromise<T> extends Promise<T> {
          static override get [Symbol.species](): PromiseConstructor {
            retainedNext?.();
            return Promise;
          }
        }
        return new SpeciesPromise((resolve) => resolve(response));
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    await assertRejects(() => queuedNext!, VeryfrontError, replayError);
    assertEquals(finalHandlerCalls, 0);
  });

  it("contains a discarded invalid continuation rejection", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        return Promise.resolve(response);
      },
    ]);

    await chain.execute(context, () => Promise.resolve(response));
    retainedNext!();
    await Promise.resolve();
  });

  it("contains discarded derived invalid continuation rejections", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        return Promise.resolve(response);
      },
    ]);

    await chain.execute(context, () => Promise.resolve(response));
    const invalid = retainedNext!();
    void invalid.then(() => response);
    void invalid.finally(() => undefined);
    await Promise.resolve();
  });

  it("preserves errors introduced by continuation rejection handlers", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        return Promise.resolve(response);
      },
    ]);

    await chain.execute(context, () => Promise.resolve(response));

    const callbackError = new Error("continuation callback failed");
    const callbackResult = retainedNext!().catch(() => {
      throw callbackError;
    });
    assertEquals(await assertRejects(() => callbackResult), callbackError);

    const cleanupError = new Error("continuation cleanup failed");
    const cleanupResult = retainedNext!().finally(() => {
      throw cleanupError;
    });
    assertEquals(await assertRejects(() => cleanupResult), cleanupError);
  });
});

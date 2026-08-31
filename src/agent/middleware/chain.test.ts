import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";

import type { AgentContext, AgentResponse } from "#veryfront/agent/types.ts";
import { MiddlewareChain } from "#veryfront/agent/middleware/chain.ts";

const context = {} as AgentContext;
const response = {} as AgentResponse;
const replayError =
  "You must call agent middleware next() at most once while the middleware is active";

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
    assertEquals((error as VeryfrontError).slug, "middleware-error");
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

  it("rejects a continuation queued before an already-settled middleware promise", async () => {
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

  it("revokes a retained continuation when middleware throws", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        throw new Error("middleware failed");
      },
    ]);

    await assertRejects(
      () => chain.execute(context, () => Promise.resolve(response)),
      Error,
      "middleware failed",
    );
    await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
  });

  it("does not leak an ignored invalid continuation rejection", async () => {
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

  it("dispatches a continuation deferred after middleware returns", async () => {
    let deferredContinuation: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      (_context, next) =>
        Promise.resolve().then(() => {
          deferredContinuation = next();
          return deferredContinuation;
        }),
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(finalHandlerCalls, 1);
    assertEquals(deferredContinuation instanceof Promise, true);
  });

  it("eagerly dispatches a continuation called before middleware settles", async () => {
    let queuedNext: Promise<AgentResponse> | undefined;
    let resolveMiddleware: ((value: AgentResponse) => void) | undefined;
    let finalHandlerCalls = 0;
    const middlewareResult = new Promise<AgentResponse>((resolve) => {
      resolveMiddleware = resolve;
    });
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          queuedNext = next();
          resolveMiddleware!(response);
        });
        return middlewareResult;
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(finalHandlerCalls, 1);
    assertEquals(await queuedNext, response);
  });

  it("dispatches next immediately after an async middleware await", async () => {
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        return next();
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(finalHandlerCalls, 1);
  });

  it("eagerly dispatches an unawaited continuation after an async suspension", async () => {
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        next();
        return response;
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(finalHandlerCalls, 1);
  });

  it("rejects a queued continuation before an async middleware settles", async () => {
    let queuedNext: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        queueMicrotask(() => {
          queuedNext = next();
        });
        return response;
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

  it("propagates downstream rejection through an awaited continuation", async () => {
    let observedError: unknown;
    const downstreamError = new Error("downstream failed");
    const chain = new MiddlewareChain([
      async (_context, next) => {
        try {
          return await next();
        } catch (error) {
          observedError = error;
          throw error;
        }
      },
    ]);

    const error = await assertRejects(
      () => chain.execute(context, () => Promise.reject(downstreamError)),
      Error,
      "downstream failed",
    );
    assertEquals(error, downstreamError);
    assertEquals(observedError, downstreamError);
  });

  it("propagates a deferred downstream rejection without replacing its identity", async () => {
    const downstreamError = new Error("deferred downstream failed");
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        return await next();
      },
    ]);

    try {
      const error = await assertRejects(
        () => chain.execute(context, () => Promise.reject(downstreamError)),
        Error,
        "deferred downstream failed",
      );
      assertEquals(error, downstreamError);
    } finally {
      unsubscribe();
    }
    assertEquals(
      records.some((entry) => entry.message === "Your agent middleware continuation failed"),
      false,
    );
  });

  it("reports a detached deferred downstream rejection", async () => {
    const downstreamError = new Error(
      "ENOENT: <REDACTED>/private/customer-data.txt <REDACTED>\\secrets.txt",
    );
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        async (_context, next) => {
          await Promise.resolve();
          next();
          return response;
        },
      ]);

      await chain.execute(context, () => Promise.reject(downstreamError));
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      unsubscribe();
    }

    const record = records.find((entry) =>
      entry.message === "Your agent middleware continuation failed"
    );
    assertEquals(record?.context?.error, "downstream continuation rejected");
    assertEquals(record?.error, undefined);
    assertEquals(String(record?.context?.error).includes("customer-data"), false);
    assertEquals(String(record?.context?.error).includes("secrets"), false);
  });

  it("reports a detached synchronous downstream rejection", async () => {
    const downstreamError = new Error("detached synchronous downstream failed");
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        async (_context, next) => {
          next();
          return response;
        },
      ]);

      await chain.execute(context, () => Promise.reject(downstreamError));
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      unsubscribe();
    }

    const record = records.find((entry) =>
      entry.message === "Your agent middleware continuation failed"
    );
    assertEquals(record?.context?.error, "downstream continuation rejected");
    assertEquals(record?.error, undefined);
  });

  it("does not report a deferred rejection recovered by middleware", async () => {
    const downstreamError = new Error("recovered downstream failed");
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        async (_context, next) => {
          try {
            return await next();
          } catch {
            return response;
          }
        },
      ]);

      assertEquals(
        await chain.execute(context, () => Promise.reject(downstreamError)),
        response,
      );
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.some((entry) => entry.message === "Your agent middleware continuation failed"),
      false,
    );
  });

  it("propagates a synchronous throw from deferred downstream dispatch", async () => {
    let deferredContinuation: Promise<AgentResponse> | undefined;
    const downstreamError = new Error("synchronous downstream failure");
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        deferredContinuation = next();
        return response;
      },
    ]);

    await chain.execute(context, () => {
      throw downstreamError;
    });
    const error = await assertRejects(
      () => deferredContinuation!,
      Error,
      "synchronous downstream failure",
    );
    assertEquals(error, downstreamError);
  });

  it("contains cross-realm aborts and hostile error accessors", async () => {
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const crossRealmAbort = new Error("cross-realm cancellation");
      Object.setPrototypeOf(crossRealmAbort, { name: "AbortError" });
      const abortChain = new MiddlewareChain([
        async (_context, next) => {
          next();
          return response;
        },
      ]);
      await abortChain.execute(context, () => Promise.reject(crossRealmAbort));

      const hostileError = new Error("hostile cancellation");
      Object.defineProperty(hostileError, "name", {
        configurable: true,
        get() {
          throw new Error("name getter failed");
        },
      });
      const hostileChain = new MiddlewareChain([
        async (_context, next) => {
          next();
          return response;
        },
      ]);
      await hostileChain.execute(context, () => Promise.reject(hostileError));
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      1,
    );
  });

  it("supports standard Promise composition on continuations", async () => {
    assertEquals(
      await new MiddlewareChain([
        (_context, next) => next().then((value) => value),
      ]).execute(context, () => Promise.resolve(response)),
      response,
    );

    const recoveredError = new Error("recoverable downstream failed");
    assertEquals(
      await new MiddlewareChain([
        (_context, next) =>
          next().catch((error) => {
            assertEquals(error, recoveredError);
            return response;
          }),
      ]).execute(context, () => Promise.reject(recoveredError)),
      response,
    );

    let finallyCalls = 0;
    assertEquals(
      await new MiddlewareChain([
        (_context, next) =>
          next().finally(() => {
            finallyCalls += 1;
          }),
      ]).execute(context, () => Promise.resolve(response)),
      response,
    );
    assertEquals(finallyCalls, 1);
  });

  it("reports discarded derived continuation rejections", async () => {
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const thenChain = new MiddlewareChain([
        (_context, next) => {
          next().then(() => response);
          return Promise.resolve(response);
        },
      ]);
      await thenChain.execute(context, () => Promise.reject(new Error("then failed")));

      const finallyChain = new MiddlewareChain([
        (_context, next) => {
          next().finally(() => undefined);
          return Promise.resolve(response);
        },
      ]);
      await finallyChain.execute(context, () => Promise.reject(new Error("finally failed")));
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      2,
    );
  });

  it("invokes the final handler for an empty middleware chain", async () => {
    let finalHandlerCalls = 0;
    assertEquals(
      await new MiddlewareChain().execute(context, () => {
        finalHandlerCalls += 1;
        return Promise.resolve(response);
      }),
      response,
    );
    assertEquals(finalHandlerCalls, 1);
  });

  it("revokes a retained continuation when middleware rejects", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const middlewareError = new Error("middleware rejected");
    const chain = new MiddlewareChain([
      (_context, next) => {
        retainedNext = next;
        return Promise.reject(middlewareError);
      },
    ]);

    await assertRejects(
      () => chain.execute(context, () => Promise.resolve(response)),
      Error,
      "middleware rejected",
    );
    await assertRejects(() => retainedNext!(), VeryfrontError, replayError);
  });
});

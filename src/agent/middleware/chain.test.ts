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

function waitForReport(): Promise<void> {
  // The implementation queues its setTimeout(0) before this test helper.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
    // This intentionally relies on the continuation's internal observer to
    // suppress the invalid rejection without adding a consumer in the test.
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

  it("dispatches next after an async middleware await", async () => {
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

  it("keeps post-invocation continuation ordering explicit", async () => {
    const calls: string[] = [];
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        calls.push("outer-before-next");
        const result = next();
        calls.push("outer-after-next");
        return await result;
      },
      async (_context, next) => {
        calls.push("inner-before");
        const result = await next();
        calls.push("inner-after");
        return result;
      },
    ]);

    await chain.execute(context, () => {
      calls.push("final");
      return Promise.resolve(response);
    });
    assertEquals(calls, [
      "outer-before-next",
      "outer-after-next",
      "inner-before",
      "final",
      "inner-after",
    ]);
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
      await waitForReport();
    } finally {
      unsubscribe();
    }

    const record = records.find((entry) =>
      entry.message === "Your agent middleware continuation failed"
    );
    assertEquals(record?.context?.failure, "downstream continuation rejected");
    assertEquals(record?.context?.failure_type, "error");
    assertEquals(record?.error, undefined);
    const serializedRecord = JSON.stringify(record);
    assertEquals(serializedRecord?.includes("customer-data"), false);
    assertEquals(serializedRecord?.includes("secrets"), false);
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
      await waitForReport();
    } finally {
      unsubscribe();
    }

    const record = records.find((entry) =>
      entry.message === "Your agent middleware continuation failed"
    );
    assertEquals(record?.context?.failure, "downstream continuation rejected");
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

      const nativeAbort = new DOMException("native cancellation", "AbortError");
      const nativeAbortChain = new MiddlewareChain([
        async (_context, next) => {
          next();
          return response;
        },
      ]);
      await nativeAbortChain.execute(context, () => Promise.reject(nativeAbort));

      const crossRealmDomAbort = new DOMException("cross-realm cancellation", "AbortError");
      Object.setPrototypeOf(crossRealmDomAbort, { name: "AbortError" });
      const crossRealmDomAbortChain = new MiddlewareChain([
        async (_context, next) => {
          next();
          return response;
        },
      ]);
      await crossRealmDomAbortChain.execute(
        context,
        () => Promise.reject(crossRealmDomAbort),
      );

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
      let proxyTrapCalls = 0;
      const proxyError = new Proxy(new Error("proxy error"), {
        getPrototypeOf() {
          proxyTrapCalls += 1;
          throw new Error("proxy prototype trap failed");
        },
      });
      const proxyChain = new MiddlewareChain([
        async (_context, next) => {
          next();
          return response;
        },
      ]);
      await proxyChain.execute(context, () => Promise.reject(proxyError));
      await Promise.resolve();
      await Promise.resolve();
      await waitForReport();
      assertEquals(proxyTrapCalls, 0);
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      2,
    );
  });

  it("contains discarded derived invalid-continuation rejections", async () => {
    let retainedThen: (() => Promise<AgentResponse>) | undefined;
    let retainedFinally: (() => Promise<AgentResponse>) | undefined;
    const thenChain = new MiddlewareChain([
      (_context, next) => {
        retainedThen = next;
        return Promise.resolve(response);
      },
    ]);
    const finallyChain = new MiddlewareChain([
      (_context, next) => {
        retainedFinally = next;
        return Promise.resolve(response);
      },
    ]);

    await thenChain.execute(context, () => Promise.resolve(response));
    retainedThen!().then(() => response);
    await finallyChain.execute(context, () => Promise.resolve(response));
    retainedFinally!().finally(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    await waitForReport();
  });

  it("allows a late rejection handler before detached reporting", async () => {
    const records: LogEntry[] = [];
    let deferredContinuation: Promise<AgentResponse> | undefined;
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        (_context, next) => {
          queueMicrotask(() => {
            deferredContinuation = next();
            queueMicrotask(() => {
              deferredContinuation?.catch(() => response);
            });
          });
          return Promise.resolve(response);
        },
      ]);

      await chain.execute(context, () => Promise.reject(new Error("late handled failure")));
      await Promise.resolve();
      await Promise.resolve();
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

  it("reports detached primitive rejection reasons", async () => {
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    const cases = [
      [undefined, "primitive"],
      [null, "null"],
      ["primitive downstream failure", "primitive"],
      [42, "primitive"],
      [true, "primitive"],
      [1n, "primitive"],
      [Symbol("primitive"), "primitive"],
      [() => undefined, "primitive"],
      [{}, "object"],
    ] as const;
    try {
      for (const [reason] of cases) {
        const chain = new MiddlewareChain([
          async (_context, next) => {
            next();
            return response;
          },
        ]);
        await chain.execute(context, () => Promise.reject<AgentResponse>(reason as AgentResponse));
        await waitForReport();
      }
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      cases.length,
    );
    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .map((entry) => entry.context?.failure_type),
      cases.map(([, failureType]) => failureType),
    );
  });

  it("reports a detached continuation when middleware also rejects undefined", async () => {
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        (_context, next) => {
          next();
          return Promise.reject<AgentResponse>(undefined);
        },
      ]);
      await chain.execute(context, () => Promise.reject<AgentResponse>(undefined)).catch(
        (error) => {
          assertEquals(error, undefined);
        },
      );
      await waitForReport();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.some((entry) => entry.message === "Your agent middleware continuation failed"),
      true,
    );
  });

  it("does not report a late await handler during the grace window", async () => {
    const records: LogEntry[] = [];
    let continuation: Promise<AgentResponse> | undefined;
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const downstreamError = new Error("late await failure");
      const chain = new MiddlewareChain([
        (_context, next) => {
          continuation = next();
          return Promise.resolve(response);
        },
      ]);

      await chain.execute(context, () => Promise.reject(downstreamError));
      const error = await assertRejects(() => continuation!, Error, "late await failure");
      assertEquals(error, downstreamError);
      await waitForReport();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.some((entry) => entry.message === "Your agent middleware continuation failed"),
      false,
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
      await Promise.resolve();
      await Promise.resolve();
      await waitForReport();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      2,
    );
  });

  it("observes discarded derived rejections when Promise species is not preserving", async () => {
    const nativeSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);
    const records: LogEntry[] = [];
    const unhandled: PromiseRejectionEvent[] = [];
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event);
      event.preventDefault();
    };
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    let speciesRestored = false;
    const restoreSpecies = (): void => {
      if (speciesRestored) return;
      if (nativeSpecies) {
        Object.defineProperty(Promise, Symbol.species, nativeSpecies);
      } else {
        Reflect.deleteProperty(Promise, Symbol.species);
      }
      speciesRestored = true;
    };

    globalThis.addEventListener("unhandledrejection", onUnhandled);
    try {
      Object.defineProperty(Promise, Symbol.species, {
        configurable: true,
        get: () => Promise,
      });
      const { MiddlewareChain: NonPreservingSpeciesChain } = await import(
        "./chain.ts?non-preserving-species"
      );
      await new NonPreservingSpeciesChain([
        (_context: AgentContext, next: () => Promise<AgentResponse>) => {
          next().then(() => response);
          return Promise.resolve(response);
        },
      ]).execute(context, () => Promise.reject(new Error("species fallback failure")));
      restoreSpecies();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await waitForReport();
    } finally {
      restoreSpecies();
      globalThis.removeEventListener("unhandledrejection", onUnhandled);
      unsubscribe();
    }

    assertEquals(unhandled.length, 0);
    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      1,
    );
  });

  it("reports every unobserved derived rejection", async () => {
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        (_context, next) => {
          const continuation = next();
          continuation.then(() => response);
          continuation.finally(() => undefined).catch(() => response);
          return Promise.resolve(response);
        },
      ]);

      await chain.execute(context, () => Promise.reject(new Error("branch failure")));
      await waitForReport();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      1,
    );
  });

  it("reports a discarded branch with the same error as the returned branch", async () => {
    const sharedError = new Error("shared branch failure");
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        (_context, next) => {
          const continuation = next();
          const returnedBranch = continuation.then(() => {
            throw sharedError;
          });
          continuation.finally(() => {
            throw sharedError;
          });
          return returnedBranch;
        },
      ]);

      await assertRejects(
        () => chain.execute(context, () => Promise.resolve(response)),
        Error,
        "shared branch failure",
      );
      await waitForReport();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      1,
    );
  });

  it("reports unexpected errors from invalid continuation derivatives", async () => {
    let retainedNext: (() => Promise<AgentResponse>) | undefined;
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        (_context, next) => {
          retainedNext = next;
          return Promise.resolve(response);
        },
      ]);
      await chain.execute(context, () => Promise.resolve(response));

      const invalidContinuation = retainedNext!();
      invalidContinuation.catch(() => {
        throw new Error("invalid catch handler failed");
      });
      invalidContinuation.finally(() => {
        throw new Error("invalid finally handler failed");
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await waitForReport();
    } finally {
      unsubscribe();
    }

    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      2,
    );
  });

  it("reports detached failures while middleware remains pending", async () => {
    let releaseMiddleware: ((value: AgentResponse) => void) | undefined;
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    try {
      const chain = new MiddlewareChain([
        (_context, next) => {
          next();
          return new Promise<AgentResponse>((resolve) => {
            releaseMiddleware = resolve;
          });
        },
      ]);

      const execution = chain.execute(context, () => Promise.reject(new Error("pending failure")));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await waitForReport();
      assertEquals(
        records.some((entry) => entry.message === "Your agent middleware continuation failed"),
        true,
      );
      releaseMiddleware!(response);
      await execution;
    } finally {
      unsubscribe();
    }
  });

  it("preserves native self-resolution rejection for derived continuations", async () => {
    let derived: Promise<AgentResponse> | undefined;
    const chain = new MiddlewareChain([
      (_context, next) => {
        derived = next().then(() => derived!);
        return derived!;
      },
    ]);

    const error = await assertRejects(
      () => chain.execute(context, () => Promise.resolve(response)),
      TypeError,
    );
    assertEquals(error instanceof TypeError, true);
  });

  it("preserves self-resolution rejection for deferred continuations", async () => {
    let continuation: Promise<AgentResponse> | undefined;
    const chain = new MiddlewareChain([
      async (_context, next) => {
        await Promise.resolve();
        continuation = next();
        return await continuation;
      },
    ]);

    const error = await assertRejects(
      () => chain.execute(context, () => continuation!),
      TypeError,
    );
    assertEquals(error instanceof TypeError, true);
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

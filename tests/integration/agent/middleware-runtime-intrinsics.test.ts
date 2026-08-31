import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { VeryfrontError } from "#veryfront/errors";
import { MiddlewareChain } from "#veryfront/agent/middleware/chain.ts";
import type { AgentContext, AgentResponse } from "#veryfront/agent/types.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";

const context = {} as AgentContext;
const response = {} as AgentResponse;
const replayError =
  "You must call agent middleware next() at most once while the middleware is active";

describe("agent middleware runtime intrinsics", () => {
  it("uses captured Promise intrinsics for deferred continuation scheduling", async () => {
    let deferredContinuation: Promise<AgentResponse> | undefined;
    let finalHandlerCalls = 0;
    let poisonedResolveCalls = 0;
    let poisonedThenCalls = 0;
    const promiseResolveDescriptor = Object.getOwnPropertyDescriptor(Promise, "resolve")!;
    const promiseThenDescriptor = Object.getOwnPropertyDescriptor(Promise.prototype, "then")!;
    const nativeResolve = Promise.resolve;
    const selectedResponse = Reflect.apply(nativeResolve, Promise, [response]) as Promise<
      AgentResponse
    >;
    const chain = new MiddlewareChain([
      (_context, next) => {
        queueMicrotask(() => {
          Object.defineProperty(Promise, "resolve", {
            ...promiseResolveDescriptor,
            value(value: unknown) {
              poisonedResolveCalls += 1;
              return Reflect.apply(nativeResolve, Promise, [value]);
            },
          });
          Object.defineProperty(Promise.prototype, "then", {
            ...promiseThenDescriptor,
            value(onFulfilled?: () => unknown) {
              poisonedThenCalls += 1;
              let failure: unknown;
              try {
                onFulfilled?.();
              } catch (error) {
                failure = error;
              }
              return {
                catch(onRejected?: (error: unknown) => unknown) {
                  if (failure !== undefined) onRejected?.(failure);
                },
              };
            },
          });
          try {
            deferredContinuation = next();
          } finally {
            Object.defineProperty(Promise, "resolve", promiseResolveDescriptor);
            Object.defineProperty(Promise.prototype, "then", promiseThenDescriptor);
          }
        });
        return selectedResponse;
      },
    ]);

    assertEquals(
      await chain.execute(context, () => {
        finalHandlerCalls += 1;
        return Reflect.apply(nativeResolve, Promise, [response]);
      }),
      response,
    );
    await assertRejects(() => deferredContinuation!, VeryfrontError, replayError);
    assertEquals(poisonedResolveCalls, 0);
    assertEquals(poisonedThenCalls, 0);
    assertEquals(finalHandlerCalls, 0);
  });

  it("uses the captured timer for detached-failure grace", async () => {
    const nativeSetTimeout = globalThis.setTimeout;
    const setTimeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, "setTimeout")!;
    const downstreamError = new Error("handled downstream failure");
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    let continuation: Promise<AgentResponse> | undefined;
    let poisonedTimerCalls = 0;
    const poisonedSetTimeout = ((callback: () => void) => {
      poisonedTimerCalls += 1;
      callback();
      return 0;
    }) as typeof setTimeout;

    try {
      const chain = new MiddlewareChain([
        (_context, next) => {
          Object.defineProperty(globalThis, "setTimeout", {
            ...setTimeoutDescriptor,
            value: poisonedSetTimeout,
          });
          continuation = next();
          return Promise.resolve(response);
        },
      ]);

      try {
        assertEquals(
          await chain.execute(context, () => Promise.reject(downstreamError)),
          response,
        );
      } finally {
        Object.defineProperty(globalThis, "setTimeout", setTimeoutDescriptor);
      }
      await assertRejects(() => continuation!, Error, downstreamError.message);
      await new Promise<void>((resolve) => {
        Reflect.apply(nativeSetTimeout, globalThis, [resolve, 1]);
      });

      assertEquals(poisonedTimerCalls, 0);
      assertEquals(
        records.filter((entry) => entry.message === "Your agent middleware continuation failed")
          .length,
        0,
      );
    } finally {
      Object.defineProperty(globalThis, "setTimeout", setTimeoutDescriptor);
      unsubscribe();
    }
  });
});

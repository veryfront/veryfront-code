import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR, type VeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";
const IntrinsicPromiseThen = Promise.prototype.then;
const IntrinsicFunctionToString = Function.prototype.toString;
const INVALID_CONTINUATION_ERRORS = new WeakSet<object>();
const CONTINUATION_OBSERVATIONS = new WeakMap<object, { observed: boolean }>();
type ContinuationSpeciesHolder = { [Symbol.species]: PromiseConstructor };
interface DeferredContinuationState {
  adoptionCalls: number;
  dispatchStarted: boolean;
  reject?: (reason?: unknown) => void;
  settled: boolean;
  skipAdoptionCheck: boolean;
}
const DEFERRED_CONTINUATION_STATES = new WeakMap<object, DeferredContinuationState>();

function createInvalidContinuationError(): VeryfrontError {
  const error = MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });
  INVALID_CONTINUATION_ERRORS.add(error);
  return error;
}

function isInvalidContinuationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && INVALID_CONTINUATION_ERRORS.has(error);
}

function isNativePromiseHandler(handler: unknown): boolean {
  return typeof handler === "function" &&
    IntrinsicFunctionToString.call(handler).includes("[native code]");
}

function registerContinuation(promise: Promise<unknown>): void {
  CONTINUATION_OBSERVATIONS.set(promise, { observed: false });
}

function markContinuationObserved(promise: Promise<unknown>): void {
  const observation = CONTINUATION_OBSERVATIONS.get(promise);
  if (observation) observation.observed = true;
}

function markDeferredSettled(promise: Promise<unknown>): void {
  const state = DEFERRED_CONTINUATION_STATES.get(promise);
  if (!state || state.settled) return;
  state.settled = true;
}

function markDeferredDispatchStarted(promise: Promise<unknown>): void {
  const state = DEFERRED_CONTINUATION_STATES.get(promise);
  if (state && !state.settled) state.dispatchStarted = true;
}

function containRejection(promise: Promise<unknown>): void {
  const observation = CONTINUATION_OBSERVATIONS.get(promise);
  void IntrinsicPromiseThen.call(promise, undefined, (error: unknown) => {
    if (isInvalidContinuationError(error)) return undefined;
    if (observation?.observed) return undefined;
    setTimeout(() => {
      if (!observation?.observed) void Promise.reject(error);
    }, 0);
    return undefined;
  });
}

class InvalidContinuationPromise extends Promise<AgentResponse> {
  override then<TResult1 = AgentResponse, TResult2 = never>(
    onFulfilled?:
      | ((value: AgentResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    markContinuationObserved(this);
    const derived = IntrinsicPromiseThen.call(
      this,
      onFulfilled,
      onRejected,
    ) as Promise<TResult1 | TResult2>;
    lockContinuationSpecies(derived, INVALID_CONTINUATION_SPECIES_HOLDER);
    registerContinuation(derived);
    containRejection(derived);
    return derived;
  }
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  const rejection = new InvalidContinuationPromise(
    (_resolve, reject) => reject(createInvalidContinuationError()),
  );
  lockContinuationSpecies(rejection, INVALID_CONTINUATION_SPECIES_HOLDER);
  registerContinuation(rejection);
  containRejection(rejection);
  return rejection;
}

class DeferredContinuationPromise extends Promise<AgentResponse> {
  constructor(
    executor: (
      resolve: (value: AgentResponse | PromiseLike<AgentResponse>) => void,
      reject: (reason?: unknown) => void,
    ) => void,
  ) {
    let rejectCapability: ((reason?: unknown) => void) | undefined;
    super((resolve, reject) => {
      rejectCapability = reject;
      executor(resolve, reject);
    });
    DEFERRED_CONTINUATION_STATES.set(this, {
      dispatchStarted: false,
      adoptionCalls: 0,
      reject: rejectCapability,
      settled: false,
      skipAdoptionCheck: false,
    });
  }

  override then<TResult1 = AgentResponse, TResult2 = never>(
    onFulfilled?:
      | ((value: AgentResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onRejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    markContinuationObserved(this);
    const state = DEFERRED_CONTINUATION_STATES.get(this);
    if (
      state && state.dispatchStarted && !state.settled && !state.skipAdoptionCheck &&
      isNativePromiseHandler(onFulfilled) && isNativePromiseHandler(onRejected)
    ) {
      state.adoptionCalls += 1;
      if (state.adoptionCalls > 1) {
        state.reject?.(new TypeError("Your middleware continuation cannot resolve to itself"));
      }
    }
    const derived = IntrinsicPromiseThen.call(
      this,
      onFulfilled,
      onRejected,
    ) as Promise<TResult1 | TResult2>;
    lockContinuationSpecies(derived, DEFERRED_CONTINUATION_SPECIES_HOLDER);
    registerContinuation(derived);
    observeDeferredSettlement(derived);
    return derived;
  }

  override finally(onFinally?: (() => void | PromiseLike<void>) | null): Promise<AgentResponse> {
    const state = DEFERRED_CONTINUATION_STATES.get(this);
    if (state) state.skipAdoptionCheck = true;
    try {
      return Promise.prototype.finally.call(this, onFinally);
    } finally {
      if (state) state.skipAdoptionCheck = false;
    }
  }
}

const INVALID_CONTINUATION_SPECIES_HOLDER = Object.create(null);
Object.defineProperty(INVALID_CONTINUATION_SPECIES_HOLDER, Symbol.species, {
  value: InvalidContinuationPromise,
});
Object.freeze(INVALID_CONTINUATION_SPECIES_HOLDER);

const DEFERRED_CONTINUATION_SPECIES_HOLDER = Object.create(null);
Object.defineProperty(DEFERRED_CONTINUATION_SPECIES_HOLDER, Symbol.species, {
  value: DeferredContinuationPromise,
});
Object.freeze(DEFERRED_CONTINUATION_SPECIES_HOLDER);

function lockContinuationSpecies(
  promise: Promise<unknown>,
  holder: ContinuationSpeciesHolder,
): void {
  Object.defineProperty(promise, "constructor", {
    configurable: false,
    value: holder,
    writable: false,
  });
}

function observeDeferredSettlement(promise: Promise<unknown>): void {
  const observation = CONTINUATION_OBSERVATIONS.get(promise);
  void IntrinsicPromiseThen.call(
    promise,
    () => {
      markDeferredSettled(promise);
    },
    (error: unknown) => {
      markDeferredSettled(promise);
      if (isInvalidContinuationError(error) || observation?.observed) return undefined;
      setTimeout(() => {
        if (!observation?.observed) void Promise.reject(error);
      }, 0);
      return undefined;
    },
  );
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
  waitForSettlementObservation = false,
): Promise<AgentResponse> {
  const continuation = new DeferredContinuationPromise((resolve, reject) => {
    const schedule = () => {
      if (isSettled()) {
        const error = createInvalidContinuationError();
        markDeferredSettled(continuation);
        reject(error);
        return;
      }
      markDeferredDispatchStarted(continuation);
      const dispatched = dispatch();
      if (dispatched === continuation) {
        reject(new TypeError("Your middleware continuation cannot resolve to itself"));
        return;
      }
      void IntrinsicPromiseThen.call(
        dispatched,
        (value: AgentResponse) => {
          markDeferredSettled(continuation);
          resolve(value);
        },
        (error: unknown) => {
          markDeferredSettled(continuation);
          reject(error);
        },
      );
    };
    const schedulingPromise = Promise.resolve();
    const scheduled = waitForSettlementObservation
      ? IntrinsicPromiseThen.call(
        IntrinsicPromiseThen.call(schedulingPromise, () => undefined),
        schedule,
      )
      : IntrinsicPromiseThen.call(schedulingPromise, schedule);
    void IntrinsicPromiseThen.call(scheduled, undefined, (error: unknown) => {
      markDeferredSettled(continuation);
      reject(error);
    });
  });
  lockContinuationSpecies(continuation, DEFERRED_CONTINUATION_SPECIES_HOLDER);
  registerContinuation(continuation);
  observeDeferredSettlement(continuation);
  return continuation;
}

export class MiddlewareChain {
  private middleware: AgentMiddleware[];

  constructor(middleware: AgentMiddleware[] = []) {
    this.middleware = middleware;
  }

  execute(
    context: AgentContext,
    finalHandler: () => Promise<AgentResponse>,
  ): Promise<AgentResponse> {
    return withSpan(
      "agent.middleware.chain.execute",
      () => {
        const dispatch = (middlewareIndex: number): Promise<AgentResponse> => {
          const currentMiddleware = this.middleware[middlewareIndex];

          if (!currentMiddleware) return finalHandler();

          return withSpan(
            `agent.middleware.chain.dispatch.${middlewareIndex + 1}`,
            async () => {
              let nextCalled = false;
              let middlewareInvoking = true;
              let middlewareSettled = false;
              let middlewareResultSettled = false;
              let middlewareObservingResult = false;
              const next = (): Promise<AgentResponse> => {
                if (nextCalled || middlewareSettled || middlewareResultSettled) {
                  return rejectInvalidContinuation();
                }
                nextCalled = true;
                if (!middlewareInvoking) {
                  return createDeferredContinuation(
                    () => middlewareSettled || middlewareResultSettled,
                    () => dispatch(middlewareIndex + 1),
                    middlewareObservingResult,
                  );
                }
                return dispatch(middlewareIndex + 1);
              };

              try {
                const result = currentMiddleware(context, next);
                middlewareInvoking = false;
                middlewareObservingResult = true;
                const observedResult = new Promise<AgentResponse>((resolve, reject) => {
                  try {
                    void IntrinsicPromiseThen.call(
                      result,
                      (value: AgentResponse) => {
                        middlewareResultSettled = true;
                        resolve(value);
                      },
                      (error: unknown) => {
                        middlewareResultSettled = true;
                        reject(error);
                      },
                    );
                  } catch (error) {
                    middlewareResultSettled = true;
                    reject(error);
                  }
                });
                middlewareObservingResult = false;
                return await observedResult;
              } finally {
                middlewareSettled = true;
              }
            },
            { "middleware.index": middlewareIndex },
          );
        };

        return dispatch(0);
      },
      { "middleware.count": this.middleware.length },
    );
  }

  use(middleware: AgentMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }

  prepend(middleware: AgentMiddleware): this {
    this.middleware.unshift(middleware);
    return this;
  }

  get length(): number {
    return this.middleware.length;
  }

  isEmpty(): boolean {
    return this.middleware.length === 0;
  }
}

export function createMiddlewareChain(
  middleware?: AgentMiddleware[],
): MiddlewareChain {
  return new MiddlewareChain(middleware);
}

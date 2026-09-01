import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR, type VeryfrontError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const INVALID_CONTINUATION_MESSAGE =
  "You must call agent middleware next() at most once while the middleware is active";
const IntrinsicPromiseThen = Promise.prototype.then;
const INVALID_CONTINUATION_ERRORS = new WeakSet<object>();
const INVALID_CONTINUATION_ORIGINS = new WeakMap<object, VeryfrontError>();
const CONTINUATION_OBSERVATIONS = new WeakMap<object, { observed: boolean }>();
type ContinuationSpeciesHolder = { [Symbol.species]: PromiseConstructor };

function createInvalidContinuationError(): VeryfrontError {
  const error = MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });
  INVALID_CONTINUATION_ERRORS.add(error);
  return error;
}

function isInvalidContinuationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && INVALID_CONTINUATION_ERRORS.has(error);
}

function registerInvalidContinuationOrigin(
  promise: Promise<unknown>,
  error: VeryfrontError,
): void {
  INVALID_CONTINUATION_ORIGINS.set(promise, error);
}

function registerContinuation(promise: Promise<unknown>): void {
  CONTINUATION_OBSERVATIONS.set(promise, { observed: false });
}

function markContinuationObserved(promise: Promise<unknown>): void {
  const observation = CONTINUATION_OBSERVATIONS.get(promise);
  if (observation) observation.observed = true;
}

function containRejection(promise: Promise<unknown>): void {
  const observation = CONTINUATION_OBSERVATIONS.get(promise);
  void IntrinsicPromiseThen.call(promise, undefined, (error: unknown) => {
    if (
      isInvalidContinuationError(error) &&
      INVALID_CONTINUATION_ORIGINS.get(promise) === error
    ) return undefined;
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
    const origin = INVALID_CONTINUATION_ORIGINS.get(this);
    if (origin) registerInvalidContinuationOrigin(derived, origin);
    containRejection(derived);
    return derived;
  }
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  const error = createInvalidContinuationError();
  const rejection = new InvalidContinuationPromise(
    (_resolve, reject) => reject(error),
  );
  lockContinuationSpecies(rejection, INVALID_CONTINUATION_SPECIES_HOLDER);
  registerContinuation(rejection);
  registerInvalidContinuationOrigin(rejection, error);
  containRejection(rejection);
  return rejection;
}

class DeferredContinuationPromise extends Promise<AgentResponse> {
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
    lockContinuationSpecies(derived, DEFERRED_CONTINUATION_SPECIES_HOLDER);
    registerContinuation(derived);
    const origin = INVALID_CONTINUATION_ORIGINS.get(this);
    if (origin) registerInvalidContinuationOrigin(derived, origin);
    observeDeferredSettlement(derived);
    return derived;
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
  containRejection(promise);
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
): Promise<AgentResponse> {
  const invalidError = createInvalidContinuationError();
  const continuation = new DeferredContinuationPromise((resolve, reject) => {
    const schedule = () => {
      if (isSettled()) {
        reject(invalidError);
        return;
      }
      const dispatched = dispatch();
      if (dispatched === continuation) {
        reject(new TypeError("Your middleware continuation cannot resolve to itself"));
        return;
      }
      void IntrinsicPromiseThen.call(
        dispatched,
        (value: AgentResponse) => {
          resolve(value);
        },
        (error: unknown) => {
          reject(error);
        },
      );
    };
    const scheduled = IntrinsicPromiseThen.call(Promise.resolve(), schedule);
    void IntrinsicPromiseThen.call(scheduled, undefined, (error: unknown) => {
      reject(error);
    });
  });
  lockContinuationSpecies(continuation, DEFERRED_CONTINUATION_SPECIES_HOLDER);
  registerContinuation(continuation);
  registerInvalidContinuationOrigin(continuation, invalidError);
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
                if (
                  nextCalled || middlewareSettled || middlewareResultSettled ||
                  middlewareObservingResult
                ) {
                  return rejectInvalidContinuation();
                }
                nextCalled = true;
                if (!middlewareInvoking) {
                  return createDeferredContinuation(
                    () => middlewareSettled || middlewareResultSettled,
                    () => dispatch(middlewareIndex + 1),
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

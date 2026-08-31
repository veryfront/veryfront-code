import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const INVALID_CONTINUATION_MESSAGE =
  "Agent middleware next() can only be called once while middleware is active";
const NOOP = (): undefined => undefined;

class DeferredContinuationPromise extends Promise<AgentResponse> {}

function createInvalidContinuationError() {
  return MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });
}

function consumeRejectedPromise(promise: Promise<AgentResponse>): void {
  void promise.then(NOOP, NOOP);
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  const rejection = Promise.reject<AgentResponse>(createInvalidContinuationError());
  consumeRejectedPromise(rejection);
  return rejection;
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
  middlewareResult: Promise<AgentResponse>,
): Promise<AgentResponse> {
  let started = false;
  let resolveContinuation: (response: AgentResponse) => void = () => {};
  let rejectContinuation: (error: unknown) => void = () => {};
  const continuationPromise = new DeferredContinuationPromise((resolve, reject) => {
    resolveContinuation = resolve;
    rejectContinuation = reject;
  });

  let start = (): void => {};
  const startContinuation = (): void => {
    if (started) return;
    started = true;
    if (isSettled()) {
      rejectContinuation(createInvalidContinuationError());
      return;
    }

    let dispatched: Promise<AgentResponse>;
    try {
      dispatched = dispatch();
    } catch (error) {
      rejectContinuation(error);
      return;
    }
    void dispatched.then(resolveContinuation, rejectContinuation);
  };
  start = startContinuation;

  void middlewareResult.then(
    () => {
      if (!started) rejectContinuation(createInvalidContinuationError());
    },
    () => {
      if (!started) rejectContinuation(createInvalidContinuationError());
    },
  );
  const nativeThen = Promise.prototype.then.bind(
    continuationPromise,
  ) as typeof continuationPromise.then;
  void nativeThen(NOOP, NOOP);

  const then: typeof continuationPromise.then = (onFulfilled, onRejected) => {
    start();
    return nativeThen(onFulfilled, onRejected);
  };
  Object.defineProperty(continuationPromise, "then", { value: then });

  return continuationPromise;
}

interface MiddlewareContinuation {
  next: () => Promise<AgentResponse>;
  finishInvocation: (result: Promise<AgentResponse>) => void;
  settle: () => void;
}

function createMiddlewareContinuation(
  dispatch: () => Promise<AgentResponse>,
): MiddlewareContinuation {
  let nextCalled = false;
  let middlewareInvoking = true;
  let middlewareSettled = false;
  let middlewareResult: Promise<AgentResponse> | undefined;

  const next = (): Promise<AgentResponse> => {
    if (nextCalled || middlewareSettled) return rejectInvalidContinuation();
    nextCalled = true;

    if (!middlewareInvoking) {
      return createDeferredContinuation(
        () => middlewareSettled,
        dispatch,
        middlewareResult!,
      );
    }

    return dispatch();
  };

  return {
    next,
    finishInvocation: (result) => {
      middlewareInvoking = false;
      middlewareResult = result;
    },
    settle: () => {
      middlewareInvoking = false;
      middlewareSettled = true;
    },
  };
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
              const continuation = createMiddlewareContinuation(
                () => dispatch(middlewareIndex + 1),
              );

              try {
                const result = currentMiddleware(context, continuation.next);
                continuation.finishInvocation(result);
                return await result;
              } finally {
                continuation.settle();
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

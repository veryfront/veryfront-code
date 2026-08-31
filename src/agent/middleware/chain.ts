import type { AgentContext, AgentMiddleware, AgentResponse } from "../types.ts";
import { MIDDLEWARE_ERROR } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { agentLogger } from "#veryfront/utils/logger/index.ts";

const INVALID_CONTINUATION_MESSAGE =
  "Agent middleware next() can only be called once while middleware is active";
const INVALID_CONTINUATION_ERRORS = new WeakSet<object>();

function createInvalidContinuationError() {
  const error = MIDDLEWARE_ERROR.create({ message: INVALID_CONTINUATION_MESSAGE });
  INVALID_CONTINUATION_ERRORS.add(error);
  return error;
}

function isInvalidContinuationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && INVALID_CONTINUATION_ERRORS.has(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function observeContinuationRejection(
  promise: Promise<AgentResponse>,
  onUnexpectedRejection?: (error: unknown) => void,
): void {
  void promise.catch((error) => {
    if (isInvalidContinuationError(error) || isAbortError(error)) return;
    onUnexpectedRejection?.(error);
  });
}

function rejectInvalidContinuation(): Promise<AgentResponse> {
  const rejection = Promise.reject<AgentResponse>(createInvalidContinuationError());
  observeContinuationRejection(rejection);
  return rejection;
}

function createDeferredContinuation(
  isSettled: () => boolean,
  dispatch: () => Promise<AgentResponse>,
  onUnexpectedRejection?: (error: unknown) => void,
): Promise<AgentResponse> {
  const continuation = Promise.resolve().then(() => {
    if (isSettled()) throw createInvalidContinuationError();
    return dispatch();
  });
  observeContinuationRejection(continuation, onUnexpectedRejection);
  return continuation;
}

interface MiddlewareContinuation {
  next: () => Promise<AgentResponse>;
  finishInvocation: () => void;
  settle: (error?: unknown) => void;
}

function createMiddlewareContinuation(
  dispatch: () => Promise<AgentResponse>,
): MiddlewareContinuation {
  let nextCalled = false;
  let middlewareInvoking = true;
  let middlewareSettled = false;
  let middlewareSettlementError: unknown;
  let continuationRejection: { error: unknown } | undefined;

  const reportContinuationFailure = (error: unknown): void => {
    if (!middlewareSettled) {
      continuationRejection = { error };
      return;
    }
    if (middlewareSettlementError === error) return;
    agentLogger.error("Agent middleware continuation failed", error);
  };

  const next = (): Promise<AgentResponse> => {
    if (nextCalled || middlewareSettled) return rejectInvalidContinuation();
    nextCalled = true;

    if (!middlewareInvoking) {
      return createDeferredContinuation(
        () => middlewareSettled,
        dispatch,
        reportContinuationFailure,
      );
    }

    const continuation = dispatch();
    observeContinuationRejection(continuation, reportContinuationFailure);
    return continuation;
  };

  return {
    next,
    finishInvocation: () => {
      middlewareInvoking = false;
    },
    settle: (error?: unknown) => {
      middlewareInvoking = false;
      middlewareSettled = true;
      middlewareSettlementError = error;
      const rejection = continuationRejection;
      continuationRejection = undefined;
      if (rejection && rejection.error !== error) {
        agentLogger.error("Agent middleware continuation failed", rejection.error);
      }
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

              let middlewareError: unknown;
              try {
                const result = currentMiddleware(context, continuation.next);
                continuation.finishInvocation();
                return await result;
              } catch (error) {
                middlewareError = error;
                throw error;
              } finally {
                continuation.settle(middlewareError);
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

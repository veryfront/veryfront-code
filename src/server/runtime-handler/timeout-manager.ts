/**
 * Timeout Manager
 *
 * Handles request timeout logic with Promise.race pattern for the runtime handler.
 *
 * @module server/runtime-handler/timeout-manager
 */

import { getBaseLogger } from "#veryfront/utils";
import { getRequestTimeout, HTTP_GATEWAY_TIMEOUT, TIMEOUT_SENTINEL } from "./request-utils.ts";
import { ErrorPages } from "../utils/error-html.ts";
import type { RuntimeResponse } from "#veryfront/platform/adapters/base.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("runtime-handler");

const PRIVATE_ERROR_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

interface RequestTimeoutOptions {
  /** Preserve cancellation from the inbound request while adding the timeout. */
  signal?: AbortSignal;
  /** Override the configured timeout. Intended for focused tests. */
  timeoutMs?: number;
}

/**
 * Execute a handler with a timeout, returning a timeout response if exceeded.
 *
 * An AbortController is created per request; its signal is passed to the handler
 * so network calls and renders can observe cancellation. When the timeout fires
 * the controller is aborted before returning the 504 response.
 *
 * The returned `settled` promise resolves once the underlying handler finishes
 * (whether it completed normally, threw, or was aborted). Callers that track
 * in-flight work for graceful drain should wait on `settled` before decrementing
 * their counters. Otherwise a timed-out request may be counted as done while
 * work is still running.
 *
 * @param executeHandler - The async function to execute; receives an AbortSignal
 * @param pathname - The request pathname (for logging)
 * @param method - The HTTP method (for logging)
 * @returns The handler response or a timeout response, plus a drain sentinel
 */
export async function withRequestTimeout<T extends RuntimeResponse>(
  executeHandler: (signal: AbortSignal) => Promise<T>,
  _pathname: string,
  method: string,
  options: RequestTimeoutOptions = {},
): Promise<{
  response: T | Response;
  error?: Error;
  settled: Promise<void>;
}> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortFromParent();
  } else {
    options.signal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const handlerPromise = Promise.resolve().then(() => executeHandler(controller.signal));
  const timeoutMs = options.timeoutMs ?? getRequestTimeout();

  // settled resolves when the handler finishes regardless of outcome, giving
  // callers a hook to defer in-flight decrements until work truly completes.
  const settled = handlerPromise.then(
    () => undefined,
    () => undefined,
  );
  void settled.then(() => options.signal?.removeEventListener("abort", abortFromParent));

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      handlerPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(TIMEOUT_SENTINEL), timeoutMs);
      }),
    ]);

    return { response, settled };
  } catch (e) {
    if (e === TIMEOUT_SENTINEL) {
      controller.abort();
      logger.warn("Request timed out", {
        method,
        timeoutMs,
      });

      const response = new Response(
        JSON.stringify({
          error: "Request timeout",
        }),
        {
          status: HTTP_GATEWAY_TIMEOUT,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...PRIVATE_ERROR_HEADERS,
          },
        },
      );

      return { response, settled };
    }

    const error = e instanceof Error ? e : new Error(String(e));
    logger.error("Unhandled error in request handler", {
      method,
      errorName: e instanceof Error ? e.name : typeof e,
    });
    return {
      response: new Response(ErrorPages.serverError(), {
        status: 500,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          ...PRIVATE_ERROR_HEADERS,
        },
      }),
      error,
      settled,
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

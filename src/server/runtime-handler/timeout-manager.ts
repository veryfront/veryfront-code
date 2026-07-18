/**
 * Timeout Manager
 *
 * Handles request timeout logic with Promise.race pattern for the runtime handler.
 *
 * @module server/runtime-handler/timeout-manager
 */

import { getBaseLogger } from "#veryfront/utils/logger/logger.ts";
import { getRequestTimeout, HTTP_GATEWAY_TIMEOUT, TIMEOUT_SENTINEL } from "./request-utils.ts";
import { ErrorPages } from "../utils/error-html.ts";

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("runtime-handler");

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
 * their counters — otherwise a timed-out request may be counted as done while
 * work is still running.
 *
 * @param executeHandler - The async function to execute; receives an AbortSignal
 * @param pathname - The request pathname (for logging)
 * @param method - The HTTP method (for logging)
 * @returns The handler response or a timeout response, plus a drain sentinel
 */
export async function withRequestTimeout(
  executeHandler: (signal: AbortSignal) => Promise<Response>,
  pathname: string,
  method: string,
): Promise<{ response: Response; error?: Error; settled: Promise<void> }> {
  const controller = new AbortController();
  const handlerPromise = executeHandler(controller.signal);

  // settled resolves when the handler finishes regardless of outcome, giving
  // callers a hook to defer in-flight decrements until work truly completes.
  let settledResolve!: () => void;
  const settled = new Promise<void>((resolve) => {
    settledResolve = resolve;
  });
  handlerPromise.then(settledResolve, settledResolve);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      handlerPromise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(TIMEOUT_SENTINEL), getRequestTimeout());
      }),
    ]);

    return { response, settled };
  } catch (e) {
    if (e === TIMEOUT_SENTINEL) {
      controller.abort();
      logger.warn("Request timed out", {
        path: pathname,
        method,
        timeoutMs: getRequestTimeout(),
      });

      const response = new Response(
        JSON.stringify({
          error: "Request timeout",
          timeoutMs: getRequestTimeout(),
          path: pathname,
        }),
        {
          status: HTTP_GATEWAY_TIMEOUT,
          headers: { "Content-Type": "application/json" },
        },
      );

      return { response, settled };
    }

    const error = e instanceof Error ? e : new Error(String(e));
    logger.error("Unhandled error in request handler", {
      path: pathname,
      method,
      error: error.message,
      stack: error.stack,
    });
    return {
      response: new Response(ErrorPages.serverError(), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      error,
      settled,
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

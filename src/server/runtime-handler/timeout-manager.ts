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

const logger = getBaseLogger("SERVER");

const log = logger.component("runtime-handler");

/**
 * Execute a handler with a timeout, returning a timeout response if exceeded.
 *
 * @param executeHandler - The async function to execute
 * @param pathname - The request pathname (for logging)
 * @param method - The HTTP method (for logging)
 * @returns The handler response or a timeout response
 */
export async function withRequestTimeout(
  executeHandler: () => Promise<Response>,
  pathname: string,
  method: string,
): Promise<{ response: Response; error?: Error }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const response = await Promise.race([
      executeHandler(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(TIMEOUT_SENTINEL), getRequestTimeout());
      }),
    ]);

    return { response };
  } catch (e) {
    if (e === TIMEOUT_SENTINEL) {
      log.warn("Request timed out", {
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

      return { response };
    }

    const error = e instanceof Error ? e : new Error(String(e));
    return {
      response: new Response(ErrorPages.serverError(), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
      error,
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

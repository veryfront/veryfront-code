/** @internal Shared bounded transport for integration APIs and legacy runtime tools. */
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { logger } from "#veryfront/utils";
import {
  INTEGRATION_REQUEST_TIMEOUT_MS,
  MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH,
} from "./limits.ts";

interface IntegrationRequestSignalScope {
  signal: AbortSignal;
  dispose: () => void;
}
const utf8Encoder = new TextEncoder();

// Captured before project code runs: `resolveRequestAuth` passes the
// host-private stored login token through this validator, so a project that
// replaces `String.prototype.charCodeAt` must not observe the credential from
// the method receiver.
const applyIntrinsic = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;

export function isValidIntegrationApiToken(token: unknown): token is string {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH
  ) {
    return false;
  }
  for (let index = 0; index < token.length; index++) {
    const code = applyIntrinsic(stringCharCodeAt, token, [index]) as number;
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

export function createIntegrationRequestSignalScope(
  callerSignal: AbortSignal | undefined,
): IntegrationRequestSignalScope {
  callerSignal?.throwIfAborted();

  const controller = new AbortController();
  const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
  const timeoutId = setTimeout(() => {
    controller.abort(
      new DOMException(
        `Integration API request timed out after ${INTEGRATION_REQUEST_TIMEOUT_MS} ms`,
        "TimeoutError",
      ),
    );
  }, INTEGRATION_REQUEST_TIMEOUT_MS);
  const detachCaller = () => {
    callerSignal?.removeEventListener("abort", forwardCallerAbort);
  };
  const cleanupAfterAbort = () => {
    clearTimeout(timeoutId);
    detachCaller();
  };
  controller.signal.addEventListener("abort", cleanupAfterAbort, { once: true });

  if (callerSignal) {
    callerSignal.addEventListener("abort", forwardCallerAbort, { once: true });
    // An abort can race the initial check and listener registration.
    if (callerSignal.aborted) forwardCallerAbort();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeoutId);
      detachCaller();
      controller.signal.removeEventListener("abort", cleanupAfterAbort);
    },
  };
}

export function discardResponseBody(response: Response): void {
  if (!response.body) return;

  try {
    void response.body.cancel().catch((error) => {
      logger.debug("Failed to discard integration API response body", {
        status: response.status,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    });
  } catch (error) {
    logger.debug("Failed to discard integration API response body", {
      status: response.status,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function assertResponseContentLengthWithin(
  response: Response,
  maxBytes: number,
  label: string,
): void {
  const rawContentLength = response.headers.get("content-length");
  if (rawContentLength === null) return;

  const contentLength = Number(rawContentLength.trim());
  if (
    !/^\d+$/.test(rawContentLength.trim()) ||
    !Number.isSafeInteger(contentLength) ||
    contentLength > maxBytes
  ) {
    discardResponseBody(response);
    throw new Error(`${label} exceeds the ${maxBytes}-byte response limit`);
  }
}

export async function readBoundedResponseJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  label: string,
): Promise<unknown> {
  assertResponseContentLengthWithin(response, maxBytes, label);
  const { text, truncated } = await readResponseTextPrefix(
    response,
    maxBytes + 1,
    signal,
    { fatalUtf8: true },
  );
  if (truncated || utf8Encoder.encode(text).byteLength > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte response limit`);
  }

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new SyntaxError(`${label} is not valid JSON`, { cause });
  }
}

/** @internal Dispatch exactly one guarded integration request without adding retries. */
export async function dispatchIntegrationApiRequest(input: {
  requestUrl: string;
  token: string;
  serializedBody?: string | undefined;
  projectSlug?: string | undefined;
  expectedProjectId?: string | undefined;
  signal: AbortSignal;
  method?: "GET" | "POST";
  redirect?: "error";
}): Promise<Response> {
  const {
    requestUrl,
    token,
    serializedBody,
    projectSlug,
    expectedProjectId,
    signal,
    method = "POST",
    redirect,
  } = input;
  signal.throwIfAborted();

  // The credential may be the host-private stored login token, so the request
  // goes through the host transport rather than `globalThis.fetch`. Locally
  // loaded project code runs in this process and can replace the global, and a
  // direct call would hand its replacement the `Authorization` header to read.
  //
  // This also puts the call under the host egress ceiling, which denies private
  // and loopback destinations. A deployment that points `VERYFRONT_API_URL` /
  // `VERYFRONT_API_BASE_URL` at an internal host must set
  // `VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS`; that is the intended disposition,
  // since only the host process can set it and a project overlay cannot.
  return await guardedOutboundFetch(requestUrl, {
    method,
    ...(redirect ? { redirect } : {}),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(projectSlug ? { "x-veryfront-project-slug": projectSlug } : {}),
      ...(expectedProjectId ? { "x-veryfront-expected-project-id": expectedProjectId } : {}),
    },
    ...(serializedBody !== undefined ? { body: serializedBody } : {}),
    signal,
  });
}

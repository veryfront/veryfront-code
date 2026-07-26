import { REQUEST_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import {
  InvalidResponseBodyUtf8Error,
  readResponseTextPrefix,
} from "#veryfront/utils/response-body.ts";
import { MAX_SANDBOX_TIMER_MS } from "./config.ts";

export const DEFAULT_SANDBOX_CONTROL_REQUEST_TIMEOUT_MS = 15_000;
export const MAX_SANDBOX_ERROR_BODY_BYTES = 8 * 1024;
export const MAX_SANDBOX_JSON_RESPONSE_BYTES = 16 * 1024 * 1024;
export const MAX_SANDBOX_FILE_RESPONSE_BYTES = 64 * 1024 * 1024;

class SandboxHttpResponseCause extends Error {
  constructor(readonly status: number) {
    super(`Sandbox HTTP response status ${status}`);
    this.name = "SandboxHttpResponseCause";
  }
}

class SandboxRequestTimeoutCause extends Error {
  constructor(readonly timeoutMs: number, options?: ErrorOptions) {
    super(`Sandbox request timed out after ${timeoutMs} ms`, options);
    this.name = "SandboxRequestTimeoutCause";
  }
}

class SandboxTransportCause extends Error {
  constructor(options?: ErrorOptions) {
    super("Sandbox transport request failed", options);
    this.name = "SandboxTransportCause";
  }
}

export interface SandboxRequestInput<T> {
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  operation: string;
  consume: (response: Response, signal: AbortSignal | undefined) => Promise<T>;
}

interface SandboxResponseReadOptions {
  operation: string;
  maxBytes: number;
  signal?: AbortSignal;
}

function validateTimeoutMs(timeoutMs: number): void {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_SANDBOX_TIMER_MS
  ) {
    throw new RangeError(
      `Sandbox request timeout must be an integer between 0 and ${MAX_SANDBOX_TIMER_MS}`,
    );
  }
}

function validateMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Sandbox response byte limit must be a positive safe integer");
  }
}

function cancelResponseBody(response: Response, reason?: unknown): void {
  try {
    const cancellation = response.body?.cancel(reason);
    void cancellation?.catch(() => {});
  } catch {
    // Cancellation is best-effort cleanup for a response the caller will not consume.
  }
}

async function readSandboxErrorDetail(
  response: Response,
  signal?: AbortSignal,
): Promise<string> {
  const { text, truncated } = await readResponseTextPrefix(
    response,
    MAX_SANDBOX_ERROR_BODY_BYTES,
    signal,
  );
  const detail = text.trim();
  if (!detail) return response.statusText.trim();
  return truncated ? `${detail}…` : detail;
}

async function createSandboxHttpError(
  response: Response,
  operation: string,
  signal?: AbortSignal,
): Promise<Error> {
  const detail = await readSandboxErrorDetail(response, signal);
  return REQUEST_ERROR.create({
    status: response.status,
    detail: `${operation}: ${response.status}${detail ? ` ${detail}` : ""}`,
    cause: new SandboxHttpResponseCause(response.status),
  });
}

export async function requestSandboxResponse<T>(input: SandboxRequestInput<T>): Promise<T> {
  validateTimeoutMs(input.timeoutMs);

  const callerSignal = input.init?.signal ?? undefined;
  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  if (input.timeoutMs > 0) {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Sandbox request timed out", "TimeoutError"));
    }, input.timeoutMs);
  }

  try {
    let response: Response;
    try {
      response = await fetch(input.url, {
        ...input.init,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut || callerSignal?.aborted) throw cause;
      throw REQUEST_ERROR.create({
        detail: `${input.operation}: transport request failed`,
        cause: new SandboxTransportCause({ cause }),
      });
    }
    controller.signal.throwIfAborted();

    if (!response.ok) {
      throw await createSandboxHttpError(response, input.operation, controller.signal);
    }

    const result = await input.consume(response, controller.signal);
    controller.signal.throwIfAborted();
    return result;
  } catch (cause) {
    if (timedOut) {
      throw TIMEOUT_ERROR.create({
        detail: `${input.operation} timed out after ${input.timeoutMs} ms`,
        cause: new SandboxRequestTimeoutCause(input.timeoutMs, { cause }),
      });
    }
    throw cause;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

/** Return the HTTP status carried by a sandbox response error, if any. */
export function getSandboxHttpErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.cause instanceof SandboxHttpResponseCause ? error.cause.status : undefined;
}

/** Whether an error came from a sandbox transport deadline. */
export function isSandboxRequestTimeout(error: unknown): boolean {
  return error instanceof Error && error.cause instanceof SandboxRequestTimeoutCause;
}

/** Whether a sandbox request failed before receiving an HTTP response. */
export function isSandboxTransportError(error: unknown): boolean {
  return error instanceof Error && error.cause instanceof SandboxTransportCause;
}

/** Read a successful sandbox response under a byte limit. */
export async function readBoundedSandboxText(
  response: Response,
  options: SandboxResponseReadOptions,
): Promise<string> {
  validateMaxBytes(options.maxBytes);
  let text: string;
  let truncated: boolean;
  try {
    ({ text, truncated } = await readResponseTextPrefix(
      response,
      options.maxBytes,
      options.signal,
      { fatalUtf8: true },
    ));
  } catch (cause) {
    if (!(cause instanceof InvalidResponseBodyUtf8Error)) throw cause;
    throw REQUEST_ERROR.create({
      detail: `${options.operation} response is not valid UTF-8`,
      cause,
    });
  }
  if (truncated) {
    throw REQUEST_ERROR.create({
      detail: `${options.operation} response exceeded ${options.maxBytes} bytes`,
    });
  }
  return text;
}

/** Perform a sandbox request and parse a bounded JSON response. */
export async function requestSandboxJson(input: {
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  operation: string;
  maxBytes?: number;
}): Promise<unknown> {
  return await requestSandboxResponse({
    ...input,
    consume: async (response, signal) => {
      const text = await readBoundedSandboxText(response, {
        operation: input.operation,
        maxBytes: input.maxBytes ?? MAX_SANDBOX_JSON_RESPONSE_BYTES,
        signal,
      });
      try {
        return JSON.parse(text) as unknown;
      } catch (cause) {
        throw REQUEST_ERROR.create({
          detail: `${input.operation} response is not valid JSON`,
          cause,
        });
      }
    },
  });
}

/** Perform a sandbox request and read a bounded text response. */
export async function requestSandboxText(input: {
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  operation: string;
  maxBytes: number;
}): Promise<string> {
  return await requestSandboxResponse({
    ...input,
    consume: async (response, signal) =>
      await readBoundedSandboxText(response, {
        operation: input.operation,
        maxBytes: input.maxBytes,
        signal,
      }),
  });
}

/** Perform a sandbox request whose successful response body is intentionally ignored. */
export async function requestSandboxVoid(input: {
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  operation: string;
}): Promise<void> {
  await requestSandboxResponse({
    ...input,
    consume: (response) => {
      cancelResponseBody(response);
      return Promise.resolve();
    },
  });
}

/**
 * Start a sandbox streaming request.
 *
 * The deadline covers response headers and bounded HTTP error bodies. A
 * successful stream remains open until its consumer finishes or cancels it.
 */
export async function requestSandboxStream(input: {
  url: string;
  init?: RequestInit;
  timeoutMs: number;
  operation: string;
}): Promise<Response> {
  return await requestSandboxResponse({
    ...input,
    consume: (response) => Promise.resolve(response),
  });
}

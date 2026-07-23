/**
 * Fetches project environment variables from the Veryfront API.
 *
 * @module server/project-env/fetcher
 */

import { NETWORK_ERROR, TIMEOUT_ERROR, VeryfrontError } from "#veryfront/errors";
import { getBaseLogger } from "#veryfront/utils";

const logger = getBaseLogger("PROJECT-ENV").component("project-env");

/** Max env vars per request. API enforces a hard cap of 100. */
const ENV_VARS_FETCH_LIMIT = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1_024;
const MAX_CONFIGURED_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const MAX_API_BASE_URL_LENGTH = 2_048;
const MAX_PROJECT_SLUG_LENGTH = 512;
const MAX_ENVIRONMENT_ID_LENGTH = 512;
const MAX_TOKEN_LENGTH = 64 * 1_024;
const MAX_ENV_KEY_LENGTH = 256;
const MAX_ENV_VALUE_LENGTH = 256 * 1_024;
const MAX_CONSECUTIVE_EMPTY_CHUNKS = 100;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UNSAFE_ENV_KEYS = new Set(["__proto__", "constructor", "prototype"]);

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchProjectEnvVarsOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Injectable transport for runtime adapters and deterministic tests. */
  readonly fetchImpl?: FetchImplementation;
}

class InvalidEnvironmentResponseError extends Error {
  constructor(readonly category: string) {
    super("Invalid project environment variable response");
    this.name = "InvalidEnvironmentResponseError";
  }
}

function assertBoundedNonEmptyString(value: string, name: string, maxLength: number): void {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${name} must be a bounded non-empty string`);
  }
}

function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function buildEnvironmentVariablesUrl(
  apiBaseUrl: string,
  projectSlug: string,
  environmentId: string,
): URL {
  assertBoundedNonEmptyString(apiBaseUrl, "apiBaseUrl", MAX_API_BASE_URL_LENGTH);
  assertBoundedNonEmptyString(projectSlug, "projectSlug", MAX_PROJECT_SLUG_LENGTH);
  assertBoundedNonEmptyString(environmentId, "environmentId", MAX_ENVIRONMENT_ID_LENGTH);

  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    throw new TypeError("apiBaseUrl must be a valid HTTP URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password ||
    url.search || url.hash
  ) {
    throw new TypeError("apiBaseUrl must be an HTTP URL without credentials, query, or fragment");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/projects/${
    encodeURIComponent(projectSlug)
  }/environment-variables`;
  url.searchParams.set("environment_id", environmentId);
  url.searchParams.set("limit", String(ENV_VARS_FETCH_LIMIT));
  return url;
}

function isJsonContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  try {
    void body?.cancel().catch(() => {});
  } catch {
    // Cancellation is best effort and must not replace the request error.
  }
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    void reader.cancel().catch(() => {});
  } catch {
    // Cancellation is best effort and must not replace the request error.
  }
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const lengthHeader = response.headers.get("content-length");
  if (
    lengthHeader !== null && /^\d+$/.test(lengthHeader) &&
    Number(lengthHeader) > maxBytes
  ) {
    cancelBody(response.body);
    throw new InvalidEnvironmentResponseError("response-too-large");
  }
  if (response.body === null) {
    throw new InvalidEnvironmentResponseError("missing-body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  let completed = false;
  let consecutiveEmptyChunks = 0;
  let rejectForAbort: ((reason: unknown) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const abortRead = (): void => rejectForAbort?.(signal.reason);
  signal.addEventListener("abort", abortRead, { once: true });

  try {
    if (signal.aborted) throw signal.reason;
    while (true) {
      const result = await Promise.race([reader.read(), abortPromise]);
      if (result.done) {
        completed = true;
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw new InvalidEnvironmentResponseError("invalid-body-chunk");
      }
      if (result.value.byteLength === 0) {
        consecutiveEmptyChunks++;
        if (consecutiveEmptyChunks >= MAX_CONSECUTIVE_EMPTY_CHUNKS) {
          throw new InvalidEnvironmentResponseError("body-made-no-progress");
        }
        continue;
      }
      consecutiveEmptyChunks = 0;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        throw new InvalidEnvironmentResponseError("response-too-large");
      }
      text += decoder.decode(result.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (!completed) cancelReader(reader);
    throw error;
  } finally {
    signal.removeEventListener("abort", abortRead);
    try {
      reader.releaseLock();
    } catch {
      // A pending read can retain the lock until cancellation settles.
    }
  }
}

function parseEnvironmentVariables(text: string): Record<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InvalidEnvironmentResponseError("invalid-json");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InvalidEnvironmentResponseError("invalid-envelope");
  }
  const data = (value as { data?: unknown }).data;
  if (!Array.isArray(data) || data.length > ENV_VARS_FETCH_LIMIT) {
    throw new InvalidEnvironmentResponseError("invalid-data");
  }

  const result: Record<string, string> = {};
  const seen = new Set<string>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new InvalidEnvironmentResponseError("invalid-entry");
    }
    const key = (entry as { key?: unknown }).key;
    const entryValue = (entry as { value?: unknown }).value;
    if (
      typeof key !== "string" || key.length > MAX_ENV_KEY_LENGTH ||
      !ENV_KEY_PATTERN.test(key) || UNSAFE_ENV_KEYS.has(key) ||
      typeof entryValue !== "string" ||
      entryValue.length > MAX_ENV_VALUE_LENGTH || seen.has(key)
    ) {
      throw new InvalidEnvironmentResponseError("invalid-entry");
    }
    seen.add(key);
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: entryValue,
      writable: true,
    });
  }
  return result;
}

function requestError(detail: string): VeryfrontError {
  return NETWORK_ERROR.create({ detail });
}

/**
 * Fetch environment variables for a project from the Veryfront API.
 *
 * Calls GET /projects/{projectSlug}/environment-variables with an environment ID.
 */
export async function fetchProjectEnvVars(
  apiBaseUrl: string,
  projectSlug: string,
  environmentId: string,
  token: string,
  options: FetchProjectEnvVarsOptions = {},
): Promise<Record<string, string>> {
  assertBoundedNonEmptyString(token, "token", MAX_TOKEN_LENGTH);
  const url = buildEnvironmentVariablesUrl(apiBaseUrl, projectSlug, environmentId);
  const timeoutMs = resolvePositiveInteger(
    options.timeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,
    "Project environment request timeout",
  );
  const maxResponseBytes = resolvePositiveInteger(
    options.maxResponseBytes,
    DEFAULT_MAX_RESPONSE_BYTES,
    MAX_CONFIGURED_RESPONSE_BYTES,
    "Project environment maximum response size",
  );

  const timeoutController = new AbortController();
  const timeout = setTimeout(
    () => timeoutController.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeoutController.signal])
    : timeoutController.signal;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  try {
    if (options.signal?.aborted) {
      throw requestError("Project environment variable request was cancelled");
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        redirect: "error",
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw requestError("Project environment variable request was cancelled");
      }
      if (timeoutController.signal.aborted) {
        throw TIMEOUT_ERROR.create({ detail: "Project environment variable request timed out" });
      }
      logger.warn("Project environment variable request failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw requestError("Project environment variable request failed");
    }

    if (!response.ok) {
      cancelBody(response.body);
      logger.warn("Project environment variable request was rejected", {
        status: response.status,
      });
      throw requestError(
        `Project environment variable request failed with status ${response.status}`,
      );
    }
    if (!isJsonContentType(response.headers.get("content-type"))) {
      cancelBody(response.body);
      throw new InvalidEnvironmentResponseError("invalid-content-type");
    }

    const text = await readBoundedResponseText(response, maxResponseBytes, signal);
    const result = parseEnvironmentVariables(text);
    logger.debug("Fetched project environment variables", { count: Object.keys(result).length });
    return result;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    if (options.signal?.aborted) {
      throw requestError("Project environment variable request was cancelled");
    }
    if (timeoutController.signal.aborted) {
      throw TIMEOUT_ERROR.create({ detail: "Project environment variable request timed out" });
    }
    logger.warn("Project environment variable response was invalid", {
      failureCategory: error instanceof InvalidEnvironmentResponseError
        ? error.category
        : "response-read-error",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw requestError("Project environment variable response was invalid");
  } finally {
    clearTimeout(timeout);
  }
}

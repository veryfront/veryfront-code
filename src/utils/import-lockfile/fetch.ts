import { VeryfrontError } from "#veryfront/errors/types.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors/error-registry/general.ts";
import { CACHE_ERROR, NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { unrefTimer } from "#veryfront/platform/compat/process.ts";
import { computeIntegrity } from "./integrity.ts";
import { lockfileLogger as logger } from "./logger.ts";
import type {
  FetchWithLockOptions,
  FetchWithLockResult,
  LockfileEntry,
  LockfileManager,
} from "./types.ts";
import {
  invalidArgument,
  isRecord,
  snapshotUrlArgument,
  validateEntry,
  validateRemoteUrl,
} from "./validation.ts";
import { VERSION } from "../version-constant.ts";

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const MAX_CONFIGURED_RESPONSE_BYTES = 100 * 1024 * 1024;
const USER_AGENT_HEADERS = Object.freeze({ "user-agent": `Veryfront/${VERSION}` });

class ResponseTooLargeError extends Error {}
class RequestTimedOutError extends Error {}
class RequestCancelledError extends Error {}

interface FetchWithLockSnapshot {
  lockfile: Pick<LockfileManager, "get" | "set" | "flush">;
  url: string;
  fetchFn: typeof fetch;
  strict: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  signal?: AbortSignalSnapshot;
}

interface TimedRemoteResponse {
  response: Response;
  deadline: number;
}

interface AbortSignalSnapshot {
  isAborted(): boolean;
  addAbortListener(listener: () => void): void;
  removeAbortListener(listener: () => void): void;
}

function cancelBodyWithoutWaiting(
  body:
    | Pick<ReadableStream<Uint8Array>, "cancel">
    | Pick<ReadableStreamDefaultReader<Uint8Array>, "cancel">
    | null
    | undefined,
): void {
  if (!body) return;
  try {
    void Promise.resolve(body.cancel()).catch(() => undefined);
  } catch {
    // Cleanup must not replace or delay the request outcome.
  }
}

function snapshotAbortSignal(value: unknown): AbortSignalSnapshot {
  if (typeof value !== "object" || value === null) {
    throw invalidArgument("signal must be an AbortSignal");
  }
  let addEventListener: unknown;
  let removeEventListener: unknown;
  try {
    addEventListener = Reflect.get(value, "addEventListener");
    removeEventListener = Reflect.get(value, "removeEventListener");
    if (
      typeof Reflect.get(value, "aborted") !== "boolean" ||
      typeof addEventListener !== "function" ||
      typeof removeEventListener !== "function"
    ) {
      throw new TypeError("Invalid AbortSignal");
    }
  } catch {
    throw invalidArgument("signal must be an AbortSignal");
  }

  return Object.freeze({
    isAborted(): boolean {
      try {
        const aborted = Reflect.get(value, "aborted");
        if (typeof aborted !== "boolean") throw new TypeError("Invalid AbortSignal");
        return aborted;
      } catch {
        throw invalidArgument("signal must be an AbortSignal");
      }
    },
    addAbortListener(listener: () => void): void {
      try {
        Reflect.apply(addEventListener, value, ["abort", listener, { once: true }]);
      } catch {
        throw invalidArgument("signal must be an AbortSignal");
      }
    },
    removeAbortListener(listener: () => void): void {
      try {
        Reflect.apply(removeEventListener, value, ["abort", listener]);
      } catch {
        // Cleanup must not replace the request outcome.
      }
    },
  });
}

function snapshotLockfileManager(
  value: unknown,
): Pick<LockfileManager, "get" | "set" | "flush"> {
  if (typeof value !== "object" || value === null) {
    throw invalidArgument("A lockfile manager is required");
  }

  try {
    const get = Reflect.get(value, "get");
    const set = Reflect.get(value, "set");
    const flush = Reflect.get(value, "flush");
    if (typeof get !== "function" || typeof set !== "function" || typeof flush !== "function") {
      throw new TypeError("Invalid lockfile manager");
    }
    return Object.freeze({
      get: (url: string) => Reflect.apply(get, value, [url]) as Promise<LockfileEntry | null>,
      set: (url: string, entry: LockfileEntry) =>
        Reflect.apply(set, value, [url, entry]) as Promise<void>,
      flush: () => Reflect.apply(flush, value, []) as Promise<void>,
    });
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw invalidArgument("The lockfile manager is invalid");
  }
}

function snapshotFetchOptions(options: FetchWithLockOptions): FetchWithLockSnapshot {
  try {
    if (!isRecord(options)) throw invalidArgument("Fetch options must be an object");
    const lockfileOption: unknown = options.lockfile;
    const urlOption: unknown = options.url;
    const fetchOption: unknown = options.fetchFn;
    const strictOption: unknown = options.strict;
    const timeoutOption: unknown = options.timeoutMs;
    const maxResponseBytesOption: unknown = options.maxResponseBytes;
    const signalOption: unknown = options.signal;

    const lockfile = snapshotLockfileManager(lockfileOption);
    const url = snapshotUrlArgument(urlOption as string);
    const fetchFn = fetchOption ?? fetch;
    if (typeof fetchFn !== "function") throw invalidArgument("fetchFn must be a function");
    if (strictOption !== undefined && typeof strictOption !== "boolean") {
      throw invalidArgument("strict must be a boolean");
    }
    const timeoutMs = timeoutOption ?? DEFAULT_FETCH_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1 ||
      (timeoutMs as number) > MAX_FETCH_TIMEOUT_MS
    ) {
      throw invalidArgument("timeoutMs must be a supported positive integer");
    }
    const maxResponseBytes = maxResponseBytesOption ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(maxResponseBytes) || (maxResponseBytes as number) < 1 ||
      (maxResponseBytes as number) > MAX_CONFIGURED_RESPONSE_BYTES
    ) {
      throw invalidArgument("maxResponseBytes must be a supported positive integer");
    }
    const signal = signalOption === undefined ? undefined : snapshotAbortSignal(signalOption);
    return {
      lockfile,
      url,
      fetchFn: fetchFn as typeof fetch,
      strict: strictOption as boolean | undefined ?? false,
      timeoutMs: timeoutMs as number,
      maxResponseBytes: maxResponseBytes as number,
      ...(signal ? { signal } : {}),
    };
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw invalidArgument("Fetch options are invalid");
  }
}

function networkError(message: string): VeryfrontError {
  return NETWORK_ERROR.create({ message, detail: message });
}

function timeoutError(): VeryfrontError {
  const message = "The remote import request timed out";
  return TIMEOUT_ERROR.create({ message, detail: message });
}

async function requestRemoteImport(
  url: string,
  snapshot: FetchWithLockSnapshot,
  redirect: RequestRedirect | undefined,
): Promise<TimedRemoteResponse> {
  const deadline = Date.now() + snapshot.timeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  let abortListenerAttached = false;
  let abortRaceActive = false;
  let rejectForAbort: ((reason: Error) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const abortRequest = (): void => {
    cancelled = true;
    controller.abort();
    if (abortRaceActive) rejectForAbort?.(new RequestCancelledError());
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectForAbort?.(new RequestTimedOutError());
  }, snapshot.timeoutMs);
  unrefTimer(timeout as ReturnType<typeof setInterval>);

  try {
    if (snapshot.signal?.isAborted()) abortRequest();
    else if (snapshot.signal) {
      snapshot.signal.addAbortListener(abortRequest);
      abortListenerAttached = true;
      if (snapshot.signal.isAborted()) abortRequest();
    }
    if (cancelled) throw new RequestCancelledError();

    abortRaceActive = true;
    const response = await Promise.race([
      Promise.resolve().then(() =>
        snapshot.fetchFn(url, {
          headers: USER_AGENT_HEADERS,
          ...(redirect ? { redirect } : {}),
          signal: controller.signal,
        })
      ),
      abortPromise,
    ]);
    if (typeof response !== "object" || response === null) {
      throw new TypeError("Invalid fetch response");
    }
    return { response, deadline };
  } catch (error) {
    if (timedOut || error instanceof RequestTimedOutError) throw timeoutError();
    if (cancelled || error instanceof RequestCancelledError) {
      throw networkError("The remote import request was cancelled");
    }
    if (error instanceof VeryfrontError) throw error;
    throw networkError("The remote import request failed");
  } finally {
    abortRaceActive = false;
    clearTimeout(timeout);
    if (abortListenerAttached) snapshot.signal?.removeAbortListener(abortRequest);
  }
}

async function readResponseText(
  response: Response,
  maxBytes: number,
  deadline: number,
  signal: AbortSignalSnapshot | undefined,
): Promise<string> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timedOut = false;
  let cancelled = false;
  let abortListenerAttached = false;
  let abortRaceActive = false;
  let rejectForAbort: ((reason: Error) => void) | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject;
  });
  const cancelRead = (): void => {
    cancelled = true;
    if (abortRaceActive) rejectForAbort?.(new RequestCancelledError());
  };
  const remainingMs = deadline - Date.now();
  const timeout = setTimeout(() => {
    timedOut = true;
    rejectForAbort?.(new RequestTimedOutError());
  }, Math.max(0, remainingMs));
  unrefTimer(timeout as ReturnType<typeof setInterval>);

  try {
    if (signal?.isAborted()) cancelRead();
    else if (signal) {
      signal.addAbortListener(cancelRead);
      abortListenerAttached = true;
      if (signal.isAborted()) cancelRead();
    }
    if (cancelled) throw new RequestCancelledError();
    if (remainingMs <= 0) throw new RequestTimedOutError();
    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader && /^\d+$/.test(lengthHeader) && Number(lengthHeader) > maxBytes) {
      cancelBodyWithoutWaiting(response.body);
      throw new ResponseTooLargeError();
    }

    if (response.body === null) return "";
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new TypeError("Invalid response body");
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let content = "";
    abortRaceActive = true;
    while (true) {
      const result = await Promise.race([reader.read(), abortPromise]);
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) throw new TypeError("Invalid response chunk");
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        cancelBodyWithoutWaiting(reader);
        throw new ResponseTooLargeError();
      }
      content += decoder.decode(result.value, { stream: true });
    }
    return content + decoder.decode();
  } catch (error) {
    if (timedOut || error instanceof RequestTimedOutError) {
      cancelBodyWithoutWaiting(reader);
      throw timeoutError();
    }
    if (cancelled || error instanceof RequestCancelledError) {
      cancelBodyWithoutWaiting(reader);
      throw networkError("The remote import request was cancelled");
    }
    if (error instanceof ResponseTooLargeError) {
      throw networkError("The remote import response is too large");
    }
    if (error instanceof VeryfrontError) throw error;
    throw networkError("The remote import response could not be read");
  } finally {
    abortRaceActive = false;
    clearTimeout(timeout);
    if (abortListenerAttached) signal?.removeAbortListener(cancelRead);
  }
}

function readResponseStatus(response: Response): { ok: boolean; status: number } {
  try {
    const ok = response.ok;
    const status = response.status;
    if (typeof ok !== "boolean" || !Number.isInteger(status) || status < 0 || status > 599) {
      throw new TypeError("Invalid response status");
    }
    return { ok, status };
  } catch {
    throw networkError("The remote import response is invalid");
  }
}

function readResolvedUrl(response: Response, fallbackUrl: string): string {
  let candidate: unknown;
  try {
    candidate = response.url;
  } catch {
    throw networkError("The remote import response URL is invalid");
  }
  if (candidate === "") return fallbackUrl;
  try {
    return validateRemoteUrl(candidate);
  } catch {
    throw networkError("The remote import response URL is invalid");
  }
}

async function callLockfile<T>(
  lockfile: Pick<LockfileManager, "get" | "set" | "flush">,
  methodName: "get" | "set" | "flush",
  args: unknown[],
): Promise<T> {
  let method: unknown;
  try {
    method = Reflect.get(lockfile, methodName);
  } catch {
    throw invalidArgument("The lockfile manager is invalid");
  }
  if (typeof method !== "function") throw invalidArgument("The lockfile manager is invalid");
  try {
    return await Reflect.apply(method, lockfile, args) as T;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    const message = "The import lockfile operation failed";
    throw CACHE_ERROR.create({ message, detail: message });
  }
}

function validateCachedEntry(value: unknown): LockfileEntry | null {
  if (value === null) return null;
  try {
    return validateEntry(value);
  } catch {
    const message = "The cached import entry is invalid";
    throw CACHE_ERROR.create({ message, detail: message });
  }
}

export async function fetchWithLock(options: FetchWithLockOptions): Promise<FetchWithLockResult> {
  const snapshot = snapshotFetchOptions(options);
  const { lockfile, url, strict } = snapshot;
  const entry = validateCachedEntry(
    await callLockfile<LockfileEntry | null>(lockfile, "get", [url]),
  );

  if (entry) {
    logger.debug("Import lockfile cache hit");
    try {
      const remote = await requestRemoteImport(entry.resolved, snapshot, undefined);
      const { response } = remote;
      try {
        const resolvedUrl = readResolvedUrl(response, entry.resolved);
        if (resolvedUrl !== entry.resolved) {
          const message = "The cached import redirect target changed";
          throw CACHE_ERROR.create({ message, detail: message });
        }
        const { ok, status } = readResponseStatus(response);
        if (!ok) {
          cancelBodyWithoutWaiting(response.body);
          if (strict) {
            const message = `The cached import request failed with status ${status}`;
            throw CACHE_ERROR.create({ message, detail: message });
          }
          logger.warn("Cached import request failed, fetching the original URL", { status });
        } else {
          const content = await readResponseText(
            response,
            snapshot.maxResponseBytes,
            remote.deadline,
            snapshot.signal,
          );
          const currentIntegrity = await computeIntegrity(content);
          if (currentIntegrity === entry.integrity) {
            return {
              content,
              resolvedUrl: entry.resolved,
              fromCache: true,
              integrity: entry.integrity,
            };
          }
          if (strict) {
            const message = "The cached import integrity does not match the lockfile";
            throw CACHE_ERROR.create({ message, detail: message });
          }
          logger.warn("Cached import integrity changed, fetching the original URL");
        }
      } catch (error) {
        cancelBodyWithoutWaiting(response.body);
        throw error;
      }
    } catch (error) {
      if (
        strict ||
        (error instanceof VeryfrontError && error.slug === "timeout-error") ||
        snapshot.signal?.isAborted()
      ) {
        throw error;
      }
      logger.warn("Cached import request failed, fetching the original URL");
    }
  }

  logger.debug("Fetching remote import");
  const remote = await requestRemoteImport(url, snapshot, "follow");
  const { response } = remote;
  let status: { ok: boolean; status: number };
  try {
    status = readResponseStatus(response);
  } catch (error) {
    cancelBodyWithoutWaiting(response.body);
    throw error;
  }
  if (!status.ok) {
    cancelBodyWithoutWaiting(response.body);
    throw networkError(`The remote import request failed with status ${status.status}`);
  }
  const content = await readResponseText(
    response,
    snapshot.maxResponseBytes,
    remote.deadline,
    snapshot.signal,
  );
  const resolvedUrl = readResolvedUrl(response, url);
  const integrity = await computeIntegrity(content);

  await callLockfile<void>(lockfile, "set", [
    url,
    { resolved: resolvedUrl, integrity, fetchedAt: new Date().toISOString() },
  ]);
  await callLockfile<void>(lockfile, "flush", []);

  return { content, resolvedUrl, fromCache: false, integrity };
}

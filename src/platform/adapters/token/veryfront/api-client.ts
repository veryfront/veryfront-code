import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { TOKEN_STORAGE_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { injectContext } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import {
  createTokenConfig,
  type TokenStorageRequestOptions,
  type VeryfrontTokenConfig,
} from "./types.ts";

const logger = baseLogger.component("token-storage-api-client");
const HTTP_DATE_PATTERNS = [
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/,
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/,
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/,
] as const;

type TokenOperation = "get" | "set" | "delete" | "list";
type RetryReason = "http" | "network" | "timeout";

export interface TokenStorageApiClientDependencies {
  /** HTTP transport override for compatible runtimes and focused tests. */
  fetch?: typeof globalThis.fetch;
  /** Retry delay override for compatible runtimes and focused tests. */
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  /** Clock override used to interpret HTTP-date Retry-After values. */
  now?: () => number;
}

interface RetryFailure {
  reason: RetryReason;
  status?: number;
}

type AttemptResult = { response: Response } | { failure: RetryFailure };

export class TokenStorageApiClient {
  private readonly config: ReturnType<typeof createTokenConfig>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleepImpl: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private readonly ownedErrors = new WeakSet<VeryfrontError>();

  constructor(
    config: VeryfrontTokenConfig,
    dependencies: TokenStorageApiClientDependencies = {},
  ) {
    this.config = createTokenConfig({ type: "veryfront-api", veryfront: config });
    const resolvedDependencies = resolveDependencies(dependencies);
    this.fetchImpl = resolvedDependencies.fetch ?? globalThis.fetch;
    this.sleepImpl = resolvedDependencies.sleep ?? sleepWithSignal;
    this.now = resolvedDependencies.now ?? Date.now;
  }

  async get(key: string, options: TokenStorageRequestOptions = {}): Promise<string | null> {
    try {
      const response = await this.fetchWithRetry(
        this.buildTokenUrl(key),
        { method: "GET", headers: this.buildHeaders() },
        options.signal,
      );

      if (response.status === 404) {
        await this.discardResponseBody(response, "get");
        return null;
      }
      if (!response.ok) {
        await this.discardResponseBody(response, "get");
        throw this.operationError("get", response.status);
      }

      const data = await this.readJson(response, "get");
      if (!isRecord(data) || typeof data.value !== "string") {
        throw this.invalidResponse("get");
      }
      return data.value;
    } catch (error) {
      throw this.wrapError(error, "get");
    }
  }

  async set(
    key: string,
    value: string,
    options: TokenStorageRequestOptions = {},
  ): Promise<void> {
    try {
      if (typeof value !== "string") {
        throw this.tokenError("Token storage value must be a string", 400);
      }
      const response = await this.fetchWithRetry(
        this.buildTokenUrl(key),
        {
          method: "PUT",
          headers: {
            ...this.buildHeaders(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value }),
        },
        options.signal,
      );

      await this.discardResponseBody(response, "set");
      if (!response.ok) throw this.operationError("set", response.status);
    } catch (error) {
      throw this.wrapError(error, "set");
    }
  }

  async delete(key: string, options: TokenStorageRequestOptions = {}): Promise<void> {
    try {
      const response = await this.fetchWithRetry(
        this.buildTokenUrl(key),
        { method: "DELETE", headers: this.buildHeaders() },
        options.signal,
      );

      await this.discardResponseBody(response, "delete");
      if (!response.ok && response.status !== 404) {
        throw this.operationError("delete", response.status);
      }
    } catch (error) {
      throw this.wrapError(error, "delete");
    }
  }

  async list(
    prefix?: string,
    options: TokenStorageRequestOptions = {},
  ): Promise<string[]> {
    try {
      if (prefix !== undefined && typeof prefix !== "string") {
        throw this.tokenError("Token storage prefix must be a string", 400);
      }
      const url = this.buildCollectionUrl();
      if (prefix) url.searchParams.set("prefix", prefix);

      const response = await this.fetchWithRetry(
        url,
        { method: "GET", headers: this.buildHeaders() },
        options.signal,
      );

      if (!response.ok) {
        await this.discardResponseBody(response, "list");
        throw this.operationError("list", response.status);
      }

      const data = await this.readJson(response, "list");
      if (!isRecord(data) || data.keys !== undefined && !isStringArray(data.keys)) {
        throw this.invalidResponse("list");
      }
      return data.keys as string[] | undefined ?? [];
    } catch (error) {
      throw this.wrapError(error, "list");
    }
  }

  async ping(options: TokenStorageRequestOptions = {}): Promise<boolean> {
    try {
      await this.list(undefined, options);
      return true;
    } catch {
      return false;
    }
  }

  private buildCollectionUrl(): URL {
    const baseUrl = new URL(`${this.config.apiBaseUrl}/`);
    const path = [
      "v1",
      "projects",
      encodeURIComponent(this.config.projectSlug),
      "tokens",
    ].join("/");
    return new URL(path, baseUrl);
  }

  private buildTokenUrl(key: string): URL {
    if (typeof key !== "string" || key.trim().length === 0) {
      throw this.tokenError("Token storage key must be a non-empty string", 400);
    }
    return new URL(`${this.buildCollectionUrl().toString()}/${encodeURIComponent(key)}`);
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiToken}`,
      Accept: "application/json",
    };
  }

  private operationError(operation: TokenOperation, status: number): VeryfrontError {
    return this.tokenError(`Token storage ${operation} request failed`, status);
  }

  private invalidResponse(operation: "get" | "list"): VeryfrontError {
    return this.tokenError(`Token storage ${operation} response was invalid`, 502);
  }

  private async readJson(response: Response, operation: "get" | "list"): Promise<unknown> {
    let text: string;
    try {
      text = await response.text();
    } catch {
      await this.discardResponseBody(response, operation);
      throw this.invalidResponse(operation);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw this.invalidResponse(operation);
    }
  }

  private async discardResponseBody(
    response: Response,
    operation: TokenOperation | "retry",
  ): Promise<void> {
    if (!response.body || response.bodyUsed) return;

    try {
      await response.body.cancel();
    } catch {
      logger.debug("Token storage response cleanup failed", {
        operation,
        status: response.status,
      });
    }
  }

  private wrapError(error: unknown, operation: TokenOperation): VeryfrontError {
    if (error instanceof VeryfrontError && this.ownedErrors.has(error)) {
      return error;
    }

    logger.error("Token storage operation failed", { operation });
    return this.tokenError(`Token storage ${operation} request failed`, 502);
  }

  private async fetchWithRetry(
    url: URL,
    init: RequestInit,
    callerSignal?: AbortSignal,
  ): Promise<Response> {
    const { maxRetries } = this.config.retry;
    const totalAttempts = maxRetries + 1;
    let lastFailure: RetryFailure = { reason: "network" };

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      const result = await this.performAttempt(url, init, callerSignal);
      if ("failure" in result) {
        lastFailure = result.failure;
        if (attempt >= totalAttempts) break;
        const delay = this.exponentialDelay(attempt);
        this.logRetry(attempt, delay, lastFailure);
        await this.waitForRetry(delay, callerSignal);
        continue;
      }

      const response = result.response;
      if (!this.isRetryableStatus(response.status) || attempt >= totalAttempts) {
        return response;
      }

      lastFailure = { reason: "http", status: response.status };
      const delay = this.retryDelay(response, attempt);
      await this.discardResponseBody(response, "retry");
      this.throwIfCallerCancelled(callerSignal);
      this.logRetry(attempt, delay, lastFailure);
      await this.waitForRetry(delay, callerSignal);
    }

    if (lastFailure.reason === "timeout") {
      throw this.tokenError(
        `Token storage request timed out after ${totalAttempts} attempts`,
        504,
      );
    }

    throw this.tokenError(
      `Token storage request failed after ${totalAttempts} attempts`,
      lastFailure.status ?? 502,
    );
  }

  private async performAttempt(
    url: URL,
    init: RequestInit,
    callerSignal?: AbortSignal,
  ): Promise<AttemptResult> {
    this.throwIfCallerCancelled(callerSignal);

    const controller = new AbortController();
    let timedOut = false;
    let cancelledByCaller = false;
    let rejectForAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectForAbort = () => reject(new Error("Token storage request interrupted"));
      controller.signal.addEventListener("abort", rejectForAbort, { once: true });
    });
    const abortForCaller = () => {
      cancelledByCaller = true;
      controller.abort();
    };
    callerSignal?.addEventListener("abort", abortForCaller, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);

    const request = Promise.resolve().then(() => {
      const headers = new Headers(init.headers);
      injectContext(headers);
      return this.fetchImpl(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
    });

    try {
      const response = await Promise.race([request, aborted]);
      if (callerSignal?.aborted) {
        await this.discardResponseBody(response, "retry");
        throw this.cancelledError();
      }
      return { response };
    } catch {
      if (controller.signal.aborted) this.cleanupLateResponse(request);
      if (cancelledByCaller || callerSignal?.aborted) throw this.cancelledError();
      return { failure: { reason: timedOut ? "timeout" : "network" } };
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortForCaller);
      if (rejectForAbort) controller.signal.removeEventListener("abort", rejectForAbort);
    }
  }

  private cleanupLateResponse(request: Promise<Response>): void {
    void request.then(
      (response) => this.discardResponseBody(response, "retry"),
      () => {
        logger.debug("Token storage request ended after cancellation");
      },
    );
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  private retryDelay(response: Response, attempt: number): number {
    const retryAfter = this.parseRetryAfter(response.headers.get("Retry-After"));
    return retryAfter ?? this.exponentialDelay(attempt);
  }

  private parseRetryAfter(value: string | null): number | null {
    if (value === null) return null;

    let delay: number;
    if (/^\d+$/.test(value)) {
      delay = Number(value) * 1_000;
    } else {
      if (!isHttpDate(value)) return null;
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp)) return null;
      delay = timestamp - this.now();
    }

    if (!Number.isFinite(delay)) return this.config.retry.maxDelay;
    return Math.min(Math.max(0, delay), this.config.retry.maxDelay);
  }

  private exponentialDelay(attempt: number): number {
    return Math.min(
      this.config.retry.initialDelay * 2 ** (attempt - 1),
      this.config.retry.maxDelay,
    );
  }

  private logRetry(attempt: number, delay: number, failure: RetryFailure): void {
    logger.warn("Token storage request failed; retrying", {
      attempt,
      maxRetries: this.config.retry.maxRetries,
      delay,
      reason: failure.reason,
      status: failure.status,
    });
  }

  private async waitForRetry(delay: number, callerSignal?: AbortSignal): Promise<void> {
    this.throwIfCallerCancelled(callerSignal);
    const sleeping = this.sleepImpl(delay, callerSignal);
    if (!callerSignal) {
      await sleeping;
      return;
    }

    let abortWait: (() => void) | undefined;
    const cancelled = new Promise<never>((_resolve, reject) => {
      abortWait = () => reject(this.cancelledError());
      callerSignal.addEventListener("abort", abortWait, { once: true });
    });

    try {
      await Promise.race([sleeping, cancelled]);
      this.throwIfCallerCancelled(callerSignal);
    } catch (error) {
      if (callerSignal.aborted) throw this.cancelledError();
      throw error;
    } finally {
      if (abortWait) callerSignal.removeEventListener("abort", abortWait);
    }
  }

  private throwIfCallerCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw this.cancelledError();
  }

  private cancelledError(): VeryfrontError {
    return this.tokenError("Token storage request was cancelled", 499);
  }

  private tokenError(detail: string, status: number): VeryfrontError {
    const error = TOKEN_STORAGE_ERROR.create({ detail, status });
    this.ownedErrors.add(error);
    return error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isHttpDate(value: string): boolean {
  return HTTP_DATE_PATTERNS.some((pattern) => pattern.test(value));
}

function sleepWithSignal(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const complete = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", complete);
      resolve();
    };
    const timeoutId = setTimeout(complete, delayMs);
    signal?.addEventListener("abort", complete, { once: true });
    if (signal?.aborted) complete();
  });
}

function resolveDependencies(
  dependencies: TokenStorageApiClientDependencies,
): TokenStorageApiClientDependencies {
  if (
    typeof dependencies !== "object" || dependencies === null || Array.isArray(dependencies)
  ) {
    throw CONFIG_INVALID.create({
      detail: "Token storage API client dependencies must be an object",
    });
  }

  let fetchImpl: unknown;
  let sleepImpl: unknown;
  let now: unknown;
  try {
    fetchImpl = dependencies.fetch;
    sleepImpl = dependencies.sleep;
    now = dependencies.now;
  } catch {
    throw CONFIG_INVALID.create({
      detail: "Token storage API client dependencies must be readable",
    });
  }

  if (fetchImpl !== undefined && typeof fetchImpl !== "function") {
    throw CONFIG_INVALID.create({
      detail: "Token storage API client fetch dependency must be a function",
    });
  }
  if (sleepImpl !== undefined && typeof sleepImpl !== "function") {
    throw CONFIG_INVALID.create({
      detail: "Token storage API client sleep dependency must be a function",
    });
  }
  if (now !== undefined && typeof now !== "function") {
    throw CONFIG_INVALID.create({
      detail: "Token storage API client clock dependency must be a function",
    });
  }

  return Object.freeze({
    fetch: fetchImpl as typeof globalThis.fetch | undefined,
    sleep: sleepImpl as TokenStorageApiClientDependencies["sleep"],
    now: now as (() => number) | undefined,
  });
}

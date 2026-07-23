import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { FILE_NOT_FOUND, TIMEOUT_ERROR } from "#veryfront/errors/error-registry/general.ts";
import { NETWORK_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { createGitHubConfig, type ResolvedGitHubConfig } from "./types.ts";
import { normalizeGitHubPath } from "./path-utils.ts";
import {
  getGitHubBlobResponseSchema,
  getGitHubContentsResponseSchema,
  getGitHubTreeResponseSchema,
  type GitHubBlobResponse,
  type GitHubContentItem,
  type GitHubTreeEntry,
  type GitHubTreeResponse,
} from "./schemas/index.ts";

const LOG_PREFIX = "[GitHubApiClient]";
const RATE_LIMIT_WARNING_THRESHOLD = 100;
const RETRY_JITTER_MAX_MS = 1_000;
const COMPLETE_TREE_CONCURRENCY = 8;

export interface GitHubRateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
}

type APIError = Error & {
  statusCode?: number;
  retryAfterMs?: number;
  rateLimitResetMs?: number;
  rateLimited?: boolean;
};

export interface GitHubApiClientDependencies {
  fetch?: typeof globalThis.fetch;
  sleep?: (delay: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
  monotonicNow?: () => number;
}

export interface GitHubRequestOptions {
  /** Cancel this GitHub operation, including subtree requests and retry delays. */
  readonly signal?: AbortSignal;
}

interface RequestContext {
  readonly signal?: AbortSignal;
  readonly internalSignal?: AbortSignal;
  readonly deadline: number;
}

interface ResolvedDependencies {
  readonly fetch: typeof globalThis.fetch;
  readonly sleep: (delay: number) => Promise<void>;
  readonly random: () => number;
  readonly now: () => number;
  readonly monotonicNow: () => number;
}

const nonRetryableErrors = new WeakSet<Error>();
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;

function invalidClientInput(detail: string): never {
  const error = CONFIG_INVALID.create({ detail });
  nonRetryableErrors.add(error);
  throw error;
}

function assertReadableObject(value: unknown, label: string): asserts value is object {
  if (typeof value !== "object" || value === null) invalidClientInput(`${label} must be an object`);

  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalidClientInput(`${label} are not readable`);
  }
  if (isArray) invalidClientInput(`${label} must be an object`);
}

function readProperty(value: object, property: PropertyKey, label: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    invalidClientInput(`${label} are not readable`);
  }
}

function isSignalAborted(signal: AbortSignal): boolean {
  if (!abortSignalAbortedGetter) invalidClientInput("AbortSignal support is unavailable");
  try {
    return Boolean(abortSignalAbortedGetter.call(signal));
  } catch {
    invalidClientInput("GitHub request signal is invalid");
  }
}

function addAbortListener(signal: AbortSignal, listener: () => void): void {
  EventTarget.prototype.addEventListener.call(signal, "abort", listener, { once: true });
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  EventTarget.prototype.removeEventListener.call(signal, "abort", listener);
}

function snapshotRequestOptions(options: unknown): Readonly<GitHubRequestOptions> {
  if (options === undefined) return Object.freeze({});
  assertReadableObject(options, "GitHub request options");
  const signal = readProperty(options, "signal", "GitHub request options");
  if (signal !== undefined) {
    let isAbortSignal: boolean;
    try {
      isAbortSignal = signal instanceof AbortSignal;
    } catch {
      invalidClientInput("GitHub request signal is invalid");
    }
    if (!isAbortSignal) invalidClientInput("GitHub request signal is invalid");
    isSignalAborted(signal as AbortSignal);
  }
  return Object.freeze({ signal: signal as AbortSignal | undefined });
}

function snapshotDependencies(input: unknown): ResolvedDependencies {
  assertReadableObject(input, "GitHub API client dependencies");
  const fetchImpl = readProperty(input, "fetch", "GitHub API client dependencies") ??
    globalThis.fetch;
  const sleep = readProperty(input, "sleep", "GitHub API client dependencies") ??
    ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)));
  const random = readProperty(input, "random", "GitHub API client dependencies") ?? Math.random;
  const now = readProperty(input, "now", "GitHub API client dependencies") ?? Date.now;
  const monotonicNow = readProperty(input, "monotonicNow", "GitHub API client dependencies") ??
    (() => performance.now());

  if (typeof fetchImpl !== "function") {
    invalidClientInput("GitHub API client fetch dependency must be a function");
  }
  if (typeof sleep !== "function") {
    invalidClientInput("GitHub API client sleep dependency must be a function");
  }
  if (typeof random !== "function") {
    invalidClientInput("GitHub API client random dependency must be a function");
  }
  if (typeof now !== "function") {
    invalidClientInput("GitHub API client now dependency must be a function");
  }
  if (typeof monotonicNow !== "function") {
    invalidClientInput("GitHub API client monotonicNow dependency must be a function");
  }

  return Object.freeze({
    fetch: fetchImpl as typeof globalThis.fetch,
    sleep: sleep as (delay: number) => Promise<void>,
    random: random as () => number,
    now: now as () => number,
    monotonicNow: monotonicNow as () => number,
  });
}

function createNonRetryableError(detail: string): VeryfrontError {
  const error = NETWORK_ERROR.create({ detail });
  nonRetryableErrors.add(error);
  return error;
}

function createCancellationError(): VeryfrontError {
  return createNonRetryableError("GitHub API request was cancelled");
}

class RequestLimiter {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }

    this.active++;
    try {
      return await operation();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

export class GitHubApiClient {
  private readonly baseUrl = "https://api.github.com";
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly sleepImpl: (delay: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly config: ResolvedGitHubConfig;
  private rateLimitInfo: GitHubRateLimitInfo | null = null;
  private warnedForResetAt: number | null = null;

  constructor(
    config: ResolvedGitHubConfig,
    dependencies: GitHubApiClientDependencies = {},
  ) {
    this.config = createGitHubConfig(config);
    const resolvedDependencies = snapshotDependencies(dependencies);
    this.fetchImpl = resolvedDependencies.fetch;
    this.sleepImpl = resolvedDependencies.sleep;
    this.random = resolvedDependencies.random;
    this.now = resolvedDependencies.now;
    this.monotonicNow = resolvedDependencies.monotonicNow;
  }

  get repoId(): string {
    return `${this.config.owner}/${this.config.repo}`;
  }

  async getTree(
    ref?: string,
    options?: GitHubRequestOptions,
  ): Promise<GitHubTreeResponse> {
    const context = this.createRequestContext(options);
    const treeRef = this.validateRequestString("tree ref", ref ?? this.config.ref, false);
    const recursiveTree = await this.fetchTree(treeRef, true, context);
    if (!recursiveTree.truncated) return recursiveTree;

    logger.warn(`${LOG_PREFIX} Recursive tree was incomplete; walking subtrees`);
    return await this.fetchCompleteTree(treeRef, context);
  }

  async getContents(
    path: string,
    ref?: string,
    options?: GitHubRequestOptions,
  ): Promise<GitHubContentItem | GitHubContentItem[]> {
    const context = this.createRequestContext(options);
    const contentPath = this.validateRequestString("content path", path, true);
    const contentRef = this.validateRequestString("content ref", ref ?? this.config.ref, false);
    const normalizedPath = normalizeGitHubPath(contentPath);
    const url = this.createRepoUrl(["contents", ...normalizedPath.split("/").filter(Boolean)], {
      ref: contentRef,
    });
    const raw = await this.request(url, context);

    let content: GitHubContentItem | GitHubContentItem[];
    try {
      content = getGitHubContentsResponseSchema().parse(raw);
    } catch {
      throw NETWORK_ERROR.create({ detail: "GitHub API returned an invalid content response" });
    }
    this.throwIfExpired(context);
    return content;
  }

  async getBlob(sha: string, options?: GitHubRequestOptions): Promise<GitHubBlobResponse> {
    const context = this.createRequestContext(options);
    const blobSha = this.validateRequestString("blob SHA", sha, false);
    const url = this.createRepoUrl(["git", "blobs", blobSha]);
    const raw = await this.request(url, context);

    let blob: GitHubBlobResponse;
    try {
      blob = getGitHubBlobResponseSchema().parse(raw);
    } catch {
      throw NETWORK_ERROR.create({ detail: "GitHub API returned an invalid blob response" });
    }
    this.throwIfExpired(context);
    return blob;
  }

  getRateLimitInfo(): GitHubRateLimitInfo | null {
    return this.rateLimitInfo
      ? { ...this.rateLimitInfo, reset: new Date(this.rateLimitInfo.reset) }
      : null;
  }

  private createRequestContext(options: unknown): RequestContext {
    const requestOptions = snapshotRequestOptions(options);
    if (requestOptions.signal && isSignalAborted(requestOptions.signal)) {
      throw createCancellationError();
    }
    return Object.freeze({
      signal: requestOptions.signal,
      deadline: this.getMonotonicTime() + this.config.retry.totalTimeout,
    });
  }

  private validateRequestString(label: string, value: unknown, allowEmpty: boolean): string {
    if (
      typeof value !== "string" || value.length > 4_096 || (!allowEmpty && value.length === 0) ||
      Array.from(value).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      })
    ) {
      invalidClientInput(`GitHub ${label} is invalid`);
    }
    return value;
  }

  private getMonotonicTime(): number {
    let value: number;
    try {
      value = this.monotonicNow();
    } catch {
      invalidClientInput("GitHub API client monotonic clock failed");
    }
    if (!Number.isFinite(value) || value < 0) {
      invalidClientInput("GitHub API client monotonic clock returned an invalid value");
    }
    return value;
  }

  private getEpochTime(): number {
    let value: number;
    try {
      value = this.now();
    } catch {
      invalidClientInput("GitHub API client clock failed");
    }
    if (!Number.isFinite(value)) {
      invalidClientInput("GitHub API client clock returned an invalid value");
    }
    return value;
  }

  private getRemainingTime(context: RequestContext): number {
    return context.deadline - this.getMonotonicTime();
  }

  private throwIfCancelled(context: RequestContext): void {
    if (
      context.signal && isSignalAborted(context.signal) ||
      context.internalSignal && isSignalAborted(context.internalSignal)
    ) {
      throw createCancellationError();
    }
  }

  private throwIfExpired(context: RequestContext): void {
    this.throwIfCancelled(context);
    if (this.getRemainingTime(context) <= 0) {
      const error = TIMEOUT_ERROR.create({ message: "GitHub API request timed out" });
      nonRetryableErrors.add(error);
      throw error;
    }
  }

  private async fetchTree(
    treeRef: string,
    recursive: boolean,
    context: RequestContext,
  ): Promise<GitHubTreeResponse> {
    const url = this.createRepoUrl(["git", "trees", treeRef], {
      recursive: recursive ? "1" : "0",
    });
    const raw = await this.request(url, context);

    try {
      const tree = getGitHubTreeResponseSchema().parse(raw);
      for (const entry of tree.tree) {
        const invalidSize = entry.size !== undefined &&
          (!Number.isSafeInteger(entry.size) || entry.size < 0);
        if (
          !entry.path || normalizeGitHubPath(entry.path) !== entry.path || !entry.sha ||
          invalidSize || entry.type === "blob" && entry.size === undefined
        ) {
          throw new Error("Invalid tree entry");
        }
      }
      this.throwIfExpired(context);
      return tree;
    } catch {
      throw NETWORK_ERROR.create({ detail: "GitHub API returned an invalid tree response" });
    }
  }

  private async fetchCompleteTree(
    treeRef: string,
    context: RequestContext,
  ): Promise<GitHubTreeResponse> {
    const traversalController = new AbortController();
    const traversalContext: RequestContext = Object.freeze({
      ...context,
      internalSignal: traversalController.signal,
    });

    try {
      const root = await this.fetchTree(treeRef, false, traversalContext);
      if (root.truncated) throw this.incompleteTreeError();

      const limiter = new RequestLimiter(COMPLETE_TREE_CONCURRENCY);
      const subtreeCache = new Map<string, Promise<GitHubTreeResponse>>();

      const loadSubtree = (sha: string): Promise<GitHubTreeResponse> => {
        const cached = subtreeCache.get(sha);
        if (cached) return cached;

        const pending = limiter.run(() => this.fetchTree(sha, false, traversalContext));
        subtreeCache.set(sha, pending);
        return pending;
      };

      const expand = async (
        entries: GitHubTreeEntry[],
        prefix = "",
      ): Promise<GitHubTreeEntry[]> => {
        const groups = await Promise.all(entries.map(async (entry): Promise<GitHubTreeEntry[]> => {
          const path = prefix ? `${prefix}/${entry.path}` : entry.path;
          const normalizedEntry = { ...entry, path };
          if (entry.type !== "tree") return [normalizedEntry];

          const subtree = await loadSubtree(entry.sha);
          if (subtree.truncated) throw this.incompleteTreeError();
          return [normalizedEntry, ...await expand(subtree.tree, path)];
        }));
        return groups.flat();
      };

      const tree = await expand(root.tree);
      this.throwIfExpired(traversalContext);
      return { ...root, tree, truncated: false };
    } catch (error) {
      traversalController.abort();
      throw error;
    }
  }

  private incompleteTreeError(): Error {
    return NETWORK_ERROR.create({
      detail: "GitHub API could not provide a complete repository tree",
    });
  }

  private createRepoUrl(pathSegments: string[], query: Record<string, string> = {}): URL {
    const segments = ["repos", this.config.owner, this.config.repo, ...pathSegments];
    const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join("/");
    const url = new URL(`/${encodedPath}`, this.baseUrl);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url;
  }

  private async request(url: URL, context: RequestContext): Promise<unknown> {
    const totalAttempts = this.config.retry.maxRetries + 1;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      this.throwIfExpired(context);
      try {
        const result = await this.requestOnce(url, context);
        this.throwIfExpired(context);
        return result;
      } catch (error) {
        lastError = this.normalizeRequestError(error);
        if (!this.isRetryable(lastError) || attempt >= totalAttempts) throw lastError;

        const delay = this.calculateRetryDelay(attempt, lastError);
        const remaining = this.getRemainingTime(context);
        if (remaining <= 0 || delay >= remaining) throw lastError;
        logger.warn(`${LOG_PREFIX} Request failed; retrying`, {
          attempt,
          delay,
          errorName: lastError.name,
        });
        try {
          await this.waitForRetry(delay, context);
        } catch (error) {
          throw this.normalizeRequestError(error);
        }
      }
    }

    throw lastError ?? NETWORK_ERROR.create({ detail: "GitHub API request failed" });
  }

  private async requestOnce(url: URL, context: RequestContext): Promise<unknown> {
    this.throwIfExpired(context);
    const controller = new AbortController();
    const timeoutError = TIMEOUT_ERROR.create({ message: "GitHub API request timed out" });
    const attemptTimeout = Math.max(
      1,
      Math.min(this.config.retry.requestTimeout, Math.ceil(this.getRemainingTime(context))),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abortListeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
    const boundaryPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(timeoutError);
        controller.abort();
      }, attemptTimeout);

      for (const signal of [context.signal, context.internalSignal]) {
        if (!signal) continue;
        const listener = () => {
          reject(createCancellationError());
          controller.abort();
        };
        addAbortListener(signal, listener);
        abortListeners.push({ signal, listener });
      }
    });

    try {
      const operation = (async (): Promise<unknown> => {
        const response = await this.fetchImpl(url, {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "veryfront-server",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });

        this.updateRateLimitInfo(response);
        if (!response.ok) {
          await this.discardBody(response);
          throw this.createAPIError(response);
        }

        try {
          return await this.readResponseJson(response, controller.signal);
        } catch (error) {
          if (isSignalAborted(controller.signal)) throw timeoutError;
          if (error instanceof VeryfrontError) throw error;
          throw createNonRetryableError("GitHub API returned invalid JSON");
        }
      })();

      return await Promise.race([operation, boundaryPromise]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      for (const { signal, listener } of abortListeners) {
        removeAbortListener(signal, listener);
      }
    }
  }

  private async waitForRetry(delay: number, context: RequestContext): Promise<void> {
    this.throwIfExpired(context);
    const remaining = this.getRemainingTime(context);
    const timeoutError = TIMEOUT_ERROR.create({ message: "GitHub API request timed out" });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abortListeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
    const boundaryPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(timeoutError), Math.max(1, Math.ceil(remaining)));
      for (const signal of [context.signal, context.internalSignal]) {
        if (!signal) continue;
        const listener = () => reject(createCancellationError());
        addAbortListener(signal, listener);
        abortListeners.push({ signal, listener });
      }
    });

    try {
      await Promise.race([this.sleepImpl(delay), boundaryPromise]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      for (const { signal, listener } of abortListeners) {
        removeAbortListener(signal, listener);
      }
    }
  }

  private async readResponseJson(response: Response, signal: AbortSignal): Promise<unknown> {
    const maxBytes = this.config.retry.maxResponseBytes;
    const contentLength = response.headers.get("content-length");
    if (/^\d+$/.test(contentLength ?? "") && Number(contentLength) > maxBytes) {
      await this.discardBody(response);
      throw createNonRetryableError(
        "GitHub API response exceeded the configured size limit",
      );
    }

    if (!response.body) {
      throw createNonRetryableError("GitHub API returned invalid JSON");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await this.readChunk(reader, signal);
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // The size violation remains authoritative when cancellation fails.
          }
          throw createNonRetryableError(
            "GitHub API response exceeded the configured size limit",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }

    try {
      return JSON.parse(new TextDecoder().decode(body));
    } catch {
      throw createNonRetryableError("GitHub API returned invalid JSON");
    }
  }

  private readChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (isSignalAborted(signal)) {
      reader.cancel().catch(() => {});
      return Promise.reject(createCancellationError());
    }

    return new Promise((resolve, reject) => {
      const onAbort = () => {
        reader.cancel().catch(() => {});
        reject(createCancellationError());
      };
      addAbortListener(signal, onAbort);
      reader.read().then(resolve, reject).finally(() => removeAbortListener(signal, onAbort));
    });
  }

  private async discardBody(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // The response status remains authoritative when body cancellation fails.
    }
  }

  private updateRateLimitInfo(response: Response): void {
    const limit = this.parseNonNegativeInteger(response.headers.get("X-RateLimit-Limit"));
    const remaining = this.parseNonNegativeInteger(
      response.headers.get("X-RateLimit-Remaining"),
    );
    const resetSeconds = this.parseNonNegativeInteger(response.headers.get("X-RateLimit-Reset"));
    const used = this.parseNonNegativeInteger(response.headers.get("X-RateLimit-Used")) ?? 0;
    if (limit === null || remaining === null || resetSeconds === null) return;

    const reset = new Date(resetSeconds * 1_000);
    if (!Number.isFinite(reset.getTime())) return;

    this.rateLimitInfo = { limit, remaining, reset, used };
    if (
      remaining < RATE_LIMIT_WARNING_THRESHOLD &&
      this.warnedForResetAt !== reset.getTime()
    ) {
      this.warnedForResetAt = reset.getTime();
      logger.warn(`${LOG_PREFIX} Approaching rate limit`, {
        remaining,
        reset: reset.toISOString(),
      });
    }
  }

  private parseNonNegativeInteger(value: string | null): number | null {
    if (value === null || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  private createAPIError(response: Response): APIError {
    const retryAfterMs = this.parseRetryAfter(response.headers.get("Retry-After"));
    const responseRemaining = this.parseNonNegativeInteger(
      response.headers.get("X-RateLimit-Remaining"),
    );
    const resetSeconds = this.parseNonNegativeInteger(response.headers.get("X-RateLimit-Reset"));
    const rateLimited = response.status === 429 ||
      response.status === 403 && (responseRemaining === 0 || retryAfterMs !== null);

    let error: VeryfrontError;
    switch (response.status) {
      case 401:
        error = CONFIG_INVALID.create({
          detail: "GitHub API authentication failed. Check the configured token",
        });
        break;
      case 403:
        error = rateLimited
          ? NETWORK_ERROR.create({ detail: "GitHub API rate limit exceeded" })
          : CONFIG_INVALID.create({
            detail: "GitHub API access is forbidden. Check repository token permissions",
          });
        break;
      case 404:
        error = FILE_NOT_FOUND.create({ message: "Not found: GitHub repository resource" });
        break;
      case 422:
        error = CONFIG_INVALID.create({ detail: "GitHub API rejected the request" });
        break;
      case 429:
        error = NETWORK_ERROR.create({ detail: "GitHub API rate limit exceeded" });
        break;
      default:
        error = NETWORK_ERROR.create({
          detail: `GitHub API request failed with status ${response.status}`,
        });
    }

    const apiError = error as APIError;
    apiError.statusCode = response.status;
    apiError.rateLimited = rateLimited;
    if (retryAfterMs !== null) apiError.retryAfterMs = retryAfterMs;
    if (resetSeconds !== null) {
      apiError.rateLimitResetMs = Math.max(
        0,
        resetSeconds * 1_000 - this.getEpochTime(),
      );
    }
    return apiError;
  }

  private parseRetryAfter(value: string | null): number | null {
    if (value === null) return null;
    if (/^\d+$/.test(value)) {
      const seconds = Number(value);
      if (!Number.isFinite(seconds)) return Number.POSITIVE_INFINITY;
      const milliseconds = seconds * 1_000;
      return Number.isFinite(milliseconds) ? milliseconds : Number.POSITIVE_INFINITY;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - this.getEpochTime()) : null;
  }

  private normalizeRequestError(error: unknown): Error {
    if (error instanceof VeryfrontError) return error;
    return NETWORK_ERROR.create({ detail: "GitHub API request failed" });
  }

  private isRetryable(error: Error): boolean {
    if (nonRetryableErrors.has(error)) return false;
    const apiError = error as APIError;
    if (apiError.rateLimited) return true;
    if (apiError.statusCode === undefined) return true;
    return apiError.statusCode >= 500;
  }

  private calculateRetryDelay(attempt: number, error: Error): number {
    const apiError = error as APIError;
    if (apiError.rateLimited) {
      const requestedDelay = apiError.retryAfterMs ?? apiError.rateLimitResetMs ?? 0;
      return Math.max(this.config.retry.initialDelay, requestedDelay);
    }

    const exponentialDelay = Math.min(
      this.config.retry.maxDelay,
      this.config.retry.initialDelay * 2 ** (attempt - 1),
    );
    const jitterLimit = Math.min(
      RETRY_JITTER_MAX_MS,
      this.config.retry.maxDelay - exponentialDelay,
    );
    let randomFraction: number;
    try {
      randomFraction = this.random();
    } catch {
      invalidClientInput("GitHub API client random source failed");
    }
    if (!Number.isFinite(randomFraction) || randomFraction < 0 || randomFraction > 1) {
      invalidClientInput("GitHub API client random source returned an invalid value");
    }
    return exponentialDelay + Math.max(0, jitterLimit) * randomFraction;
  }
}

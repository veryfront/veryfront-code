const DEFAULT_MAX_ENTRIES = 65_536;
const DEFAULT_MAX_CACHED_RESPONSE_BYTES = 64 * 1024 * 1024;
const DEFAULT_RETENTION_MS = 5 * 60 * 1000;
const MAX_IDENTITY_COMPONENT_LENGTH = 256;
const MAX_FINGERPRINT_LENGTH = 128;

const encoder = new TextEncoder();

/** Stable signed operation identity and exact request fingerprint. */
export interface SignedRequestIdentity {
  readonly scope: string;
  readonly audience: string;
  readonly projectId: string;
  readonly subject: string;
  readonly fingerprint: string;
  readonly expiresAtMs: number;
}

/** Serialized JSON response safe to reproduce for an idempotent retry. */
export interface SignedRequestJsonResponse {
  readonly status: number;
  readonly body: string;
}

/** Serialize one JSON response before it is shared or cached. */
export function serializeSignedRequestJsonResponse(
  value: unknown,
  status: number,
): SignedRequestJsonResponse {
  const body = JSON.stringify(value);
  if (typeof body !== "string") {
    throw new TypeError("Signed request response is not JSON serializable");
  }
  return requireResponse({ status, body });
}

/** Result produced by one protected endpoint execution. */
export interface SignedRequestExecutionResult {
  readonly response: SignedRequestJsonResponse;
  /** Cache completed output. False keeps identical retryable failures executable. */
  readonly cache: boolean;
}

/** Atomic idempotency decision for a signed endpoint request. */
export type SignedRequestIdempotencyResult =
  | {
    readonly kind: "response";
    readonly response: SignedRequestJsonResponse;
    readonly replayed: boolean;
  }
  | { readonly kind: "conflict" }
  | { readonly kind: "saturated" }
  | { readonly kind: "replay-unavailable" };

interface IdempotencyEntry {
  readonly fingerprint: string;
  retireAtMs: number;
  inFlight?: Promise<SignedRequestJsonResponse>;
  response?: SignedRequestJsonResponse;
  responseBytes: number;
  replayUnavailable: boolean;
}

/** Memory and retention policy for a signed-request idempotency store. */
export interface SignedRequestIdempotencyStoreOptions {
  /** Maximum protected operation identities. New identities fail closed at this limit. */
  readonly maxEntries?: number;
  /** Maximum UTF-8 bytes retained across reproducible response bodies. */
  readonly maxCachedResponseBytes?: number;
  /** Minimum identity and completed-response retention after the latest access. */
  readonly retentionMs?: number;
  /** Injectable wall clock used by tests. */
  readonly now?: () => number;
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireBoundedString(value: string, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function requireIdentity(identity: SignedRequestIdentity): SignedRequestIdentity {
  requireBoundedString(identity.scope, "Signed request scope", MAX_IDENTITY_COMPONENT_LENGTH);
  requireBoundedString(identity.audience, "Signed request audience", MAX_IDENTITY_COMPONENT_LENGTH);
  requireBoundedString(
    identity.projectId,
    "Signed request project id",
    MAX_IDENTITY_COMPONENT_LENGTH,
  );
  requireBoundedString(identity.subject, "Signed request subject", MAX_IDENTITY_COMPONENT_LENGTH);
  requireBoundedString(
    identity.fingerprint,
    "Signed request fingerprint",
    MAX_FINGERPRINT_LENGTH,
  );
  requirePositiveSafeInteger(identity.expiresAtMs, "Signed request expiration");
  return identity;
}

function requireResponse(response: SignedRequestJsonResponse): SignedRequestJsonResponse {
  if (
    !Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599 ||
    typeof response.body !== "string"
  ) {
    throw new TypeError("Signed request execution returned an invalid HTTP response");
  }
  return response;
}

function identityKey(identity: SignedRequestIdentity): string {
  return JSON.stringify([
    identity.scope,
    identity.audience,
    identity.projectId,
    identity.subject,
  ]);
}

function addWithoutOverflow(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

/**
 * Process-wide replay protection for body-bound signed requests.
 *
 * One map insertion happens before endpoint work starts, which coalesces
 * concurrent duplicates. Completed serialized responses remain reproducible
 * for a bounded retry window. Identity entries remain even when response-body
 * storage is exhausted, so memory pressure never turns a replay into a second
 * side effect.
 */
export class SignedRequestIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();
  private readonly maxEntries: number;
  private readonly maxCachedResponseBytes: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private cachedBytes = 0;

  constructor(options: SignedRequestIdempotencyStoreOptions = {}) {
    this.maxEntries = requirePositiveSafeInteger(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      "Signed request idempotency max entries",
    );
    this.maxCachedResponseBytes = requirePositiveSafeInteger(
      options.maxCachedResponseBytes ?? DEFAULT_MAX_CACHED_RESPONSE_BYTES,
      "Signed request idempotency response byte limit",
    );
    this.retentionMs = requirePositiveSafeInteger(
      options.retentionMs ?? DEFAULT_RETENTION_MS,
      "Signed request idempotency retention",
    );
    this.now = options.now ?? (() => Date.now());
  }

  execute(
    rawIdentity: SignedRequestIdentity,
    operation: () => Promise<SignedRequestExecutionResult>,
  ): Promise<SignedRequestIdempotencyResult> {
    const identity = requireIdentity(rawIdentity);
    const now = this.readNow();
    const key = identityKey(identity);
    let entry = this.entries.get(key);

    if (entry && !entry.inFlight && entry.retireAtMs <= now) {
      this.deleteEntry(key, entry);
      entry = undefined;
    }

    if (entry) {
      if (entry.fingerprint !== identity.fingerprint) {
        return Promise.resolve({ kind: "conflict" });
      }
      entry.retireAtMs = Math.max(
        entry.retireAtMs,
        identity.expiresAtMs,
        addWithoutOverflow(now, this.retentionMs),
      );
      if (entry.response) {
        this.touch(key, entry);
        return Promise.resolve({
          kind: "response",
          response: entry.response,
          replayed: true,
        });
      }
      if (entry.inFlight) {
        return entry.inFlight.then((response) => ({
          kind: "response" as const,
          response,
          replayed: true,
        }));
      }
      if (entry.replayUnavailable) {
        return Promise.resolve({ kind: "replay-unavailable" });
      }
      return this.startOperation(key, entry, operation, true);
    }

    if (this.entries.size >= this.maxEntries) {
      this.pruneExpired(now);
      if (this.entries.size >= this.maxEntries) {
        return Promise.resolve({ kind: "saturated" });
      }
    }

    entry = {
      fingerprint: identity.fingerprint,
      retireAtMs: Math.max(identity.expiresAtMs, addWithoutOverflow(now, this.retentionMs)),
      responseBytes: 0,
      replayUnavailable: false,
    };
    this.entries.set(key, entry);
    return this.startOperation(key, entry, operation, false);
  }

  clear(): void {
    this.entries.clear();
    this.cachedBytes = 0;
  }

  get size(): number {
    return this.entries.size;
  }

  get cachedResponseBytes(): number {
    return this.cachedBytes;
  }

  private startOperation(
    key: string,
    entry: IdempotencyEntry,
    operation: () => Promise<SignedRequestExecutionResult>,
    replayed: boolean,
  ): Promise<SignedRequestIdempotencyResult> {
    const shared: Promise<SignedRequestJsonResponse> = Promise.resolve()
      .then(operation)
      .then((result) => {
        const response = Object.freeze({ ...requireResponse(result.response) });
        const current = this.entries.get(key);
        if (current === entry && entry.inFlight === shared) {
          entry.inFlight = undefined;
          entry.retireAtMs = Math.max(
            entry.retireAtMs,
            addWithoutOverflow(this.readNow(), this.retentionMs),
          );
          if (result.cache) this.cacheResponse(key, entry, response);
        }
        return response;
      })
      .catch((error) => {
        const current = this.entries.get(key);
        if (current === entry && entry.inFlight === shared) {
          entry.inFlight = undefined;
        }
        throw error;
      });
    entry.inFlight = shared;

    return shared.then((response) => ({
      kind: "response" as const,
      response,
      replayed,
    }));
  }

  private cacheResponse(
    key: string,
    entry: IdempotencyEntry,
    response: SignedRequestJsonResponse,
  ): void {
    const responseBytes = encoder.encode(response.body).byteLength;
    if (responseBytes > this.maxCachedResponseBytes) {
      entry.replayUnavailable = true;
      return;
    }

    this.makeResponseCapacity(responseBytes, entry);
    if (this.cachedBytes + responseBytes > this.maxCachedResponseBytes) {
      entry.replayUnavailable = true;
      return;
    }

    entry.response = response;
    entry.responseBytes = responseBytes;
    entry.replayUnavailable = false;
    this.cachedBytes += responseBytes;
    this.touch(key, entry);
  }

  private makeResponseCapacity(requiredBytes: number, protectedEntry: IdempotencyEntry): void {
    if (this.cachedBytes + requiredBytes <= this.maxCachedResponseBytes) return;

    for (const candidate of this.entries.values()) {
      if (candidate === protectedEntry || !candidate.response || candidate.inFlight) continue;
      this.dropResponse(candidate);
      if (this.cachedBytes + requiredBytes <= this.maxCachedResponseBytes) return;
    }
  }

  private dropResponse(entry: IdempotencyEntry): void {
    if (!entry.response) return;
    this.cachedBytes -= entry.responseBytes;
    entry.response = undefined;
    entry.responseBytes = 0;
    entry.replayUnavailable = true;
  }

  private touch(key: string, entry: IdempotencyEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (!entry.inFlight && entry.retireAtMs <= now) this.deleteEntry(key, entry);
    }
  }

  private deleteEntry(key: string, entry: IdempotencyEntry): void {
    if (this.entries.get(key) !== entry) return;
    this.entries.delete(key);
    if (entry.response) this.cachedBytes -= entry.responseBytes;
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError("Signed request idempotency clock returned an invalid timestamp");
    }
    return value;
  }
}

/** Default store shared by all signed request handler instances in this process. */
export const signedRequestIdempotencyStore = new SignedRequestIdempotencyStore();

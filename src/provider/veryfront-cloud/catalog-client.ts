/**
 * Client for the model catalog Veryfront Cloud serves at `<api>/ai/models`.
 *
 * Catalog facts (wire protocol, operations, thinking defaults and transport
 * capabilities) come only from the served catalog. Loading is asynchronous
 * and happens on the first async step of a model call; every synchronous
 * reader uses {@link peekVeryfrontCloudCatalog} and degrades to protocol
 * defaults when nothing is loaded yet.
 *
 * - Entries are cached per API base URL, project and credential, because the
 *   served list is filtered by the project the credential or header selects.
 *   A synchronous read names the same scope, so one project never reads
 *   another project's list.
 * - Concurrent loads for one key share a single request. A caller's abort
 *   signal only stops that caller waiting; it never cancels the shared request.
 * - An entry is fresh for {@link VERYFRONT_CLOUD_CATALOG_TTL_MS}. A stale entry
 *   is returned at once while one refresh runs in the background, and it is
 *   kept when that refresh fails.
 * - A failed load never throws. It is logged once and retried after
 *   {@link VERYFRONT_CLOUD_CATALOG_RETRY_MS}.
 */
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";

const ObjectCreate = Object.create;

/** How long a loaded catalog is used before it is refreshed. */
export const VERYFRONT_CLOUD_CATALOG_TTL_MS = 5 * 60_000;
/** How long a failed load waits before the next attempt for the same key. */
export const VERYFRONT_CLOUD_CATALOG_RETRY_MS = 30_000;
/**
 * Most catalogs kept at once. Run-scoped credentials rotate, so each run can
 * add a key; the least recently used entry goes first, and a load in flight is
 * never evicted.
 */
export const VERYFRONT_CLOUD_CATALOG_MAX_ENTRIES = 256;
/** Upper bound on one catalog request. */
const VERYFRONT_CLOUD_CATALOG_TIMEOUT_MS = 10_000;
/** Header naming the project a catalog request is scoped to. */
const PROJECT_SLUG_HEADER = "x-veryfront-project-slug";
/** Path of the served catalog, relative to the API base URL. */
const VERYFRONT_CLOUD_CATALOG_PATH = "ai/models";

/** One model of the served catalog, reduced to the facts this package reads. */
export interface VeryfrontCloudCatalogModel {
  /** Short model id, for example `claude-sonnet-4-6`. */
  readonly id: string;
  /** Provider-qualified model id, for example `anthropic/claude-sonnet-4-6`. */
  readonly modelId: string;
  /** Canonical provider the model belongs to. */
  readonly provider: string;
  /** Other ids that select this model. */
  readonly aliases: readonly string[];
  /** Wire protocol the model is served on. Absent when the platform declares none. */
  readonly surface?: string;
  /** Operations of `surface` the model is served on. Absent on an older API. */
  readonly operations?: readonly string[];
  /** Provider-native tools the selected deployment permits. Absent on an older API. */
  readonly supportedProviderTools?: readonly string[];
  /** Whether the model takes thinking controls. */
  readonly thinking?: boolean;
  /** Which reasoning control the model takes, for example `budget` or `adaptive`. */
  readonly reasoningMode?: string;
  /** OpenAI wire API the model must use, when the platform constrains it. */
  readonly transport?: string;
  /** Thinking budget to send when the caller sets none. */
  readonly reasoningBudgetTokens?: number;
  /** Whether `chat-completions` accepts reasoning together with function tools. */
  readonly chatCompletionsReasoningWithFunctionTools?: boolean;
  /** Whether `chat-completions` accepts adjacent system messages separately. */
  readonly chatCompletionsConsecutiveSystemMessages?: boolean;
}

/** A loaded catalog. */
export interface VeryfrontCloudCatalog {
  readonly models: readonly VeryfrontCloudCatalogModel[];
  /** Provider-qualified id of the default model, when the platform names one. */
  readonly defaultModelId?: string;
}

/** Credentials and project a catalog is loaded and read for: the same ones inference uses. */
export interface VeryfrontCloudCatalogScope {
  readonly apiBaseUrl: string;
  readonly apiToken: string;
  readonly projectSlug?: string;
}

/** Options for one catalog load. */
export interface VeryfrontCloudCatalogLoadOptions extends VeryfrontCloudCatalogScope {
  /** Stops this caller waiting. The shared request keeps running for other callers. */
  readonly signal?: AbortSignal;
  /** Longest this caller waits for a request in flight before it goes on without it. */
  readonly maxWaitMs?: number;
  /**
   * Wait for the refresh of a stale entry instead of answering with it at once,
   * for a caller about to make a decision the catalog must be current for. The
   * stale entry still answers when the refresh fails or the wait ends.
   */
  readonly fresh?: boolean;
  /**
   * Throws when the credential in `apiToken` may no longer be sent. Called
   * before this caller starts a catalog request, the one step here that sends
   * the credential; a revoked credential then fails the load instead of
   * reaching the network.
   */
  readonly assertCredentialActive?: () => void;
}

interface CatalogEntry {
  catalog: VeryfrontCloudCatalog;
  fetchedAt: number;
}

const entries = new Map<string, CatalogEntry>();
const inflight = new Map<string, Promise<VeryfrontCloudCatalog | undefined>>();
const failedAt = new Map<string, number>();
/**
 * Catalogs a trusted peer loaded and handed over, keyed by a random key that
 * names no credential. Kept apart from the cache so eviction never drops one
 * while the run it was received for still reads it; the receiver forgets it.
 */
const received = new Map<string, VeryfrontCloudCatalog>();
/** Prefix of every received catalog key. A cache key has line breaks, a received key none. */
const RECEIVED_KEY_PREFIX = "received:";
/** Key of the scope a synchronous read uses, while {@link withVeryfrontCloudCatalogScope} runs. */
let activeKey: string | undefined;
let seeded: VeryfrontCloudCatalog | undefined;
/** Scopes whose current failure has been logged, so each scope logs once per outage. */
const loggedFailures = new Set<string>();
let now: () => number = Date.now;
/** Bumped by a test reset, so a load that settles afterwards changes nothing. */
let generation = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function parseModel(value: unknown): VeryfrontCloudCatalogModel | undefined {
  if (!isRecord(value)) return undefined;
  const id = optionalString(value.id);
  const modelId = optionalString(value.modelId);
  const provider = optionalString(value.provider);
  if (!id || !modelId || !provider) return undefined;
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  const model: VeryfrontCloudCatalogModel = {
    id,
    modelId,
    provider,
    aliases: Object.freeze(stringList(value.aliases) ?? []),
    surface: optionalString(value.surface),
    operations: ((operations) => operations && Object.freeze(operations))(
      stringList(value.operations),
    ),
    supportedProviderTools: ((tools) => tools && Object.freeze(tools))(
      stringList(value.supportedProviderTools),
    ),
    thinking: optionalBoolean(capabilities.thinking),
    reasoningMode: optionalString(capabilities.reasoning_mode),
    transport: optionalString(capabilities.transport),
    reasoningBudgetTokens: optionalPositiveInteger(capabilities.reasoning_budget_tokens),
    chatCompletionsReasoningWithFunctionTools: optionalBoolean(
      capabilities.chat_completions_reasoning_with_function_tools,
    ),
    chatCompletionsConsecutiveSystemMessages: optionalBoolean(
      capabilities.chat_completions_consecutive_system_messages,
    ),
  };
  return Object.freeze(model);
}

/**
 * Read a served `/ai/models` payload. Rows without an id, model id or provider
 * are skipped, and a field an older API does not serve reads as absent.
 * Returns undefined when the payload carries no model list at all.
 */
export function parseVeryfrontCloudCatalog(payload: unknown): VeryfrontCloudCatalog | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.models)) return undefined;
  const models: VeryfrontCloudCatalogModel[] = [];
  for (const row of payload.models) {
    const model = parseModel(row);
    if (model) models.push(model);
  }
  return Object.freeze({
    models: Object.freeze(models),
    defaultModelId: optionalString(payload.defaultModelId),
  });
}

/**
 * Non-reversible fingerprint of a credential, so entries for different
 * credentials never share a key and the key never holds the credential.
 */
/**
 * Per-process salt for credential fingerprints, so a fingerprint means nothing
 * outside this process and cannot be matched against a known credential.
 */
const FINGERPRINT_SALT = Array.from(
  crypto.getRandomValues(new Uint8Array(16)),
  (byte) => byte.toString(16).padStart(2, "0"),
).join("");

function credentialFingerprint(token: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const salted = `${FINGERPRINT_SALT}:${token}`;
  for (let index = 0; index < salted.length; index++) {
    const code = salted.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16)}${b.toString(16)}`;
}

/** Store an entry as the most recently used, evicting the least recently used over the cap. */
function rememberEntry(key: string, entry: CatalogEntry): void {
  entries.delete(key);
  entries.set(key, entry);
  evictOldest(entries);
}

/** Mark an entry as just used, so eviction keeps it longest. */
function touchEntry(key: string, entry: CatalogEntry): void {
  entries.delete(key);
  entries.set(key, entry);
}

/** Drop the oldest keys over the cap, skipping any key with a load in flight. */
function evictOldest(map: Map<string, unknown>): void {
  if (map.size <= VERYFRONT_CLOUD_CATALOG_MAX_ENTRIES) return;
  for (const key of [...map.keys()]) {
    if (map.size <= VERYFRONT_CLOUD_CATALOG_MAX_ENTRIES) return;
    if (!inflight.has(key)) map.delete(key);
  }
}

/** Record a failed load, forgetting failures whose retry window has passed. */
function rememberFailure(key: string, at: number): void {
  for (const [failedKey, failedTime] of failedAt) {
    if (at - failedTime >= VERYFRONT_CLOUD_CATALOG_RETRY_MS) failedAt.delete(failedKey);
  }
  failedAt.delete(key);
  failedAt.set(key, at);
  evictOldest(failedAt);
}

/**
 * A catalog scope key: the cache key for a scope. It carries the API base URL,
 * the project and a salted credential fingerprint, never the credential, so a
 * context that must not hold the credential can still name the catalog loaded
 * for it.
 */
export type VeryfrontCloudCatalogScopeKey = string & { readonly __catalogScopeKey: true };

/** The non-secret scope key for a scope. */
export function veryfrontCloudCatalogScopeKey(
  scope: VeryfrontCloudCatalogScope,
): VeryfrontCloudCatalogScopeKey {
  return cacheKey(scope) as VeryfrontCloudCatalogScopeKey;
}

function keyOf(scope: VeryfrontCloudCatalogScope | VeryfrontCloudCatalogScopeKey): string {
  return typeof scope === "string" ? scope : cacheKey(scope);
}

function cacheKey(scope: VeryfrontCloudCatalogScope): string {
  return `${scope.apiBaseUrl}\n${scope.projectSlug ?? ""}\n${
    credentialFingerprint(scope.apiToken)
  }`;
}

/**
 * The catalog URL under an API base URL. Like the gateway URLs, it keeps the
 * base URL's query, which a setup can use to scope or sign requests.
 */
function catalogUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${VERYFRONT_CLOUD_CATALOG_PATH}`;
  url.hash = "";
  return url.toString();
}

/** An API base URL without its query or fragment, which can carry signed values. */
function loggableBaseUrl(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "[invalid URL]";
  }
}

/** Strip the query and fragment from every URL an error message quotes. */
function loggableErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(https?:\/\/[^\s?#"'<>)]*)[?#][^\s"'<>)]*/g, "$1");
}

async function fetchCatalog(
  options: VeryfrontCloudCatalogScope,
): Promise<VeryfrontCloudCatalog> {
  // A null-prototype record, not a Headers object: project code can replace the
  // global Headers class and its methods, and a Headers init would run their
  // patchable iterator over the bearer. A plain record takes neither path.
  const headers = ObjectCreate(null) as Record<string, string>;
  headers["accept"] = "application/json";
  headers["authorization"] = `Bearer ${options.apiToken}`;
  if (options.projectSlug) headers[PROJECT_SLUG_HEADER] = options.projectSlug;
  // Only the internal timeout bounds the shared request: one caller giving up
  // must not fail the load for every other caller on the same key.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), VERYFRONT_CLOUD_CATALOG_TIMEOUT_MS);
  const signal = timeout.signal;
  try {
    const response = await createVeryfrontApiOriginBoundOutboundFetch(options.apiBaseUrl)(
      catalogUrl(options.apiBaseUrl),
      { method: "GET", headers, signal },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(
        `Veryfront Cloud model catalog request failed with status ${response.status}`,
      );
    }
    const catalog = parseVeryfrontCloudCatalog(await response.json());
    if (!catalog) throw new Error("Veryfront Cloud model catalog response has no model list");
    return catalog;
  } finally {
    clearTimeout(timer);
  }
}

function refresh(
  key: string,
  options: VeryfrontCloudCatalogScope,
): Promise<VeryfrontCloudCatalog | undefined> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const started = generation;
  const request = fetchCatalog(options).then(
    (catalog) => {
      if (started !== generation) return catalog;
      rememberEntry(key, { catalog, fetchedAt: now() });
      failedAt.delete(key);
      loggedFailures.delete(key);
      return catalog;
    },
    (error: unknown) => {
      if (started !== generation) return undefined;
      rememberFailure(key, now());
      const stale = entries.get(key)?.catalog;
      if (!loggedFailures.has(key)) {
        if (loggedFailures.size >= VERYFRONT_CLOUD_CATALOG_MAX_ENTRIES) loggedFailures.clear();
        loggedFailures.add(key);
        // Names the scope, never the credential or a signed query value.
        logger.warn(
          stale
            ? "Veryfront Cloud model catalog refresh failed; the last loaded catalog stays in use"
            : "Veryfront Cloud model catalog is unavailable; models use protocol defaults until it loads",
          {
            apiBaseUrl: loggableBaseUrl(options.apiBaseUrl),
            projectSlug: options.projectSlug,
            error: loggableErrorMessage(error),
          },
        );
      }
      return stale;
    },
  ).finally(() => {
    if (started !== generation) return;
    inflight.delete(key);
    // Eviction skips keys with a load in flight; retry now that this one has
    // settled, so a burst of concurrent scopes cannot leave the maps over the cap.
    evictOldest(entries);
    evictOldest(failedAt);
  });
  inflight.set(key, request);
  return request;
}

/** Resolve with what `request` resolves to, or with `fallback` once this caller stops waiting. */
function waitFor(
  request: Promise<VeryfrontCloudCatalog | undefined>,
  fallback: VeryfrontCloudCatalog | undefined,
  signal: AbortSignal | undefined,
  maxWaitMs: number | undefined,
): Promise<VeryfrontCloudCatalog | undefined> {
  if (!signal && maxWaitMs === undefined) return request;
  if (signal?.aborted) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: VeryfrontCloudCatalog | undefined) => {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish(fallback);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (maxWaitMs !== undefined) timer = setTimeout(() => finish(fallback), maxWaitMs);
    void request.then(finish);
  });
}

/**
 * Load the served catalog for a scope. Resolves to the cached catalog when it
 * is fresh, to a stale one while a refresh runs, and to undefined when no
 * catalog could be loaded or the caller stopped waiting first. Never rejects,
 * except that `assertCredentialActive` throws synchronously, before any request,
 * when the credential it guards was revoked.
 */
export function loadVeryfrontCloudCatalog(
  options: VeryfrontCloudCatalogLoadOptions,
): Promise<VeryfrontCloudCatalog | undefined> {
  if (seeded) return Promise.resolve(seeded);
  const key = cacheKey(options);
  const entry = entries.get(key);
  const current = now();
  if (entry && current - entry.fetchedAt < VERYFRONT_CLOUD_CATALOG_TTL_MS) {
    touchEntry(key, entry);
    return Promise.resolve(entry.catalog);
  }
  const lastFailure = failedAt.get(key);
  if (lastFailure !== undefined && current - lastFailure < VERYFRONT_CLOUD_CATALOG_RETRY_MS) {
    return Promise.resolve(entry?.catalog);
  }
  if (lastFailure !== undefined) failedAt.delete(key);
  options.assertCredentialActive?.();
  const request = refresh(key, {
    apiBaseUrl: options.apiBaseUrl,
    apiToken: options.apiToken,
    ...(options.projectSlug ? { projectSlug: options.projectSlug } : {}),
  });
  // Stale while revalidate: the stale entry answers now, the refresh replaces it.
  if (entry && !options.fresh) return Promise.resolve(entry.catalog);
  return waitFor(request, entry?.catalog, options.signal, options.maxWaitMs).then((catalog) =>
    catalog ?? entry?.catalog
  );
}

/**
 * Whether the catalog for a scope is fresh: loaded within the TTL. Without a
 * scope, reads the one {@link withVeryfrontCloudCatalogScope} names. A stale
 * catalog may miss models the platform has enabled since, so it must not be
 * used to refuse one.
 */
export function isVeryfrontCloudCatalogFresh(
  scope?: VeryfrontCloudCatalogScope | VeryfrontCloudCatalogScopeKey,
): boolean {
  if (seeded) return true;
  const key = scope ? keyOf(scope) : activeKey;
  // A received catalog lists only the models it was received for, so it is
  // never fresh enough to refuse a model on its own.
  if (key === undefined || received.has(key)) return false;
  const entry = entries.get(key);
  return entry !== undefined && now() - entry.fetchedAt < VERYFRONT_CLOUD_CATALOG_TTL_MS;
}

/**
 * Run `fn` synchronously with {@link peekVeryfrontCloudCatalog} reading the
 * catalog loaded for `scope`, so a model's facts come from its own project and
 * credential whatever the ambient request carries.
 */
export function withVeryfrontCloudCatalogScope<T>(
  scope: VeryfrontCloudCatalogScope | VeryfrontCloudCatalogScopeKey,
  fn: () => T,
): T {
  const previous = activeKey;
  activeKey = keyOf(scope);
  try {
    return fn();
  } finally {
    activeKey = previous;
  }
}

/** Whether {@link withVeryfrontCloudCatalogScope} names the scope reads use right now. */
export function hasActiveVeryfrontCloudCatalogScope(): boolean {
  return activeKey !== undefined;
}

/**
 * The catalog loaded for a scope, stale or not, or undefined before any load
 * for it. Without a scope, reads the one {@link withVeryfrontCloudCatalogScope}
 * names, and undefined outside it.
 */
export function peekVeryfrontCloudCatalog(
  scope?: VeryfrontCloudCatalogScope | VeryfrontCloudCatalogScopeKey,
): VeryfrontCloudCatalog | undefined {
  if (seeded) return seeded;
  const key = scope ? keyOf(scope) : activeKey;
  if (key === undefined) return undefined;
  const handedOver = received.get(key);
  if (handedOver) return handedOver;
  const entry = entries.get(key);
  if (!entry) return undefined;
  touchEntry(key, entry);
  return entry.catalog;
}

/**
 * @internal Keep catalog rows a trusted peer loaded for credentials this
 * process does not hold, and return the key that names them. The key is
 * random and names no credential; reads under it see these rows until
 * {@link forgetReceivedVeryfrontCloudCatalog}.
 */
export function rememberReceivedVeryfrontCloudCatalog(
  models: readonly VeryfrontCloudCatalogModel[],
): VeryfrontCloudCatalogScopeKey {
  const key = `${RECEIVED_KEY_PREFIX}${crypto.randomUUID()}`;
  received.set(
    key,
    Object.freeze({
      models: Object.freeze(models.map((model) =>
        Object.freeze({
          ...model,
          aliases: Object.freeze([...model.aliases]),
          ...(model.operations ? { operations: Object.freeze([...model.operations]) } : {}),
          ...(model.supportedProviderTools
            ? { supportedProviderTools: Object.freeze([...model.supportedProviderTools]) }
            : {}),
        })
      )),
    }),
  );
  // Bounded even if a receiver never forgets: the oldest goes first. Unlike the
  // cache there is no load in flight to protect: each executor session keeps
  // at most one received catalog and forgets it on cleanup, and a broker pool
  // admits at most as many sessions as this cap. An evicted catalog only makes
  // later reads use protocol defaults.
  for (const oldest of received.keys()) {
    if (received.size <= VERYFRONT_CLOUD_CATALOG_MAX_ENTRIES) break;
    received.delete(oldest);
  }
  return key as VeryfrontCloudCatalogScopeKey;
}

/** @internal Drop a catalog kept by {@link rememberReceivedVeryfrontCloudCatalog}. */
export function forgetReceivedVeryfrontCloudCatalog(key: VeryfrontCloudCatalogScopeKey): void {
  received.delete(key);
}

/** @internal Serve a fixed catalog for every key, as if freshly loaded. `undefined` clears it. */
export function __setVeryfrontCloudCatalogForTests(payload: unknown): void {
  seeded = payload === undefined ? undefined : parseVeryfrontCloudCatalog(payload);
}

/** @internal Store a catalog for one scope, as if it had just loaded for it. */
export function __setVeryfrontCloudCatalogForScopeForTests(
  scope: VeryfrontCloudCatalogScope,
  payload: unknown,
): void {
  const catalog = parseVeryfrontCloudCatalog(payload);
  if (!catalog) throw new TypeError("Test catalog payload has no model list");
  rememberEntry(cacheKey(scope), { catalog, fetchedAt: now() });
}

/** @internal How many catalogs and recorded failures the cache holds. */
export function __veryfrontCloudCatalogSizesForTests(): { entries: number; failures: number } {
  return { entries: entries.size, failures: failedAt.size };
}

/** @internal Forget every loaded catalog, pending load and failure. */
export function __resetVeryfrontCloudCatalogForTests(): void {
  generation++;
  entries.clear();
  inflight.clear();
  failedAt.clear();
  received.clear();
  activeKey = undefined;
  seeded = undefined;
  loggedFailures.clear();
  now = Date.now;
}

/** @internal Replace the clock the cache reads. */
export function __setVeryfrontCloudCatalogClockForTests(clock: () => number): void {
  now = clock;
}

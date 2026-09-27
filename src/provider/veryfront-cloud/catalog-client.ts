/**
 * Client for the model catalog Veryfront Cloud serves at `<api>/ai/models`.
 *
 * Model facts (wire protocol, operations, thinking defaults and transport
 * capabilities) come from the served catalog, not from a table shipped in this
 * package. Loading is asynchronous and happens on the first async step of a
 * model call; every synchronous reader uses {@link peekVeryfrontCloudCatalog}
 * and degrades when nothing is loaded yet.
 *
 * - Entries are cached per API base URL and project, because the served list
 *   is filtered by project policy.
 * - Concurrent loads for one key share a single request.
 * - An entry is fresh for {@link VERYFRONT_CLOUD_CATALOG_TTL_MS}. A stale entry
 *   is returned at once while one refresh runs in the background, and it is
 *   kept when that refresh fails.
 * - A failed load never throws. It is logged once and retried after
 *   {@link VERYFRONT_CLOUD_CATALOG_RETRY_MS}.
 */
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";

/** How long a loaded catalog is used before it is refreshed. */
export const VERYFRONT_CLOUD_CATALOG_TTL_MS = 5 * 60_000;
/** How long a failed load waits before the next attempt for the same key. */
export const VERYFRONT_CLOUD_CATALOG_RETRY_MS = 30_000;
/** Upper bound on one catalog request. */
const VERYFRONT_CLOUD_CATALOG_TIMEOUT_MS = 10_000;
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

/** Credentials and scope a catalog load uses: the same ones inference uses. */
export interface VeryfrontCloudCatalogLoadOptions {
  readonly apiBaseUrl: string;
  readonly apiToken: string;
  readonly projectSlug?: string;
  readonly signal?: AbortSignal;
}

interface CatalogEntry {
  catalog: VeryfrontCloudCatalog;
  fetchedAt: number;
}

const entries = new Map<string, CatalogEntry>();
const inflight = new Map<string, Promise<VeryfrontCloudCatalog | undefined>>();
const failedAt = new Map<string, number>();
let latest: VeryfrontCloudCatalog | undefined;
let seeded: VeryfrontCloudCatalog | undefined;
let failureLogged = false;
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

function cacheKey(apiBaseUrl: string, projectSlug: string | undefined): string {
  return `${apiBaseUrl}\n${projectSlug ?? ""}`;
}

function catalogUrl(apiBaseUrl: string): string {
  const url = new URL(apiBaseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${VERYFRONT_CLOUD_CATALOG_PATH}`;
  url.hash = "";
  url.search = "";
  return url.toString();
}

async function fetchCatalog(
  options: VeryfrontCloudCatalogLoadOptions,
): Promise<VeryfrontCloudCatalog> {
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${options.apiToken}`,
  });
  if (options.projectSlug) headers.set("x-veryfront-project-slug", options.projectSlug);
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), VERYFRONT_CLOUD_CATALOG_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;
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
  options: VeryfrontCloudCatalogLoadOptions,
): Promise<VeryfrontCloudCatalog | undefined> {
  const pending = inflight.get(key);
  if (pending) return pending;
  const started = generation;
  const request = fetchCatalog(options).then(
    (catalog) => {
      if (started !== generation) return catalog;
      entries.set(key, { catalog, fetchedAt: now() });
      failedAt.delete(key);
      latest = catalog;
      failureLogged = false;
      return catalog;
    },
    (error: unknown) => {
      if (started !== generation) return undefined;
      failedAt.set(key, now());
      if (!failureLogged) {
        failureLogged = true;
        logger.warn(
          "Veryfront Cloud model catalog is unavailable; model facts fall back to protocol defaults",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
      return entries.get(key)?.catalog;
    },
  ).finally(() => {
    if (started === generation) inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

/**
 * Load the served catalog for an API base URL and project. Resolves to the
 * cached catalog when it is fresh, to a stale one while a refresh runs, and to
 * undefined when no catalog could be loaded. Never rejects.
 */
export function loadVeryfrontCloudCatalog(
  options: VeryfrontCloudCatalogLoadOptions,
): Promise<VeryfrontCloudCatalog | undefined> {
  if (seeded) return Promise.resolve(seeded);
  const key = cacheKey(options.apiBaseUrl, options.projectSlug);
  const entry = entries.get(key);
  const current = now();
  if (entry && current - entry.fetchedAt < VERYFRONT_CLOUD_CATALOG_TTL_MS) {
    return Promise.resolve(entry.catalog);
  }
  const lastFailure = failedAt.get(key);
  if (lastFailure !== undefined && current - lastFailure < VERYFRONT_CLOUD_CATALOG_RETRY_MS) {
    return Promise.resolve(entry?.catalog);
  }
  const request = refresh(key, options);
  // Stale while revalidate: the stale entry answers now, the refresh replaces it.
  return entry ? Promise.resolve(entry.catalog) : request;
}

/** Whether a load for these credentials would answer from a fresh cache entry, without a request. */
export function isVeryfrontCloudCatalogFresh(
  options: Pick<VeryfrontCloudCatalogLoadOptions, "apiBaseUrl" | "projectSlug">,
): boolean {
  if (seeded) return true;
  const entry = entries.get(cacheKey(options.apiBaseUrl, options.projectSlug));
  return entry !== undefined && now() - entry.fetchedAt < VERYFRONT_CLOUD_CATALOG_TTL_MS;
}

/** The most recently loaded catalog, stale or not, or undefined before any load. */
export function peekVeryfrontCloudCatalog(): VeryfrontCloudCatalog | undefined {
  return seeded ?? latest;
}

/** @internal Serve a fixed catalog for every key, as if freshly loaded. `undefined` clears it. */
export function __setVeryfrontCloudCatalogForTests(payload: unknown): void {
  seeded = payload === undefined ? undefined : parseVeryfrontCloudCatalog(payload);
}

/** @internal Forget every loaded catalog, pending load and failure. */
export function __resetVeryfrontCloudCatalogForTests(): void {
  generation++;
  entries.clear();
  inflight.clear();
  failedAt.clear();
  latest = undefined;
  seeded = undefined;
  failureLogged = false;
  now = Date.now;
}

/** @internal Replace the clock the cache reads. */
export function __setVeryfrontCloudCatalogClockForTests(clock: () => number): void {
  now = clock;
}

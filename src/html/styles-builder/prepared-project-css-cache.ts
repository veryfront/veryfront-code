import {
  type CacheBackend,
  createCacheBackend,
  readCacheValueWithinLimit,
} from "#veryfront/cache/backend.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { assertCSSPipelineIdentity, assertStyleProfileHash, serverLogger } from "#veryfront/utils";
import { assertCSSOutputContent } from "#veryfront/utils/css-content-admission.ts";
import { assertCSSContentIdentity, hashCSS, hashString, isCSSContentHash } from "./css-identity.ts";
import {
  assertCSSSerializedCacheValue,
  ByteWeightedLRUCache,
  detachRetainedString,
  estimateRetainedStringBytes,
  MAX_PREPARED_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
  serializeCSSCacheValue,
} from "./css-cache-limits.ts";
import { preflightSerializedCSSCacheFrame, readOwnDataProperty } from "./css-compiler-utils.ts";

const logger = serverLogger.component("prepared-project-css-cache");

interface PreparedProjectCSSCacheEntry {
  css: string;
  hash: string;
}

interface PreparedProjectCSSLocalEntry extends PreparedProjectCSSCacheEntry {
  expiresAt: number;
}

interface PreparedProjectCSSProfile {
  cssPipelineIdentity: string;
  minify?: boolean;
  environment?: string;
  buildMode?: "development" | "production";
}

export interface PreparedProjectCSSRequestContext {
  projectSlug: string;
  projectVersion: string;
  stylesheet: string;
  stylesheetHash: string;
  styleProfileHash: string;
  environment: string;
  profileHash: string;
  cacheKey: string;
}

const PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS = 24 * 3600;
const PREPARED_PROJECT_CSS_LOCAL_MAX = 50;
const PREPARED_PROJECT_CSS_LOCAL_MAX_RETAINED_BYTES = 32 * 1024 * 1024;
const PREPARED_PROJECT_CSS_LOCAL_MAX_ENTRY_RETAINED_BYTES = 16 * 1024 * 1024;
const PREPARED_PROJECT_CSS_LOCAL_ENTRY_OVERHEAD_BYTES = 144;
const PREPARED_PROJECT_CSS_LOCAL_TTL_MS = PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS * 1000;
const PREPARED_PROJECT_CSS_CACHE_SCHEMA = "v3";

let preparedProjectCSSBackend: CacheBackend | null = null;
let preparedProjectCSSInitialized = false;
let preparedProjectCSSInitPromise: Promise<void> | null = null;

const localPreparedProjectCSS = new ByteWeightedLRUCache<string, PreparedProjectCSSLocalEntry>({
  maxEntries: PREPARED_PROJECT_CSS_LOCAL_MAX,
  maxEntrySizeBytes: PREPARED_PROJECT_CSS_LOCAL_MAX_ENTRY_RETAINED_BYTES,
  maxSizeBytes: PREPARED_PROJECT_CSS_LOCAL_MAX_RETAINED_BYTES,
});

registerCache("prepared-project-css-cache", () => ({
  name: "prepared-project-css-cache",
  entries: localPreparedProjectCSS.size,
  maxEntries: PREPARED_PROJECT_CSS_LOCAL_MAX,
  estimatedSizeBytes: localPreparedProjectCSS.sizeBytes,
  backend: preparedProjectCSSBackend?.type ?? "uninitialized",
}));

function setLocalEntry(key: string, entry: PreparedProjectCSSCacheEntry): void {
  assertCSSOutputContent(entry.css, "Cached prepared CSS output");
  const preflightRetainedBytes = PREPARED_PROJECT_CSS_LOCAL_ENTRY_OVERHEAD_BYTES +
    estimateRetainedStringBytes(key) + estimateRetainedStringBytes(entry.css) +
    estimateRetainedStringBytes(entry.hash);
  if (
    preflightRetainedBytes > PREPARED_PROJECT_CSS_LOCAL_MAX_ENTRY_RETAINED_BYTES ||
    preflightRetainedBytes > PREPARED_PROJECT_CSS_LOCAL_MAX_RETAINED_BYTES
  ) {
    localPreparedProjectCSS.delete(key);
    return;
  }
  const localEntry = Object.freeze({
    css: detachRetainedString(entry.css),
    hash: detachRetainedString(entry.hash),
    expiresAt: Date.now() + PREPARED_PROJECT_CSS_LOCAL_TTL_MS,
  });
  const retainedKey = detachRetainedString(key);
  const retainedBytes = PREPARED_PROJECT_CSS_LOCAL_ENTRY_OVERHEAD_BYTES +
    estimateRetainedStringBytes(retainedKey) + estimateRetainedStringBytes(localEntry.css) +
    estimateRetainedStringBytes(localEntry.hash);
  localPreparedProjectCSS.set(retainedKey, localEntry, retainedBytes);
}

function parsePreparedProjectCSSCacheEntry(
  raw: string,
): PreparedProjectCSSCacheEntry | null {
  assertCSSSerializedCacheValue(raw, MAX_PREPARED_CSS_SERIALIZED_CACHE_ENTRY_BYTES);
  if (!preflightSerializedCSSCacheFrame(raw, "prepared")) return null;
  let parsed: Partial<PreparedProjectCSSCacheEntry>;
  try {
    parsed = JSON.parse(raw) as Partial<PreparedProjectCSSCacheEntry>;
  } catch {
    return null;
  }
  const css = readOwnDataProperty(parsed, "css");
  const hash = readOwnDataProperty(parsed, "hash");
  if (typeof css !== "string" || !isCSSContentHash(hash)) return null;
  assertCSSOutputContent(css, "Cached prepared CSS output");
  if (hashCSS(css) !== hash) return null;
  return { css, hash };
}

export async function initializePreparedProjectCSSCache(): Promise<boolean> {
  if (preparedProjectCSSInitialized) return preparedProjectCSSBackend?.type !== "memory";

  if (!preparedProjectCSSInitPromise) {
    preparedProjectCSSInitPromise = (async () => {
      preparedProjectCSSBackend = await createCacheBackend({
        keyPrefix: "prepared-project-css",
      });
      preparedProjectCSSInitialized = true;
      logger.debug("Initialized", { backend: preparedProjectCSSBackend.type });
    })();
  }

  const pending = preparedProjectCSSInitPromise;
  try {
    await pending;
  } finally {
    if (preparedProjectCSSInitPromise === pending) preparedProjectCSSInitPromise = null;
  }

  return preparedProjectCSSBackend?.type !== "memory";
}

export function createPreparedProjectCSSContext(
  projectSlug: string,
  projectVersion: string,
  stylesheet: string,
  styleProfileHash: string,
  profile: PreparedProjectCSSProfile,
): PreparedProjectCSSRequestContext {
  const capturedStyleProfileHash = assertStyleProfileHash(styleProfileHash);
  const cssPipelineIdentity = assertCSSPipelineIdentity(profile.cssPipelineIdentity);
  if (typeof stylesheet !== "string") {
    throw new TypeError("Prepared CSS request context requires a resolved stylesheet");
  }
  assertCSSOutputContent(stylesheet, "Prepared CSS stylesheet");

  const stylesheetHash = hashString(stylesheet);
  const projectVersionHash = hashString(projectVersion);
  const environment = profile.environment ?? "preview";
  const profileHash = hashString(
    JSON.stringify({
      cacheSchema: PREPARED_PROJECT_CSS_CACHE_SCHEMA,
      cssPipelineIdentity,
      minify: profile.minify ?? false,
      buildMode: profile.buildMode ?? "production",
      environment,
    }),
  );

  return {
    projectSlug,
    projectVersion,
    stylesheet,
    stylesheetHash,
    styleProfileHash: capturedStyleProfileHash,
    environment,
    profileHash,
    cacheKey:
      `${projectSlug}:${environment}:prepared:${PREPARED_PROJECT_CSS_CACHE_SCHEMA}:${projectVersionHash}:${stylesheetHash}:${capturedStyleProfileHash}:${profileHash}`,
  };
}

export async function tryGetPreparedProjectCSS(
  context: PreparedProjectCSSRequestContext,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  const local = localPreparedProjectCSS.get(context.cacheKey);
  if (local && local.expiresAt > Date.now()) {
    assertCSSOutputContent(local.css, "Cached prepared CSS output");
    return { css: local.css, hash: local.hash, fromCache: true };
  }

  if (local) {
    localPreparedProjectCSS.delete(context.cacheKey);
  }

  if (!preparedProjectCSSInitialized) {
    await initializePreparedProjectCSSCache();
  }

  if (!preparedProjectCSSBackend) return undefined;

  let raw: string | null;
  try {
    raw = await readCacheValueWithinLimit(
      preparedProjectCSSBackend,
      context.cacheKey,
      MAX_PREPARED_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
    );
  } catch (error) {
    logger.debug("Failed to read prepared project CSS", {
      cacheKey: context.cacheKey,
      error,
    });
    return undefined;
  }
  if (!raw) return undefined;

  const entry = parsePreparedProjectCSSCacheEntry(raw);
  if (!entry) return undefined;

  setLocalEntry(context.cacheKey, entry);
  return { css: entry.css, hash: entry.hash, fromCache: true };
}

export async function storePreparedProjectCSS(
  context: PreparedProjectCSSRequestContext,
  entry: PreparedProjectCSSCacheEntry,
): Promise<void> {
  const cacheKey = context.cacheKey;
  const capturedEntry = Object.freeze({
    css: entry.css,
    hash: entry.hash,
  });
  assertCSSOutputContent(capturedEntry.css, "Cached prepared CSS output");
  assertCSSContentIdentity(capturedEntry.css, capturedEntry.hash);

  if (!preparedProjectCSSInitialized) {
    await initializePreparedProjectCSSCache();
  }

  setLocalEntry(cacheKey, capturedEntry);

  if (!preparedProjectCSSBackend) return;

  const backend = preparedProjectCSSBackend;
  void Promise.resolve()
    .then(() =>
      backend.set(
        cacheKey,
        serializeCSSCacheValue(capturedEntry, MAX_PREPARED_CSS_SERIALIZED_CACHE_ENTRY_BYTES),
        PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS,
      )
    )
    .catch((error) => {
      logger.debug("Failed to store prepared project CSS", {
        cacheKey,
        error,
      });
    });
}

export function invalidatePreparedProjectCSS(projectSlug: string): void {
  void invalidatePreparedProjectCSSAsync(projectSlug).catch((error) => {
    logger.debug("Failed to invalidate prepared project CSS", { projectSlug, error });
  });
}

/** Clear local and distributed prepared CSS, propagating backend failures. */
export async function invalidatePreparedProjectCSSAsync(projectSlug: string): Promise<void> {
  for (const key of localPreparedProjectCSS.keys()) {
    if (key.startsWith(`${projectSlug}:`)) {
      localPreparedProjectCSS.delete(key);
    }
  }

  if (!preparedProjectCSSBackend?.delByPattern) return;
  await preparedProjectCSSBackend.delByPattern(`${projectSlug}:*`);
}

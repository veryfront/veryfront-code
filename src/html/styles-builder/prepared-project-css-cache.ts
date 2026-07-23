import {
  type CacheBackend,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { serverLogger } from "#veryfront/utils";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import { DEFAULT_STYLESHEET } from "./css-hash-cache.ts";
import { hashString } from "./candidate-extractor.ts";
import { resolveStylesheet } from "./tailwind-compiler-utils.ts";
import { TAILWIND_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  MAX_GENERATED_CSS_BYTES,
  MAX_LOCAL_PREPARED_CSS_CACHE_BYTES,
  MAX_STYLESHEET_BYTES,
  utf8ByteLength,
} from "./resource-limits.ts";

const logger = serverLogger.component("prepared-project-css-cache");

interface PreparedProjectCSSCacheEntry {
  css: string;
  hash: string;
}

interface PreparedProjectCSSLocalEntry extends PreparedProjectCSSCacheEntry {
  expiresAt: number;
}

interface PreparedProjectCSSProfile {
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
const PREPARED_PROJECT_CSS_LOCAL_TTL_MS = PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS * 1000;
const MAX_SERIALIZED_ENTRY_BYTES = MAX_GENERATED_CSS_BYTES + 4096;
const PROJECT_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ENVIRONMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

let preparedProjectCSSBackend: CacheBackend | null = null;
let preparedProjectCSSInitialized = false;
let preparedProjectCSSInitPromise: Promise<void> | null = null;

const localPreparedProjectCSS = new LRUCache<string, PreparedProjectCSSLocalEntry>({
  maxEntries: PREPARED_PROJECT_CSS_LOCAL_MAX,
  maxSizeBytes: MAX_LOCAL_PREPARED_CSS_CACHE_BYTES,
});

registerCache("prepared-project-css-cache", () => ({
  name: "prepared-project-css-cache",
  entries: localPreparedProjectCSS.size,
  maxEntries: PREPARED_PROJECT_CSS_LOCAL_MAX,
  backend: preparedProjectCSSBackend?.type ?? "uninitialized",
}));

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function assertPreparedContextInput(
  projectSlug: string,
  projectVersion: string,
  stylesheet: string,
  styleProfileHash: string,
  environment: string,
): void {
  if (!PROJECT_SLUG_PATTERN.test(projectSlug)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid project slug" });
  }
  if (
    projectVersion.length === 0 || projectVersion.length > 512 ||
    hasControlCharacter(projectVersion)
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid project version" });
  }
  if (
    styleProfileHash.length === 0 || styleProfileHash.length > 128 ||
    hasControlCharacter(styleProfileHash)
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid style profile hash" });
  }
  if (!ENVIRONMENT_PATTERN.test(environment)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid CSS environment" });
  }
  if (utf8ByteLength(stylesheet) > MAX_STYLESHEET_BYTES) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Stylesheet exceeds the 2 MiB size limit" });
  }
}

function validPreparedEntry(entry: PreparedProjectCSSCacheEntry): boolean {
  return utf8ByteLength(entry.css) <= MAX_GENERATED_CSS_BYTES &&
    /^[A-Za-z0-9_-]{1,128}$/.test(entry.hash);
}

function setLocalEntry(key: string, entry: PreparedProjectCSSCacheEntry): void {
  localPreparedProjectCSS.set(key, {
    ...entry,
    expiresAt: Date.now() + PREPARED_PROJECT_CSS_LOCAL_TTL_MS,
  });
}

function parsePreparedProjectCSSCacheEntry(
  raw: string,
): PreparedProjectCSSCacheEntry | null {
  if (utf8ByteLength(raw) > MAX_SERIALIZED_ENTRY_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PreparedProjectCSSCacheEntry>;
    if (typeof parsed.css !== "string" || typeof parsed.hash !== "string") return null;
    const entry = { css: parsed.css, hash: parsed.hash };
    return validPreparedEntry(entry) ? entry : null;
  } catch {
    return null;
  }
}

export async function initializePreparedProjectCSSCache(): Promise<boolean> {
  if (preparedProjectCSSInitialized) return preparedProjectCSSBackend?.type !== "memory";

  if (!preparedProjectCSSInitPromise) {
    preparedProjectCSSInitPromise = (async () => {
      try {
        preparedProjectCSSBackend = await createCacheBackend({
          keyPrefix: "prepared-project-css",
        });
        logger.debug("Initialized", { backend: preparedProjectCSSBackend.type });
      } catch (error) {
        logger.warn("Backend init failed, using memory", { error: errorName(error) });
        preparedProjectCSSBackend = new MemoryCacheBackend(PREPARED_PROJECT_CSS_LOCAL_MAX);
      } finally {
        preparedProjectCSSInitialized = true;
      }
    })();
  }

  await preparedProjectCSSInitPromise;
  preparedProjectCSSInitPromise = null;

  return preparedProjectCSSBackend?.type !== "memory";
}

export function createPreparedProjectCSSContext(
  projectSlug: string,
  projectVersion: string,
  stylesheet: string | undefined,
  styleProfileHash: string,
  profile?: PreparedProjectCSSProfile,
): PreparedProjectCSSRequestContext {
  const resolvedStylesheet = resolveStylesheet(stylesheet, DEFAULT_STYLESHEET);
  const environment = profile?.environment ?? "preview";
  assertPreparedContextInput(
    projectSlug,
    projectVersion,
    resolvedStylesheet,
    styleProfileHash,
    environment,
  );
  const stylesheetHash = hashString(resolvedStylesheet);
  const profileHash = hashString(
    JSON.stringify({
      cacheSchema: "v3",
      tailwindVersion: TAILWIND_VERSION,
      minify: profile?.minify ?? false,
      buildMode: profile?.buildMode ?? "production",
      environment,
    }),
  );

  return {
    projectSlug,
    projectVersion,
    stylesheet: resolvedStylesheet,
    stylesheetHash,
    styleProfileHash,
    environment,
    profileHash,
    cacheKey: `${projectSlug}:${environment}:prepared:${
      hashString(projectVersion)
    }:${stylesheetHash}:${hashString(styleProfileHash)}:${profileHash}`,
  };
}

export async function tryGetPreparedProjectCSS(
  context: PreparedProjectCSSRequestContext,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  const local = localPreparedProjectCSS.get(context.cacheKey);
  if (local && local.expiresAt > Date.now()) {
    return { css: local.css, hash: local.hash, fromCache: true };
  }

  if (local) {
    localPreparedProjectCSS.delete(context.cacheKey);
  }

  if (!preparedProjectCSSInitialized) {
    await initializePreparedProjectCSSCache();
  }

  if (!preparedProjectCSSBackend) return undefined;

  try {
    const raw = await preparedProjectCSSBackend.get(context.cacheKey);
    if (!raw) return undefined;

    const entry = parsePreparedProjectCSSCacheEntry(raw);
    if (!entry) return undefined;

    setLocalEntry(context.cacheKey, entry);
    return { css: entry.css, hash: entry.hash, fromCache: true };
  } catch (error) {
    logger.debug("Failed to read prepared project CSS", {
      error: errorName(error),
    });
    return undefined;
  }
}

export async function storePreparedProjectCSS(
  context: PreparedProjectCSSRequestContext,
  entry: PreparedProjectCSSCacheEntry,
): Promise<void> {
  if (!validPreparedEntry(entry)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid prepared project CSS entry" });
  }
  if (!preparedProjectCSSInitialized) {
    await initializePreparedProjectCSSCache();
  }

  setLocalEntry(context.cacheKey, entry);

  if (!preparedProjectCSSBackend) return;

  try {
    await preparedProjectCSSBackend.set(
      context.cacheKey,
      JSON.stringify(entry),
      PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.debug("Failed to store prepared project CSS", { error: errorName(error) });
  }
}

export function invalidatePreparedProjectCSS(projectSlug: string): void {
  if (!PROJECT_SLUG_PATTERN.test(projectSlug)) return;
  for (const key of localPreparedProjectCSS.keys()) {
    if (key.startsWith(`${projectSlug}:`)) {
      localPreparedProjectCSS.delete(key);
    }
  }

  invalidatePreparedProjectCSSAsync(projectSlug).catch((error) => {
    logger.debug("Failed to invalidate prepared project CSS", { error: errorName(error) });
  });
}

export async function invalidatePreparedProjectCSSAsync(projectSlug: string): Promise<void> {
  if (!PROJECT_SLUG_PATTERN.test(projectSlug)) return;
  if (!preparedProjectCSSBackend?.delByPattern) return;

  try {
    await preparedProjectCSSBackend.delByPattern(`${projectSlug}:*`);
  } catch (error) {
    logger.debug("Failed to delete prepared project CSS", { error: errorName(error) });
  }
}

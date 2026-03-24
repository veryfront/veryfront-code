import {
  type CacheBackend,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { serverLogger } from "#veryfront/utils";
import { DEFAULT_STYLESHEET } from "./css-hash-cache.ts";
import { resolveStylesheet } from "./tailwind-compiler-utils.ts";

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

let preparedProjectCSSBackend: CacheBackend | null = null;
let preparedProjectCSSInitialized = false;
let preparedProjectCSSInitPromise: Promise<void> | null = null;

const localPreparedProjectCSS = new Map<string, PreparedProjectCSSLocalEntry>();

registerCache("prepared-project-css-cache", () => ({
  name: "prepared-project-css-cache",
  entries: localPreparedProjectCSS.size,
  maxEntries: PREPARED_PROJECT_CSS_LOCAL_MAX,
  backend: preparedProjectCSSBackend?.type ?? "uninitialized",
}));

function hashValue(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return hash.toString(36);
}

function setLocalEntry(key: string, entry: PreparedProjectCSSCacheEntry): void {
  localPreparedProjectCSS.set(key, {
    ...entry,
    expiresAt: Date.now() + PREPARED_PROJECT_CSS_LOCAL_TTL_MS,
  });

  if (localPreparedProjectCSS.size <= PREPARED_PROJECT_CSS_LOCAL_MAX) return;

  const keys = localPreparedProjectCSS.keys();
  while (localPreparedProjectCSS.size > PREPARED_PROJECT_CSS_LOCAL_MAX) {
    const result = keys.next();
    if (result.done) break;
    localPreparedProjectCSS.delete(result.value);
  }
}

function parsePreparedProjectCSSCacheEntry(
  raw: string,
): PreparedProjectCSSCacheEntry | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PreparedProjectCSSCacheEntry>;
    if (typeof parsed.css !== "string" || typeof parsed.hash !== "string") return null;
    return { css: parsed.css, hash: parsed.hash };
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
        logger.warn("Backend init failed, using memory", { error });
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
  const stylesheetHash = hashValue(resolvedStylesheet);
  const environment = profile?.environment ?? "preview";
  const profileHash = hashValue(
    JSON.stringify({
      cacheSchema: "v1",
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
    cacheKey:
      `${projectSlug}:${environment}:prepared:${projectVersion}:${stylesheetHash}:${styleProfileHash}:${profileHash}`,
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
      cacheKey: context.cacheKey,
      error,
    });
    return undefined;
  }
}

export async function storePreparedProjectCSS(
  context: PreparedProjectCSSRequestContext,
  entry: PreparedProjectCSSCacheEntry,
): Promise<void> {
  if (!preparedProjectCSSInitialized) {
    await initializePreparedProjectCSSCache();
  }

  setLocalEntry(context.cacheKey, entry);

  if (!preparedProjectCSSBackend) return;

  preparedProjectCSSBackend
    .set(context.cacheKey, JSON.stringify(entry), PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS)
    .catch((error) => {
      logger.debug("Failed to store prepared project CSS", {
        cacheKey: context.cacheKey,
        error,
      });
    });
}

export function invalidatePreparedProjectCSS(projectSlug: string): void {
  for (const key of localPreparedProjectCSS.keys()) {
    if (key.startsWith(`${projectSlug}:`)) {
      localPreparedProjectCSS.delete(key);
    }
  }

  invalidatePreparedProjectCSSAsync(projectSlug).catch((error) => {
    logger.debug("Failed to invalidate prepared project CSS", { projectSlug, error });
  });
}

export async function invalidatePreparedProjectCSSAsync(projectSlug: string): Promise<void> {
  if (!preparedProjectCSSBackend?.delByPattern) return;

  try {
    await preparedProjectCSSBackend.delByPattern(`${projectSlug}:*`);
  } catch (error) {
    logger.debug("Failed to delete prepared project CSS", { projectSlug, error });
  }
}

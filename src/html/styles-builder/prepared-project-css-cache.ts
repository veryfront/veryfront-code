import { type CacheBackend, createCacheBackend } from "#veryfront/cache/backend.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { assertCSSPipelineIdentity, assertStyleProfileHash, serverLogger } from "#veryfront/utils";
import { assertCSSContentIdentity, hashCSS, hashString, isCSSContentHash } from "./css-identity.ts";

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
const PREPARED_PROJECT_CSS_LOCAL_TTL_MS = PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS * 1000;
const PREPARED_PROJECT_CSS_CACHE_SCHEMA = "v3";

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
    if (
      typeof parsed.css !== "string" ||
      !isCSSContentHash(parsed.hash) ||
      hashCSS(parsed.css) !== parsed.hash
    ) return null;
    return { css: parsed.css, hash: parsed.hash };
  } catch {
    return null;
  }
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
  assertCSSContentIdentity(entry.css, entry.hash);

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

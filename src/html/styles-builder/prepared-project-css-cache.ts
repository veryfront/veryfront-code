import { type CacheBackend, createCacheBackend } from "#veryfront/cache/backend.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { assertCSSPipelineIdentity, assertStyleProfileHash, serverLogger } from "#veryfront/utils";
import {
  assertCSSFileContent,
  assertCSSOutputContent,
} from "#veryfront/utils/css-content-admission.ts";
import {
  detachRetainedString,
  estimateRetainedStringBytes,
} from "#veryfront/utils/retained-string.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { assertCSSContentIdentity, hashString, isCSSContentHash } from "./css-identity.ts";

const logger = serverLogger.component("prepared-project-css-cache");

interface PreparedProjectCSSCacheEntry {
  css: string;
  hash: string;
}

interface PreparedProjectCSSLocalEntry extends PreparedProjectCSSCacheEntry {
  expiresAt: number;
  retainedBytes: number;
}

interface PreparedProjectCSSProfile {
  cssPipelineIdentity: string;
  candidatesHash: string;
  minify?: boolean;
  environment?: string;
  buildMode?: "development" | "production";
}

export interface PreparedProjectCSSRequestContext {
  projectSlug: string;
  projectVersion: string;
  stylesheet: string;
  stylesheetHash: string;
  candidatesHash: string;
  styleProfileHash: string;
  environment: string;
  profileHash: string;
  cacheKey: string;
  cacheEpoch: number;
}

const PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS = 24 * 3600;
const PREPARED_PROJECT_CSS_CACHE_SCHEMA = "v3";
const PREPARED_PROJECT_CSS_LOCAL_MAX = 50;
const PREPARED_PROJECT_CSS_LOCAL_MAX_BYTES = 64 * 1024 * 1024;
const PREPARED_PROJECT_CSS_LOCAL_TTL_MS = PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS * 1000;

let preparedProjectCSSBackend: CacheBackend | null = null;
let preparedProjectCSSInitialized = false;
let preparedProjectCSSInitPromise: Promise<void> | null = null;

const localPreparedProjectCSS = new Map<string, PreparedProjectCSSLocalEntry>();
let localPreparedProjectCSSBytes = 0;
let preparedProjectCSSCacheEpoch = 0;

registerCache("prepared-project-css-cache", () => ({
  name: "prepared-project-css-cache",
  entries: localPreparedProjectCSS.size,
  maxEntries: PREPARED_PROJECT_CSS_LOCAL_MAX,
  estimatedSizeBytes: localPreparedProjectCSSBytes,
  backend: preparedProjectCSSBackend?.type ?? "uninitialized",
}));

function estimateLocalEntryBytes(key: string, entry: PreparedProjectCSSCacheEntry): number {
  return estimateRetainedStringBytes(key) + estimateRetainedStringBytes(entry.css) +
    estimateRetainedStringBytes(entry.hash) + 128;
}

function removeLocalEntry(key: string): void {
  const existing = localPreparedProjectCSS.get(key);
  if (!existing) return;
  localPreparedProjectCSS.delete(key);
  localPreparedProjectCSSBytes -= existing.retainedBytes;
}

function setLocalEntry(key: string, entry: PreparedProjectCSSCacheEntry): void {
  assertCSSOutputContent(entry.css, "Cached prepared CSS output");
  assertCSSContentIdentity(entry.css, entry.hash);
  const retainedKey = detachRetainedString(key);
  const retainedEntry = {
    css: detachRetainedString(entry.css),
    hash: detachRetainedString(entry.hash),
  };
  const retainedBytes = estimateLocalEntryBytes(retainedKey, retainedEntry);
  removeLocalEntry(key);
  while (
    localPreparedProjectCSS.size >= PREPARED_PROJECT_CSS_LOCAL_MAX ||
    localPreparedProjectCSSBytes + retainedBytes > PREPARED_PROJECT_CSS_LOCAL_MAX_BYTES
  ) {
    const oldestKey = localPreparedProjectCSS.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    removeLocalEntry(oldestKey);
  }
  if (retainedBytes > PREPARED_PROJECT_CSS_LOCAL_MAX_BYTES) return;
  localPreparedProjectCSS.set(retainedKey, {
    css: retainedEntry.css,
    hash: retainedEntry.hash,
    expiresAt: Date.now() + PREPARED_PROJECT_CSS_LOCAL_TTL_MS,
    retainedBytes,
  });
  localPreparedProjectCSSBytes += retainedBytes;
}

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function parsePreparedProjectCSSCacheEntry(
  raw: string,
): PreparedProjectCSSCacheEntry | null {
  try {
    if (
      utf8ByteLength(raw, PREPARED_PROJECT_CSS_LOCAL_MAX_BYTES) >
        PREPARED_PROJECT_CSS_LOCAL_MAX_BYTES
    ) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const css = readOwnDataProperty(parsed, "css");
    const hash = readOwnDataProperty(parsed, "hash");
    if (typeof css !== "string" || !isCSSContentHash(hash)) return null;
    assertCSSOutputContent(css, "Cached prepared CSS output");
    assertCSSContentIdentity(css, hash);
    return { css, hash };
  } catch {
    return null;
  }
}

export async function initializePreparedProjectCSSCache(): Promise<boolean> {
  if (preparedProjectCSSInitialized) {
    return preparedProjectCSSBackend !== null && preparedProjectCSSBackend.type !== "memory";
  }

  if (!preparedProjectCSSInitPromise) {
    preparedProjectCSSInitPromise = (async () => {
      try {
        preparedProjectCSSBackend = await createCacheBackend({
          keyPrefix: "prepared-project-css",
        });
        logger.debug("Initialized", { backend: preparedProjectCSSBackend.type });
      } catch (error) {
        logger.warn("Shared backend unavailable; bounded local cache remains active", { error });
        preparedProjectCSSBackend = null;
      } finally {
        preparedProjectCSSInitialized = true;
      }
    })();
  }

  await preparedProjectCSSInitPromise;
  preparedProjectCSSInitPromise = null;

  return preparedProjectCSSBackend !== null && preparedProjectCSSBackend.type !== "memory";
}

export function createPreparedProjectCSSContext(
  projectSlug: string,
  projectVersion: string,
  stylesheet: string,
  styleProfileHash: string,
  profile: PreparedProjectCSSProfile,
): PreparedProjectCSSRequestContext {
  const capturedProjectSlug = assertCSSPipelineIdentity(
    projectSlug,
    "Prepared CSS project scope",
  );
  const capturedProjectVersion = assertCSSPipelineIdentity(
    projectVersion,
    "Prepared CSS project version",
  );
  const capturedStyleProfileHash = assertStyleProfileHash(styleProfileHash);
  const cssPipelineIdentity = assertCSSPipelineIdentity(profile.cssPipelineIdentity);
  if (!isCSSContentHash(profile.candidatesHash)) {
    throw new TypeError("Prepared CSS candidatesHash must be a full lowercase SHA-256 digest");
  }
  assertCSSFileContent(stylesheet, "Prepared project CSS stylesheet");
  const stylesheetHash = hashString(stylesheet);
  const environment = assertCSSPipelineIdentity(
    profile?.environment ?? "preview",
    "Prepared CSS environment",
  );
  const profileHash = hashString(
    JSON.stringify({
      cacheSchema: PREPARED_PROJECT_CSS_CACHE_SCHEMA,
      cssPipelineIdentity,
      minify: profile?.minify ?? false,
      buildMode: profile?.buildMode ?? "production",
      environment,
    }),
  );
  const preparedIdentityHash = hashString(JSON.stringify([
    capturedProjectVersion,
    stylesheetHash,
    profile.candidatesHash,
    capturedStyleProfileHash,
    profileHash,
  ]));

  return {
    projectSlug: capturedProjectSlug,
    projectVersion: capturedProjectVersion,
    stylesheet,
    stylesheetHash,
    candidatesHash: profile.candidatesHash,
    styleProfileHash: capturedStyleProfileHash,
    environment,
    profileHash,
    cacheKey: getPreparedProjectCSSCacheScopePrefix(capturedProjectSlug) +
      hashString(environment) + ":" + preparedIdentityHash,
    cacheEpoch: preparedProjectCSSCacheEpoch,
  };
}

function getPreparedProjectCSSCacheScopePrefix(projectSlug: string): string {
  return `${PREPARED_PROJECT_CSS_CACHE_SCHEMA}:${hashString(projectSlug)}:`;
}

export async function tryGetPreparedProjectCSS(
  context: PreparedProjectCSSRequestContext,
): Promise<{ css: string; hash: string; fromCache: true } | undefined> {
  if (context.cacheEpoch !== preparedProjectCSSCacheEpoch) return undefined;
  const local = localPreparedProjectCSS.get(context.cacheKey);
  if (local && local.expiresAt > Date.now()) {
    localPreparedProjectCSS.delete(context.cacheKey);
    localPreparedProjectCSS.set(context.cacheKey, local);
    return { css: local.css, hash: local.hash, fromCache: true };
  }

  if (local) {
    removeLocalEntry(context.cacheKey);
  }

  if (!preparedProjectCSSInitialized) {
    await initializePreparedProjectCSSCache();
  }

  if (!preparedProjectCSSBackend) return undefined;

  try {
    const raw = await preparedProjectCSSBackend.get(context.cacheKey);
    if (context.cacheEpoch !== preparedProjectCSSCacheEpoch) return undefined;
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
  if (context.cacheEpoch !== preparedProjectCSSCacheEpoch) return;
  if (!preparedProjectCSSInitialized) {
    await initializePreparedProjectCSSCache();
  }
  if (context.cacheEpoch !== preparedProjectCSSCacheEpoch) return;

  setLocalEntry(context.cacheKey, entry);

  if (!preparedProjectCSSBackend) return;

  try {
    await preparedProjectCSSBackend.set(
      context.cacheKey,
      JSON.stringify(entry),
      PREPARED_PROJECT_CSS_CACHE_TTL_SECONDS,
    );
    if (context.cacheEpoch !== preparedProjectCSSCacheEpoch) {
      removeLocalEntry(context.cacheKey);
      await preparedProjectCSSBackend.del(context.cacheKey);
    }
  } catch (error) {
    logger.debug("Failed to store prepared project CSS", {
      cacheKey: context.cacheKey,
      error,
    });
  }
}

export function invalidatePreparedProjectCSS(projectSlug: string): void {
  const projectPrefix = getPreparedProjectCSSCacheScopePrefix(
    assertCSSPipelineIdentity(projectSlug, "Prepared CSS project scope"),
  );
  preparedProjectCSSCacheEpoch++;
  for (const key of localPreparedProjectCSS.keys()) {
    if (key.startsWith(projectPrefix)) {
      removeLocalEntry(key);
    }
  }

  invalidatePreparedProjectCSSBackend(projectSlug, projectPrefix).catch((error) => {
    logger.debug("Failed to invalidate prepared project CSS", { projectSlug, error });
  });
}

export async function invalidatePreparedProjectCSSAsync(projectSlug: string): Promise<void> {
  const projectPrefix = getPreparedProjectCSSCacheScopePrefix(
    assertCSSPipelineIdentity(projectSlug, "Prepared CSS project scope"),
  );
  preparedProjectCSSCacheEpoch++;
  for (const key of localPreparedProjectCSS.keys()) {
    if (key.startsWith(projectPrefix)) removeLocalEntry(key);
  }
  await invalidatePreparedProjectCSSBackend(projectSlug, projectPrefix);
}

async function invalidatePreparedProjectCSSBackend(
  projectSlug: string,
  projectPrefix: string,
): Promise<void> {
  if (!preparedProjectCSSBackend?.delByPattern) return;
  try {
    await preparedProjectCSSBackend.delByPattern(`${projectPrefix}*`);
  } catch (error) {
    logger.debug("Failed to delete prepared project CSS", { projectSlug, error });
    throw error;
  }
}

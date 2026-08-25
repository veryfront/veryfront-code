/**
 * Content-addressed CSS cache with provider-identified JIT inputs.
 *
 * CSS payloads are keyed by their full SHA-256 identity. Regeneration inputs
 * live in the same versioned entry and are usable only by the exact captured
 * CSS pipeline identity that created them; the former split legacy-input
 * fallback is intentionally unsupported.
 *
 * @module html/styles-builder/css-hash-cache
 */

import { type CacheBackend, createCacheBackend } from "#veryfront/cache/backend.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { assertCSSPipelineIdentity, serverLogger } from "#veryfront/utils";
import { normalizeCSSCandidates } from "#veryfront/utils/css-candidate-admission.ts";
import {
  assertCSSFileContent,
  assertCSSOutputContent,
} from "#veryfront/utils/css-content-admission.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import {
  detachRetainedString,
  estimateRetainedStringBytes,
} from "#veryfront/utils/retained-string.ts";
import { assertCSSContentIdentity, hashCSS, isCSSContentHash } from "./css-identity.ts";

const logger = serverLogger.component("css-cache");
const CSS_CACHE_SCHEMA = "v3";
const CSS_CACHE_TTL_SECONDS = 24 * 3600;
const LOCAL_CACHE_MAX_ENTRIES = 100;
const LOCAL_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const MAX_SERIALIZED_CSS_CACHE_BYTES = 128 * 1024 * 1024;

export interface CSSCacheEntry {
  readonly css: string;
  readonly candidates: readonly string[];
  readonly stylesheet: string;
  readonly pipelineIdentity?: string;
}

export interface CSSRegenerationInputs {
  readonly candidates: string[];
  readonly stylesheet: string;
  readonly pipelineIdentity: string;
}

interface LocalCSSCacheEntry {
  readonly value: CSSCacheEntry;
  readonly retainedBytes: number;
}

let cssCache: CacheBackend | null = null;
let cssCacheInitPromise: Promise<CacheBackend> | null = null;
let localCacheBytes = 0;
const localCssCache = new Map<string, LocalCSSCacheEntry>();

function getVersionedCacheKey(hash: string): string {
  return `${CSS_CACHE_SCHEMA}:${hash}`;
}

async function getCssCache(): Promise<CacheBackend> {
  if (cssCache) return cssCache;
  if (cssCacheInitPromise) return await cssCacheInitPromise;
  const pending = createCacheBackend({ keyPrefix: "css" });
  cssCacheInitPromise = pending;
  try {
    cssCache = await pending;
    return cssCache;
  } finally {
    if (cssCacheInitPromise === pending) cssCacheInitPromise = null;
  }
}

function estimateEntryBytes(hash: string, entry: CSSCacheEntry): number {
  let bytes = estimateRetainedStringBytes(hash) + estimateRetainedStringBytes(entry.css) +
    estimateRetainedStringBytes(entry.stylesheet) +
    (entry.pipelineIdentity === undefined
      ? 0
      : estimateRetainedStringBytes(entry.pipelineIdentity));
  for (const candidate of entry.candidates) bytes += estimateRetainedStringBytes(candidate) + 8;
  return bytes + 128;
}

function removeLocalEntry(hash: string): void {
  const existing = localCssCache.get(hash);
  if (!existing) return;
  localCssCache.delete(hash);
  localCacheBytes -= existing.retainedBytes;
}

function storeInLocalCache(hash: string, entry: CSSCacheEntry): void {
  const retainedHash = detachRetainedString(hash);
  const retainedBytes = estimateEntryBytes(retainedHash, entry);
  removeLocalEntry(hash);
  while (
    localCssCache.size >= LOCAL_CACHE_MAX_ENTRIES ||
    localCacheBytes + retainedBytes > LOCAL_CACHE_MAX_BYTES
  ) {
    const oldest = localCssCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    removeLocalEntry(oldest);
  }
  if (retainedBytes > LOCAL_CACHE_MAX_BYTES) return;
  localCssCache.set(retainedHash, { value: entry, retainedBytes });
  localCacheBytes += retainedBytes;
}

function touchLocalEntry(hash: string, entry: LocalCSSCacheEntry): CSSCacheEntry {
  localCssCache.delete(hash);
  localCssCache.set(hash, entry);
  return entry.value;
}

function createCSSCacheEntry(
  css: unknown,
  inputs?: {
    candidates: string[] | Set<string>;
    stylesheet: string;
    pipelineIdentity: string;
  },
): CSSCacheEntry {
  if (typeof css !== "string") throw new TypeError("Cached CSS output must be a string");
  assertCSSOutputContent(css, "Cached CSS output");
  const admittedCandidates = inputs === undefined ? [] : normalizeCSSCandidates(inputs.candidates);
  const candidates = new Array<string>(admittedCandidates.length);
  for (let index = 0; index < admittedCandidates.length; index++) {
    candidates[index] = detachRetainedString(admittedCandidates[index]!);
  }
  const stylesheet = detachRetainedString(inputs?.stylesheet ?? "");
  assertCSSFileContent(stylesheet, "Cached CSS regeneration stylesheet");
  const pipelineIdentity = inputs === undefined ? undefined : detachRetainedString(
    assertCSSPipelineIdentity(inputs.pipelineIdentity, "CSS regeneration pipeline identity"),
  );
  return Object.freeze({
    css: detachRetainedString(css),
    candidates: Object.freeze(candidates),
    stylesheet,
    pipelineIdentity,
  });
}

function serializeCSSCacheEntry(entry: CSSCacheEntry): string {
  const serialized = JSON.stringify(entry);
  if (utf8ByteLength(serialized, MAX_SERIALIZED_CSS_CACHE_BYTES) > MAX_SERIALIZED_CSS_CACHE_BYTES) {
    throw new TypeError(
      `Serialized CSS cache entry exceeds ${MAX_SERIALIZED_CSS_CACHE_BYTES} bytes`,
    );
  }
  return serialized;
}

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function parseCSSCacheEntry(raw: string): CSSCacheEntry | undefined {
  if (
    typeof raw !== "string" ||
    utf8ByteLength(raw, MAX_SERIALIZED_CSS_CACHE_BYTES) > MAX_SERIALIZED_CSS_CACHE_BYTES
  ) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const css = readOwnDataProperty(parsed, "css");
  const rawCandidates = readOwnDataProperty(parsed, "candidates");
  const stylesheet = readOwnDataProperty(parsed, "stylesheet");
  const pipelineIdentity = readOwnDataProperty(parsed, "pipelineIdentity");
  if (
    typeof css !== "string" ||
    !Array.isArray(rawCandidates) ||
    typeof stylesheet !== "string"
  ) return undefined;
  let entry: CSSCacheEntry;
  try {
    if (rawCandidates.length > 0 && typeof pipelineIdentity !== "string") return undefined;
    entry = createCSSCacheEntry(
      css,
      rawCandidates.length === 0 && pipelineIdentity === undefined ? undefined : {
        candidates: rawCandidates,
        stylesheet,
        pipelineIdentity: assertCSSPipelineIdentity(pipelineIdentity),
      },
    );
  } catch {
    return undefined;
  }
  return entry;
}

function isEntryForHash(entry: CSSCacheEntry, hash: string): boolean {
  if (!isCSSContentHash(hash)) return false;
  try {
    assertCSSContentIdentity(entry.css, hash);
    return true;
  } catch {
    return false;
  }
}

async function readDistributedEntry(hash: string): Promise<CSSCacheEntry | undefined> {
  try {
    const cache = await getCssCache();
    const raw = await cache.get(getVersionedCacheKey(hash));
    if (!raw) return undefined;
    const entry = parseCSSCacheEntry(raw);
    if (!entry || !isEntryForHash(entry, hash)) return undefined;
    storeInLocalCache(hash, entry);
    return entry;
  } catch (error) {
    logger.debug("Failed to read CSS cache entry", { hash, error });
    return undefined;
  }
}

async function getCSSCacheEntry(hash: string): Promise<CSSCacheEntry | undefined> {
  if (!isCSSContentHash(hash)) return undefined;
  const local = localCssCache.get(hash);
  if (local) {
    const entry = touchLocalEntry(hash, local);
    if (isEntryForHash(entry, hash)) return entry;
    removeLocalEntry(hash);
  }
  return await readDistributedEntry(hash);
}

/** Store CSS and, when supplied, the exact inputs needed for JIT regeneration. */
export async function cacheCSSAsync(
  css: string,
  hash?: string,
  inputs?: {
    candidates: string[] | Set<string>;
    stylesheet: string;
    pipelineIdentity: string;
  },
): Promise<string> {
  const entry = createCSSCacheEntry(css, inputs);
  const resolvedHash = hashCSS(entry.css);
  if (hash !== undefined) assertCSSContentIdentity(entry.css, hash);
  storeInLocalCache(resolvedHash, entry);
  try {
    const cache = await getCssCache();
    await cache.set(
      getVersionedCacheKey(resolvedHash),
      serializeCSSCacheEntry(entry),
      CSS_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.debug("Failed to store CSS in distributed cache", { hash: resolvedHash, error });
  }
  return resolvedHash;
}

export function getCSSByHash(hash: string): string | undefined {
  if (!isCSSContentHash(hash)) return undefined;
  const local = localCssCache.get(hash);
  if (!local) return undefined;
  const entry = touchLocalEntry(hash, local);
  if (isEntryForHash(entry, hash)) return entry.css;
  removeLocalEntry(hash);
  return undefined;
}

export async function getCSSByHashAsync(hash: string): Promise<string | undefined> {
  if (!isCSSContentHash(hash)) return undefined;
  return await withSpan(
    SpanNames.HTML_GET_CSS_BY_HASH,
    async () => (await getCSSCacheEntry(hash))?.css,
    { "css.hash": hash },
  );
}

export function clearCSSCache(): void {
  localCssCache.clear();
  localCacheBytes = 0;
}

/** Resolve JIT inputs only when they match the currently captured pipeline. */
export async function resolveRegenerationInputs(
  expectedHash: string,
  pipelineIdentity: string,
): Promise<CSSRegenerationInputs | undefined> {
  const expectedPipelineIdentity = assertCSSPipelineIdentity(pipelineIdentity);
  const entry = await getCSSCacheEntry(expectedHash);
  if (
    !entry ||
    entry.candidates.length === 0 ||
    entry.pipelineIdentity !== expectedPipelineIdentity
  ) return undefined;
  return {
    candidates: [...entry.candidates],
    stylesheet: entry.stylesheet,
    pipelineIdentity: expectedPipelineIdentity,
  };
}

/** Persist a verified regenerated entry under its immutable content identity. */
export async function persistRegeneratedCSSEntry(
  hash: string,
  entry: CSSCacheEntry,
): Promise<void> {
  if (entry.pipelineIdentity === undefined) {
    throw new TypeError("Regenerated CSS entry requires a pipeline identity");
  }
  await cacheCSSAsync(entry.css, hash, {
    candidates: [...entry.candidates],
    stylesheet: entry.stylesheet,
    pipelineIdentity: entry.pipelineIdentity,
  });
}

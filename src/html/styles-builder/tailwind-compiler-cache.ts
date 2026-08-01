/**
 * Provider-neutral, exact-snapshot CSS compilation cache.
 *
 * Core captures one explicitly registered CSSProcessor for a complete
 * operation. Compilation and the first stateful build are single-flight and
 * cached only under the exact provider, stylesheet, project, and candidate
 * identities that produced the output.
 *
 * @module html/styles-builder/css-compiler-cache
 */

import { resolve } from "#veryfront/extensions/contracts.ts";
import {
  captureCSSProcessor,
  type CSSProcessor,
  CSSProcessorName,
} from "#veryfront/extensions/css/index.ts";
import { assertCSSPipelineIdentity, serverLogger } from "#veryfront/utils";
import { normalizeCSSCandidates } from "#veryfront/utils/css-candidate-admission.ts";
import {
  assertCSSFileContent,
  assertCSSOutputContent,
} from "#veryfront/utils/css-content-admission.ts";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import {
  detachRetainedString,
  estimateRetainedStringBytes,
} from "#veryfront/utils/retained-string.ts";
import { hashCandidates, hashString } from "./css-identity.ts";

const logger = serverLogger.component("css-compiler");
const freeze = Object.freeze;
const arrayJoin = Array.prototype.join;
const arraySort = Array.prototype.sort;
const apply = Reflect.apply;
const now = Date.now;
const weakSetAdd = WeakSet.prototype.add;
const weakSetHas = WeakSet.prototype.has;

interface CompilationCacheEntry {
  readonly css: string;
  readonly retainedBytes: number;
  readonly createdAt: number;
}

/** One immutable processor snapshot acquired for a complete CSS operation. */
export interface CSSCompilationSession {
  readonly cacheIdentity: string;
  readonly defaultStylesheet: string;
  build(
    stylesheet: string,
    projectSlug: string | undefined,
    candidates: string[] | Set<string>,
  ): Promise<string>;
}

const compilationCache = new Map<string, CompilationCacheEntry>();
const inFlightCompilations = new Map<string, Promise<string>>();
const cssCompilationSessions = new WeakSet<object>();
const MAX_CACHED_COMPILATIONS = 10;
const MAX_CACHED_COMPILATION_BYTES = 64 * 1024 * 1024;
const CSS_COMPILATION_IDENTITY_SCHEMA = "veryfront.css-compilation.v3";
let cachedCompilationBytes = 0;
let compilationCacheEpoch = 0;

registerCache("css-compiler-cache", () => ({
  name: "css-compiler-cache",
  entries: compilationCache.size,
  maxEntries: MAX_CACHED_COMPILATIONS,
  estimatedSizeBytes: cachedCompilationBytes,
}));

function createCSSCompilationCacheIdentity(processor: CSSProcessor): string {
  assertCSSFileContent(
    processor.defaultStylesheet,
    "CSSProcessor default stylesheet",
  );
  return assertCSSPipelineIdentity(
    `${CSS_COMPILATION_IDENTITY_SCHEMA}:${hashString(processor.cacheIdentity)}:${
      hashString(processor.defaultStylesheet)
    }`,
    "CSS compilation identity",
  );
}

function snapshotCandidates(value: string[] | Set<string>): string[] {
  const snapshot = normalizeCSSCandidates(value);
  apply(arraySort, snapshot, []);
  return snapshot;
}

function removeCachedCompilation(key: string): void {
  const entry = compilationCache.get(key);
  if (!entry) return;
  compilationCache.delete(key);
  cachedCompilationBytes -= entry.retainedBytes;
}

function touchCachedCompilation(key: string, entry: CompilationCacheEntry): void {
  compilationCache.delete(key);
  compilationCache.set(key, entry);
}

function storeCachedCompilation(
  key: string,
  css: string,
): void {
  const retainedKey = detachRetainedString(key);
  const retainedCSS = detachRetainedString(css);
  const retainedBytes = estimateRetainedStringBytes(retainedKey) +
    estimateRetainedStringBytes(retainedCSS) + 128;
  removeCachedCompilation(key);
  while (
    compilationCache.size >= MAX_CACHED_COMPILATIONS ||
    cachedCompilationBytes + retainedBytes > MAX_CACHED_COMPILATION_BYTES
  ) {
    const oldestKey = compilationCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    removeCachedCompilation(oldestKey);
  }
  if (retainedBytes > MAX_CACHED_COMPILATION_BYTES) return;
  compilationCache.set(retainedKey, {
    css: retainedCSS,
    retainedBytes,
    createdAt: apply(now, Date, []) as number,
  });
  cachedCompilationBytes += retainedBytes;
}

async function buildForProcessor(
  processor: CSSProcessor,
  compilationIdentity: string,
  stylesheet: string,
  projectSlug: string | undefined,
  rawCandidates: string[] | Set<string>,
): Promise<string> {
  assertCSSFileContent(stylesheet, "CSS compilation stylesheet");
  const candidates = snapshotCandidates(rawCandidates);
  const keyParts = [
    "css-compile-v2",
    hashString(compilationIdentity),
    projectSlug === undefined ? "shared" : hashString(projectSlug),
    hashString(stylesheet),
    hashCandidates(candidates),
  ];
  const key = apply(arrayJoin, keyParts, [":"]) as string;

  const cached = compilationCache.get(key);
  if (cached) {
    touchCachedCompilation(key, cached);
    logger.debug("CSS compilation cache hit", { key, projectSlug });
    return cached.css;
  }

  const pending = inFlightCompilations.get(key);
  if (pending) {
    logger.debug("CSS compilation single-flight hit", { key, projectSlug });
    return await pending;
  }

  const compilation = (async () => {
    const cacheEpoch = compilationCacheEpoch;
    const compiler = await processor.compile(stylesheet);
    const css = compiler.build(candidates);
    assertCSSOutputContent(css, "CSS compiler output");
    if (cacheEpoch === compilationCacheEpoch) {
      storeCachedCompilation(key, css);
    }
    return css;
  })();
  inFlightCompilations.set(key, compilation);
  try {
    return await compilation;
  } finally {
    if (inFlightCompilations.get(key) === compilation) {
      inFlightCompilations.delete(key);
    }
  }
}

/** Capture the currently registered provider before any cache lookup awaits. */
export function acquireCSSCompilationSession(): CSSCompilationSession {
  const processor = captureCSSProcessor(resolve<unknown>(CSSProcessorName));
  const cacheIdentity = createCSSCompilationCacheIdentity(processor);
  const session: CSSCompilationSession = {
    cacheIdentity,
    defaultStylesheet: processor.defaultStylesheet,
    build(stylesheet, projectSlug, candidates) {
      return buildForProcessor(
        processor,
        cacheIdentity,
        stylesheet,
        projectSlug,
        candidates,
      );
    },
  };
  apply(weakSetAdd, cssCompilationSessions, [session]);
  return freeze(session);
}

/** Identity of all captured provider-owned inputs that can change emitted CSS. */
export function getCSSCompilationCacheIdentity(): string {
  return acquireCSSCompilationSession().cacheIdentity;
}

/** Compile with an authentic, already captured session. */
export function buildCSSWithSession(
  session: CSSCompilationSession,
  stylesheet: string,
  projectSlug: string | undefined,
  candidates: string[] | Set<string>,
): Promise<string> {
  if (!apply(weakSetHas, cssCompilationSessions, [session])) {
    throw new TypeError("CSS compilation session was not acquired by core");
  }
  return session.build(stylesheet, projectSlug, candidates);
}

export function invalidateCompiler(): void {
  compilationCacheEpoch++;
  compilationCache.clear();
  inFlightCompilations.clear();
  cachedCompilationBytes = 0;
  logger.debug("All CSS compilations invalidated");
}

/** Get bounded compilation-cache statistics for monitoring and tests. */
export function getCompilerCacheStats(): {
  size: number;
  maxSize: number;
  estimatedSizeBytes: number;
  entries: Array<{ hash: string; createdAt: number }>;
} {
  return {
    size: compilationCache.size,
    maxSize: MAX_CACHED_COMPILATIONS,
    estimatedSizeBytes: cachedCompilationBytes,
    entries: Array.from(compilationCache, ([hash, entry]) => ({
      hash,
      createdAt: entry.createdAt,
    })),
  };
}

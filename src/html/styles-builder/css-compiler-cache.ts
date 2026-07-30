/**
 * Provider-neutral CSS compiler LRU cache management.
 *
 * Manages a bounded cache of compiled CSS processors, keyed by the
 * processor, project, stylesheet, and exact candidate snapshot. Prevents
 * stateful build sessions from leaking candidates across CSS identities.
 *
 * Compilation is routed through the `CSSProcessor` extension contract.
 * Missing implementations fail at the contract boundary; core never imports
 * a vendor compiler, base stylesheet, or plugin loader.
 *
 * @module html/styles-builder/css-compiler-cache
 */

import { resolve } from "#veryfront/extensions/contracts.ts";
import { findExtensionPropertyDescriptor } from "../../extensions/property-inspection.ts";
import {
  type CSSCompiler,
  type CSSProcessor,
  CSSProcessorName,
  MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS,
  MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS,
} from "#veryfront/extensions/css/index.ts";
import { assertCSSPipelineIdentity, serverLogger } from "#veryfront/utils";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { hashCandidates, hashString } from "./css-identity.ts";

const logger = serverLogger.component("css-compiler");

/**
 * LRU cache for extension-provided compilers, keyed by every compilation
 * identity input. Provider state stays inside the extension implementation.
 */
interface CompilerCacheEntry {
  compiler: CSSCompiler;
  createdAt: number;
}

/** One captured CSSProcessor identity and compiler factory. */
export interface CSSCompilationSession {
  readonly cacheIdentity: string;
  readonly defaultStylesheet: string;
  getCompiler(
    stylesheet: string,
    projectSlug: string | undefined,
    candidates: readonly string[],
  ): Promise<CSSCompiler>;
}

interface CapturedCSSProcessor {
  readonly receiver: CSSProcessor;
  readonly compile: CSSProcessor["compile"];
  readonly cacheIdentity: string;
  readonly defaultStylesheet: string;
}

const compilerCache = new Map<string, CompilerCacheEntry>();
const cssCompilationSessions = new WeakSet<object>();
const MAX_CACHED_COMPILERS = 10;
const CSS_COMPILATION_IDENTITY_SCHEMA = "veryfront.css-compilation.v2";

registerCache("css-compiler-cache", () => ({
  name: "css-compiler-cache",
  entries: compilerCache.size,
  maxEntries: MAX_CACHED_COMPILERS,
}));

function createCSSCompilationCacheIdentity(
  processorIdentity: unknown,
  defaultStylesheet: unknown,
): string {
  if (
    typeof processorIdentity !== "string" ||
    processorIdentity.length === 0 ||
    processorIdentity.length > MAX_CSS_PROCESSOR_IDENTITY_CHARACTERS ||
    processorIdentity.trim() !== processorIdentity ||
    /\p{Cc}/u.test(processorIdentity)
  ) {
    throw new TypeError("Resolved CSSProcessor must declare a bounded stable cacheIdentity");
  }
  if (
    typeof defaultStylesheet !== "string" ||
    defaultStylesheet.length > MAX_CSS_PROCESSOR_DEFAULT_STYLESHEET_CHARACTERS ||
    defaultStylesheet.includes("\0")
  ) {
    throw new TypeError("Resolved CSSProcessor must declare a bounded defaultStylesheet");
  }

  return assertCSSPipelineIdentity(
    JSON.stringify([
      CSS_COMPILATION_IDENTITY_SCHEMA,
      processorIdentity,
      hashString(defaultStylesheet),
    ]),
    "CSS compilation identity",
  );
}

function captureCSSProcessor(
  processor: CSSProcessor,
): CapturedCSSProcessor {
  let identityDescriptor: PropertyDescriptor | undefined;
  let defaultStylesheetDescriptor: PropertyDescriptor | undefined;
  let compileDescriptor: PropertyDescriptor | undefined;
  try {
    identityDescriptor = Object.getOwnPropertyDescriptor(
      processor,
      "cacheIdentity",
    );
    defaultStylesheetDescriptor = Object.getOwnPropertyDescriptor(
      processor,
      "defaultStylesheet",
    );
    compileDescriptor = findExtensionPropertyDescriptor(processor, "compile");
  } catch (cause) {
    throw new TypeError("CSSProcessor properties could not be inspected", {
      cause,
    });
  }
  if (
    identityDescriptor === undefined ||
    !("value" in identityDescriptor) ||
    defaultStylesheetDescriptor === undefined ||
    !("value" in defaultStylesheetDescriptor) ||
    compileDescriptor === undefined ||
    !("value" in compileDescriptor) ||
    typeof compileDescriptor.value !== "function"
  ) {
    throw new TypeError(
      "CSSProcessor cacheIdentity, defaultStylesheet, and compile must be data properties",
    );
  }
  // Reuse the canonical identity validator after capturing the data property.
  const cacheIdentity = createCSSCompilationCacheIdentity(
    identityDescriptor.value,
    defaultStylesheetDescriptor.value,
  ).slice(0);
  return {
    receiver: processor,
    compile: compileDescriptor.value as CSSProcessor["compile"],
    cacheIdentity,
    defaultStylesheet: (defaultStylesheetDescriptor.value as string).slice(0),
  };
}

function captureCSSCompiler(value: unknown): CSSCompiler {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("CSSProcessor compile() must return a CSSCompiler object");
  }
  let buildDescriptor: PropertyDescriptor | undefined;
  try {
    buildDescriptor = findExtensionPropertyDescriptor(value, "build");
  } catch (cause) {
    throw new TypeError("CSSCompiler properties could not be inspected", {
      cause,
    });
  }
  if (
    buildDescriptor === undefined ||
    !("value" in buildDescriptor) ||
    typeof buildDescriptor.value !== "function"
  ) {
    throw new TypeError("CSSCompiler build must be a data-property function");
  }
  const build = buildDescriptor.value as CSSCompiler["build"];
  return Object.freeze({
    build(candidates: string[]): string {
      const css = Reflect.apply(build, value, [candidates]);
      if (typeof css !== "string") {
        throw new TypeError("CSSCompiler build must return CSS as a string");
      }
      return css;
    },
  });
}

/** Acquire one processor identity/compiler pair for a complete generation. */
export async function acquireCSSCompilationSession(): Promise<CSSCompilationSession> {
  const processor = captureCSSProcessor(resolve<CSSProcessor>(CSSProcessorName));
  const cacheIdentity = processor.cacheIdentity;
  const session: CSSCompilationSession = {
    cacheIdentity,
    defaultStylesheet: processor.defaultStylesheet,
    getCompiler(
      stylesheet: string,
      projectSlug: string | undefined,
      candidates: readonly string[],
    ): Promise<CSSCompiler> {
      return getCompilerForSession(
        stylesheet,
        projectSlug,
        candidates,
        processor,
        cacheIdentity,
      );
    },
  };
  cssCompilationSessions.add(session);
  return Object.freeze(session);
}

/** Identity of every extension-owned input that can change emitted CSS. */
export async function getCSSCompilationCacheIdentity(): Promise<string> {
  return (await acquireCSSCompilationSession()).cacheIdentity;
}

function evictOldestCompiler(): void {
  if (compilerCache.size < MAX_CACHED_COMPILERS) return;

  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of compilerCache) {
    if (entry.createdAt < oldestTime) {
      oldestTime = entry.createdAt;
      oldestKey = key;
    }
  }

  if (!oldestKey) return;

  compilerCache.delete(oldestKey);
  logger.debug("Evicted oldest compiler from cache", { hash: oldestKey });
}

export async function getCompiler(
  stylesheet: string,
  projectSlug: string | undefined,
  candidates: readonly string[],
  session?: CSSCompilationSession,
): Promise<CSSCompiler> {
  const resolved = session ?? await acquireCSSCompilationSession();
  if (!cssCompilationSessions.has(resolved)) {
    throw new TypeError("CSS compilation session was not acquired by core");
  }
  return resolved.getCompiler(
    stylesheet,
    projectSlug,
    candidates,
  );
}

async function getCompilerForSession(
  stylesheet: string,
  projectSlug: string | undefined,
  candidates: readonly string[],
  processor: CapturedCSSProcessor,
  compilationIdentity: string,
): Promise<CSSCompiler> {
  // Providers may return stateful compilers that accumulate candidates. Scope
  // each compiler to the exact immutable candidate snapshot so a later build
  // cannot inherit output absent from its cache identity.
  const stylesheetHash = hashString(stylesheet);
  const projectIdentity = projectSlug ? hashString(projectSlug) : "shared";
  const candidatesHash = hashCandidates(new Set(candidates));
  const compilationIdentityHash = hashString(compilationIdentity);
  const hash =
    `css-v1:${compilationIdentityHash}:${projectIdentity}:${stylesheetHash}:${candidatesHash}`;

  const cached = compilerCache.get(hash);
  if (cached) {
    logger.debug("Compiler cache hit", { hash, projectSlug });
    return cached.compiler;
  }

  logger.debug("Creating new compiler", { hash, projectSlug });

  const newCompiler = captureCSSCompiler(
    await Reflect.apply(processor.compile, processor.receiver, [stylesheet]),
  );

  evictOldestCompiler();

  compilerCache.set(hash, {
    compiler: newCompiler,
    createdAt: Date.now(),
  });

  return newCompiler;
}

export function invalidateCompiler(): void {
  compilerCache.clear();
  logger.debug("All compilers invalidated");
}

/**
 * Get compiler cache statistics for monitoring.
 */
export function getCompilerCacheStats(): {
  size: number;
  maxSize: number;
  entries: Array<{ hash: string; createdAt: number }>;
} {
  const entries = Array.from(compilerCache.entries()).map(([hash, entry]) => ({
    hash,
    createdAt: entry.createdAt,
  }));

  return { size: compilerCache.size, maxSize: MAX_CACHED_COMPILERS, entries };
}

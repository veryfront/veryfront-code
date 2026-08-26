/**
 * CSS Import Collector - Request-scoped CSS import tracking for SSR
 *
 * Collects CSS import paths discovered during module loading using
 * AsyncLocalStorage for proper isolation between concurrent requests.
 *
 * Usage:
 *   const { result, cssImports } = await runWithCSSCollector(() => loadModules(...));
 *   // cssImports contains absolute paths to CSS files discovered during loading
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface CSSCollectorStore {
  imports: Map<string, CSSImportReference>;
}

/** Canonical CSS read path paired with the authored CSS module identity. */
export interface CSSImportReference {
  readPath: string;
  moduleKey: string;
  /** Bound read captured by the dependency validator for contained files. */
  read?: () => Promise<string>;
}

const cssStorage = new AsyncLocalStorage<CSSCollectorStore>();

/**
 * Run a function with CSS import collection enabled.
 * Returns the function result and all collected CSS import paths.
 */
export async function runWithCSSCollector<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; cssImports: string[] }> {
  const store: CSSCollectorStore = { imports: new Map() };
  const result = await cssStorage.run(store, fn);
  return { result, cssImports: getCSSImportsFromReferences(store.imports.values()) };
}

/**
 * Register a CSS import path discovered during module loading.
 * No-op if called outside of a runWithCSSCollector context.
 */
export function registerCSSImport(
  absolutePath: string,
  moduleKey = absolutePath,
  read?: () => Promise<string>,
): void {
  const store = cssStorage.getStore();
  if (!store) return;
  const key = `${absolutePath.length}:${absolutePath}${moduleKey}`;
  if (!store.imports.has(key)) {
    store.imports.set(key, { readPath: absolutePath, moduleKey, ...(read ? { read } : {}) });
  }
}

/**
 * Get all CSS imports collected so far in the current context.
 * Returns empty array if called outside of a runWithCSSCollector context.
 */
export function getCSSImports(): string[] {
  return getCSSImportsFromReferences(getCSSImportReferences());
}

/** Return canonical CSS read paths with their authored module keys. */
export function getCSSImportReferences(): CSSImportReference[] {
  const store = cssStorage.getStore();
  if (!store) return [];
  return [...store.imports.values()];
}

function getCSSImportsFromReferences(
  references: Iterable<CSSImportReference>,
): string[] {
  return [...new Set([...references].map(({ readPath }) => readPath))];
}

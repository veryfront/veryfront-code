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
  imports: Map<string, string>;
}

/** Canonical CSS read path paired with the authored CSS module identity. */
export interface CSSImportReference {
  readPath: string;
  moduleKey: string;
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
  return { result, cssImports: [...store.imports.keys()] };
}

/**
 * Register a CSS import path discovered during module loading.
 * No-op if called outside of a runWithCSSCollector context.
 */
export function registerCSSImport(absolutePath: string, moduleKey = absolutePath): void {
  const store = cssStorage.getStore();
  if (!store) return;
  if (!store.imports.has(absolutePath)) store.imports.set(absolutePath, moduleKey);
}

/**
 * Get all CSS imports collected so far in the current context.
 * Returns empty array if called outside of a runWithCSSCollector context.
 */
export function getCSSImports(): string[] {
  return getCSSImportReferences().map(({ readPath }) => readPath);
}

/** Return canonical CSS read paths with their authored module keys. */
export function getCSSImportReferences(): CSSImportReference[] {
  const store = cssStorage.getStore();
  if (!store) return [];
  return [...store.imports].map(([readPath, moduleKey]) => ({ readPath, moduleKey }));
}

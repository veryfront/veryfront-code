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
import { isAbsolute } from "#veryfront/compat/path/index.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_CSS_IMPORTS_PER_REQUEST = 10_000;
const MAX_CSS_IMPORT_PATH_LENGTH = 4_096;

interface CSSCollectorStore {
  imports: Set<string>;
}

const cssStorage = new AsyncLocalStorage<CSSCollectorStore>();

/**
 * Run a function with CSS import collection enabled.
 * Returns the function result and all collected CSS import paths.
 */
export async function runWithCSSCollector<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; cssImports: string[] }> {
  const store: CSSCollectorStore = { imports: new Set() };
  const result = await cssStorage.run(store, fn);
  return { result, cssImports: [...store.imports] };
}

/**
 * Register a CSS import path discovered during module loading.
 * No-op if called outside of a runWithCSSCollector context.
 */
export function registerCSSImport(absolutePath: string): void {
  const store = cssStorage.getStore();
  if (!store) return;
  if (
    absolutePath.length === 0 || absolutePath.length > MAX_CSS_IMPORT_PATH_LENGTH ||
    hasUnsafeControlCharacters(absolutePath) || !isAbsolute(absolutePath)
  ) {
    throw new TypeError("CSS import path must be a valid absolute path");
  }
  if (
    !store.imports.has(absolutePath) &&
    store.imports.size >= MAX_CSS_IMPORTS_PER_REQUEST
  ) {
    throw new RangeError("CSS import collection exceeds the request limit");
  }
  store.imports.add(absolutePath);
}

/**
 * Get all CSS imports collected so far in the current context.
 * Returns empty array if called outside of a runWithCSSCollector context.
 */
export function getCSSImports(): string[] {
  const store = cssStorage.getStore();
  if (!store) return [];
  return [...store.imports];
}

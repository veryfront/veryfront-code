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

const reflectApply = Reflect.apply;
const asyncLocalStorageGetStore = AsyncLocalStorage.prototype.getStore;
const asyncLocalStorageRun = AsyncLocalStorage.prototype.run;
const mapConstructor = Map;
const mapForEach = Map.prototype.forEach;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;

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

function getCollectorStore(): CSSCollectorStore | undefined {
  return reflectApply(asyncLocalStorageGetStore, cssStorage, []) as
    | CSSCollectorStore
    | undefined;
}

function getCollectedReferences(imports: Map<string, CSSImportReference>): CSSImportReference[] {
  const references: CSSImportReference[] = [];
  reflectApply(mapForEach, imports, [
    (reference: CSSImportReference) => {
      references[references.length] = reference;
    },
  ]);
  return references;
}

/**
 * Run a function with CSS import collection enabled.
 * Returns the function result and all collected CSS import paths.
 */
export async function runWithCSSCollector<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; cssImports: string[] }> {
  const store: CSSCollectorStore = { imports: new mapConstructor() };
  const result = await (reflectApply(asyncLocalStorageRun, cssStorage, [store, fn]) as
    | T
    | Promise<T>);
  return {
    result,
    cssImports: getCSSImportsFromReferences(getCollectedReferences(store.imports)),
  };
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
  const store = getCollectorStore();
  if (!store) return;
  const key = `${absolutePath.length}:${absolutePath}${moduleKey}`;
  if (!(reflectApply(mapHas, store.imports, [key]) as boolean)) {
    reflectApply(mapSet, store.imports, [
      key,
      { readPath: absolutePath, moduleKey, ...(read ? { read } : {}) },
    ]);
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
  const store = getCollectorStore();
  if (!store) return [];
  return getCollectedReferences(store.imports);
}

function getCSSImportsFromReferences(
  references: readonly CSSImportReference[],
): string[] {
  const paths: string[] = [];
  for (let index = 0; index < references.length; index++) {
    const readPath = references[index]!.readPath;
    let seen = false;
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      if (paths[pathIndex] === readPath) {
        seen = true;
        break;
      }
    }
    if (!seen) paths[paths.length] = readPath;
  }
  return paths;
}

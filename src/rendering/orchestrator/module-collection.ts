/**
 * Module Collection Types and Utilities
 *
 * Types and helper functions for collecting and loading page/layout modules
 * during the data fetching phase of the render pipeline.
 *
 * @module rendering/orchestrator/module-collection
 */

/** Timeout for module loading in resolvePageData (prevents hanging on slow transforms) */
export const MODULE_LOAD_TIMEOUT_MS = 10000;

/** Timeout for data fetching (getStaticData, getServerData) */
export const DATA_FETCH_TIMEOUT_MS = 15_000;

/** Timeout for SSR rendering stage */
export const SSR_RENDER_TIMEOUT_MS = 20_000;

/** Module to load for data fetching */
export interface ModuleToLoad {
  type: "page" | "layout";
  id: string;
  path: string;
}

/** Result of loading a module */
export interface LoadedModule {
  type: "page" | "layout";
  id: string;
  mod: unknown;
}

/**
 * Collect modules that need to be loaded for data fetching.
 *
 * @param pagePath - The path to the page component
 * @param isComponentPage - Whether the page is a component page (tsx, jsx, ts, js)
 * @param isInPagesOrAppDir - Whether the page is in /pages/ or /app/ directory
 * @param nestedLayouts - Array of layout items that may have component paths
 * @returns Array of modules to load
 */
export function collectModulesToLoad(
  pagePath: string,
  isComponentPage: boolean,
  isInPagesOrAppDir: boolean,
  nestedLayouts: Array<{ kind: string; componentPath?: string }>,
): ModuleToLoad[] {
  const modules: ModuleToLoad[] = [];

  if (isComponentPage && isInPagesOrAppDir) {
    modules.push({ type: "page", id: pagePath, path: pagePath });
  }

  for (const layout of nestedLayouts) {
    if (layout.kind === "tsx" && layout.componentPath) {
      modules.push({ type: "layout", id: layout.componentPath, path: layout.componentPath });
    }
  }

  return modules;
}

/**
 * Check if a module has data fetching functions (getServerData or getStaticData).
 *
 * @param mod - The loaded module to check
 * @returns True if the module has data fetching functions
 */
export function hasDataFetchingFunction(mod: unknown): boolean {
  if (!mod || typeof mod !== "object") return false;
  const m = mod as Record<string, unknown>;
  return typeof m.getServerData === "function" || typeof m.getStaticData === "function";
}

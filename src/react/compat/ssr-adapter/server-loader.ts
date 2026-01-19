import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { isDeno, isNode } from "@veryfront/platform/compat/runtime.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { fileURLToPath, pathToFileURL } from "node:url";

// True Node.js runtime (not Deno with Node.js compat)
const IS_TRUE_NODE = isNode && !isDeno;

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;

  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;

  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;

  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

let projectReactCache: typeof React | null = null;
let useProjectReact: boolean | null = null;
let reactDOMServerCache: ReactDOMServer | null = null;

type ImportMetaWithResolve = ImportMeta & {
  resolve?: (specifier: string, parent?: string) => string;
};

const IMPORT_META_RESOLVE_ERROR = "ImportMetaResolveUnavailable";

function rethrowIfImportMetaResolveMissing(error: unknown): void {
  if (error instanceof Error && error.name === IMPORT_META_RESOLVE_ERROR) {
    throw error;
  }
}

function resolveWithImportMeta(specifier: string, parentUrl: string): string | null {
  const metaResolve = (import.meta as ImportMetaWithResolve).resolve;
  if (typeof metaResolve !== "function") {
    const error = new Error(
      "import.meta.resolve is required for Node ESM resolution (Node >= 22).",
    );
    error.name = IMPORT_META_RESOLVE_ERROR;
    throw error;
  }
  try {
    return metaResolve(specifier, parentUrl);
  } catch {
    return null;
  }
}

function resolveFromProject(specifier: string): string | null {
  return resolveWithImportMeta(specifier, pathToFileURL(cwd() + "/").href);
}

function resolveFromCli(specifier: string): string | null {
  return resolveWithImportMeta(specifier, import.meta.url);
}

/**
 * Reset all cached React and ReactDOM instances.
 * This is critical for test isolation when running parallel tests
 * with different project directories.
 */
export function resetReactCache(): void {
  projectReactCache = null;
  useProjectReact = null;
  reactDOMServerCache = null;
}

/**
 * Check if both react and react-dom can be resolved from the project.
 * This ensures we use a consistent set of React packages to avoid
 * the "multiple React instances" hook error.
 */
function canResolveReactFromProject(): boolean {
  if (useProjectReact !== null) {
    return useProjectReact;
  }

  if (!IS_TRUE_NODE) {
    useProjectReact = false;
    return false;
  }

  try {
    // Check that BOTH react and react-dom can be resolved from project
    const reactUrl = resolveFromProject("react");
    const reactDomUrl = resolveFromProject("react-dom/server");
    if (!reactUrl || !reactDomUrl) {
      useProjectReact = false;
      return false;
    }

    logger.debug("Project has both react and react-dom", {
      react: fileURLToPath(reactUrl),
      reactDom: fileURLToPath(reactDomUrl),
    });
    useProjectReact = true;
    return true;
  } catch (error) {
    rethrowIfImportMetaResolveMissing(error);
    logger.debug(
      "Project missing react and/or react-dom, using bundled versions for consistency",
      error,
    );
    useProjectReact = false;
    return false;
  }
}

/**
 * Get React from the project's node_modules, not the CLI's.
 * This is critical for Node.js to avoid multiple React instances when
 * creating elements that will be rendered with user components.
 *
 * IMPORTANT: We only use project's React if BOTH react and react-dom
 * can be resolved from the project. This prevents the singleton mismatch
 * that causes "Invalid hook call" errors.
 *
 * In Deno, returns the bundled React since there's no node_modules conflict.
 */
export async function getProjectReact(): Promise<typeof React> {
  if (projectReactCache) {
    return projectReactCache;
  }

  const canUseProject = await canResolveReactFromProject();

  if (canUseProject) {
    try {
      const reactUrl = resolveFromProject("react");
      if (reactUrl) {
        logger.debug("Resolved react from project", { path: fileURLToPath(reactUrl) });
        const projectReact = await import(reactUrl);
        projectReactCache = projectReact.default || projectReact;
        return projectReactCache as typeof React;
      }
      logger.warn("Failed to resolve react from project, falling back to bundled");
    } catch (error) {
      rethrowIfImportMetaResolveMissing(error);
      logger.warn("Failed to resolve react from project, falling back to bundled", error);
    }
  }

  // Fall back to bundled React via file URL to match transform behavior
  // Using dynamic import with file URL ensures we get the same module instance
  // as user code that was transformed by react-imports.ts
  if (IS_TRUE_NODE) {
    try {
      const bundledReactUrl = resolveFromCli("react");
      if (bundledReactUrl) {
        logger.debug("Resolved bundled react", { path: fileURLToPath(bundledReactUrl) });
        const bundledReact = await import(bundledReactUrl);
        projectReactCache = bundledReact.default || bundledReact;
        return projectReactCache as typeof React;
      }
      logger.warn("Failed to resolve bundled react via file URL");
    } catch (error) {
      rethrowIfImportMetaResolveMissing(error);
      logger.warn("Failed to resolve bundled react via file URL", error);
    }
  }

  // For Deno: use the import map which maps to esm.sh React URLs
  // This ensures consistency with third-party packages like @tanstack/react-query
  if (!IS_TRUE_NODE) {
    const npmReact = await import("react");
    // Handle both ESM default export and CJS module.exports
    const reactModule = npmReact as unknown as { default?: typeof React };
    projectReactCache = reactModule.default ?? (npmReact as typeof React);
    return projectReactCache as typeof React;
  }

  // Last resort: use static import (if file URL failed on Node.js)
  projectReactCache = React;
  return React;
}

async function importReactDOMServerFromProject(): Promise<
  typeof import("react-dom/server")
> {
  const canUseProject = await canResolveReactFromProject();

  if (canUseProject) {
    try {
      const reactDomServerUrl = resolveFromProject("react-dom/server");
      if (reactDomServerUrl) {
        logger.debug("Resolved react-dom/server from project", {
          path: fileURLToPath(reactDomServerUrl),
        });
        return await import(reactDomServerUrl);
      }
      logger.warn("Failed to resolve react-dom from project, falling back to bundled");
    } catch (error) {
      rethrowIfImportMetaResolveMissing(error);
      logger.warn("Failed to resolve react-dom from project, falling back to bundled", error);
    }
  }

  // Fall back to bundled react-dom via file URL to match React resolution
  // This ensures react-dom uses the same React instance as components
  if (IS_TRUE_NODE) {
    try {
      const bundledUrl = resolveFromCli("react-dom/server");
      if (bundledUrl) {
        logger.debug("Resolved bundled react-dom/server", { path: fileURLToPath(bundledUrl) });
        return await import(bundledUrl);
      }
      logger.warn("Failed to resolve bundled react-dom/server via file URL");
    } catch (error) {
      rethrowIfImportMetaResolveMissing(error);
      logger.warn("Failed to resolve bundled react-dom/server via file URL", error);
    }
  }

  // For Deno: use the import map React resolution for consistent instances.
  // Third-party packages use bare react specifiers, so the import map keeps them aligned.
  // Use deno.json import map which explicitly maps to the server build
  return await import("react-dom/server");
}

export async function getReactDOMServer(): Promise<ReactDOMServer> {
  // Return cached instance if available for consistency
  if (reactDOMServerCache) {
    return reactDOMServerCache;
  }

  const versionInfo = getReactVersionInfo();

  const { renderToString, renderToStaticMarkup } = await importReactDOMServerFromProject();

  let renderToPipeableStream: typeof import("react-dom/server").renderToPipeableStream | undefined;
  let renderToReadableStream: typeof import("react-dom/server").renderToReadableStream | undefined;

  if (versionInfo.isReact18 || versionInfo.isReact19) {
    try {
      const serverModule = await importReactDOMServerFromProject();
      renderToPipeableStream = serverModule
        .renderToPipeableStream as typeof import("react-dom/server").renderToPipeableStream;
      renderToReadableStream = serverModule
        .renderToReadableStream as typeof import("react-dom/server").renderToReadableStream;
    } catch (error) {
      logger.warn("Failed to import React 18+ streaming methods", error);
    }
  }

  reactDOMServerCache = {
    renderToString,
    renderToStaticMarkup,
    renderToPipeableStream,
    renderToReadableStream,
  };

  return reactDOMServerCache;
}

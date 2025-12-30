import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { isDeno, isNode } from "../../../platform/compat/runtime.ts";
import { cwd } from "../../../platform/compat/process.ts";

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

/**
 * Check if both react and react-dom can be resolved from the project.
 * This ensures we use a consistent set of React packages to avoid
 * the "multiple React instances" hook error.
 */
async function canResolveReactFromProject(): Promise<boolean> {
  if (useProjectReact !== null) {
    return useProjectReact;
  }

  if (!IS_TRUE_NODE) {
    useProjectReact = false;
    return false;
  }

  try {
    const { createRequire } = await import("node:module");
    const { pathToFileURL } = await import("node:url");
    const projectRequire = createRequire(pathToFileURL(cwd() + "/").href);

    // Check that BOTH react and react-dom can be resolved from project
    const reactPath = projectRequire.resolve("react");
    const reactDomPath = projectRequire.resolve("react-dom/server");

    logger.debug("Project has both react and react-dom", {
      react: reactPath,
      reactDom: reactDomPath,
    });
    useProjectReact = true;
    return true;
  } catch (error) {
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
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const projectRequire = createRequire(pathToFileURL(cwd() + "/").href);
      const reactPath = projectRequire.resolve("react");
      logger.debug("Resolved react from project", { path: reactPath });
      const projectReact = await import(pathToFileURL(reactPath).href);
      projectReactCache = projectReact.default || projectReact;
      return projectReactCache as typeof React;
    } catch (error) {
      logger.warn("Failed to resolve react from project, falling back to bundled", error);
    }
  }

  // Fall back to bundled React via file URL to match transform behavior
  // Using dynamic import with file URL ensures we get the same module instance
  // as user code that was transformed by react-imports.ts
  if (IS_TRUE_NODE) {
    try {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const cliRequire = createRequire(import.meta.url);
      const bundledReactPath = cliRequire.resolve("react");
      logger.debug("Resolved bundled react", { path: bundledReactPath });
      const bundledReact = await import(pathToFileURL(bundledReactPath).href);
      projectReactCache = bundledReact.default || bundledReact;
      return projectReactCache as typeof React;
    } catch (error) {
      logger.warn("Failed to resolve bundled react via file URL", error);
    }
  }

  // For Deno: use the deno.json import map which maps to npm:react@18.3.1
  // This ensures consistency with third-party packages like @tanstack/react-query
  if (!IS_TRUE_NODE) {
    const npmReact = await import("react");
    projectReactCache = npmReact.default || npmReact;
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
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const projectRequire = createRequire(pathToFileURL(cwd() + "/").href);
      const reactDomServerPath = projectRequire.resolve("react-dom/server");
      logger.debug("Resolved react-dom/server from project", { path: reactDomServerPath });
      return await import(pathToFileURL(reactDomServerPath).href);
    } catch (error) {
      logger.warn("Failed to resolve react-dom from project, falling back to bundled", error);
    }
  }

  // Fall back to bundled react-dom via file URL to match React resolution
  // This ensures react-dom uses the same React instance as components
  if (IS_TRUE_NODE) {
    try {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const cliRequire = createRequire(import.meta.url);
      const bundledPath = cliRequire.resolve("react-dom/server");
      logger.debug("Resolved bundled react-dom/server", { path: bundledPath });
      return await import(pathToFileURL(bundledPath).href);
    } catch (error) {
      logger.warn("Failed to resolve bundled react-dom/server via file URL", error);
    }
  }

  // For Deno: use npm: specifiers to match React used by third-party packages
  // Third-party packages like @tanstack/react-query always use npm:react,
  // so we must use npm:react-dom/server for consistent React instances.
  // Use deno.json import map which explicitly maps to server.node build
  return await import("react-dom/server");
}

export async function getReactDOMServer(): Promise<ReactDOMServer> {
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

  return {
    renderToString,
    renderToStaticMarkup,
    renderToPipeableStream,
    renderToReadableStream,
  };
}

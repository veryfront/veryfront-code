import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { REACT_DEFAULT_VERSION } from "@veryfront/utils/constants/cdn.ts";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { isDeno, isNode } from "../../../platform/compat/runtime.ts";
import { cwd } from "../../../platform/compat/process.ts";

const IS_TRUE_NODE = isNode && !isDeno;

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;

  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;

  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;

  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

let projectReactCache: typeof React | null = null;
let useProjectReact: boolean | null = null;
let denoReactCache: typeof React | null = null;
let denoReactPromise: Promise<typeof React> | null = null;
let denoReactDOMServerPromise: Promise<typeof import("react-dom/server")> | null = null;

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
 * In Deno SSR, we must use esm.sh React because transformed TSX components
 * import React from esm.sh. Using bundled React would cause symbol mismatch
 * where React.isValidElement() fails for elements from esm.sh React.
 */
export async function getProjectReact(): Promise<typeof React> {
  if (isDeno) {
    if (denoReactCache) {
      logger.debug("[getProjectReact] Returning cached Deno esm.sh React");
      return denoReactCache;
    }
    if (denoReactPromise) {
      logger.debug("[getProjectReact] Waiting for in-flight Deno React load");
      return denoReactPromise;
    }
    denoReactPromise = (async () => {
      try {
        const esmReactUrl = `https://esm.sh/react@${REACT_DEFAULT_VERSION}`;
        logger.info("[getProjectReact] Loading React from esm.sh for Deno SSR", { url: esmReactUrl });
        const esmReact = await import(esmReactUrl);
        denoReactCache = esmReact.default || esmReact;
        return denoReactCache as typeof React;
      } catch (error) {
        logger.warn("Failed to load esm.sh React for Deno, falling back to bundled", error);
        denoReactCache = React;
        return React;
      }
    })();
    return denoReactPromise;
  }

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

  projectReactCache = React;
  return React;
}

let denoReactDOMServerCache: typeof import("react-dom/server") | null = null;

async function importReactDOMServerFromProject(): Promise<
  typeof import("react-dom/server")
> {
  if (isDeno) {
    if (denoReactDOMServerCache) {
      logger.debug("[importReactDOMServerFromProject] Returning cached Deno esm.sh ReactDOMServer");
      return denoReactDOMServerCache;
    }
    if (denoReactDOMServerPromise) {
      logger.debug("[importReactDOMServerFromProject] Waiting for in-flight Deno ReactDOMServer load");
      return denoReactDOMServerPromise;
    }
    denoReactDOMServerPromise = (async () => {
      try {
        const esmReactDOMServerUrl = `https://esm.sh/react-dom@${REACT_DEFAULT_VERSION}/server`;
        logger.info("[importReactDOMServerFromProject] Loading react-dom/server from esm.sh", {
          url: esmReactDOMServerUrl,
        });
        const esmReactDOMServer = await import(esmReactDOMServerUrl);
        denoReactDOMServerCache = esmReactDOMServer;
        return esmReactDOMServer;
      } catch (error) {
        logger.warn("Failed to load esm.sh react-dom/server for Deno, falling back to bundled", error);
        const bundled = await import("react-dom/server");
        denoReactDOMServerCache = bundled;
        return bundled;
      }
    })();
    return denoReactDOMServerPromise;
  }

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

export async function warmupReactImports(): Promise<void> {
  logger.debug("[warmupReactImports] Called", { isDeno, denoReactCache: !!denoReactCache });
  if (!isDeno) {
    logger.debug("[warmupReactImports] Skipping - not Deno");
    return;
  }

  if (denoReactCache && denoReactDOMServerCache) {
    logger.debug("[warmupReactImports] Skipping - already cached");
    return;
  }

  logger.info("[warmupReactImports] Pre-loading React from esm.sh for Deno SSR");
  try {
    await Promise.all([
      getProjectReact(),
      importReactDOMServerFromProject(),
    ]);
    logger.info("[warmupReactImports] React pre-loading complete");
  } catch (error) {
    logger.warn("[warmupReactImports] Failed to pre-load React", error);
  }
}

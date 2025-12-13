import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
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

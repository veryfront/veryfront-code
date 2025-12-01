import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { getReactVersionInfo } from "../version-detector/index.ts";

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;

  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;

  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;

  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

interface NodeGlobal {
  process?: {
    versions?: {
      node?: string;
    };
  };
}

function isNodeRuntime(): boolean {
  const g = globalThis as NodeGlobal;
  return typeof Deno === "undefined" && typeof g.process?.versions?.node !== "undefined";
}

let projectReactCache: typeof React | null = null;

/**
 * Get React from the project's node_modules, not the CLI's.
 * This is critical for Node.js to avoid multiple React instances when
 * creating elements that will be rendered with user components.
 *
 * In Deno, returns the bundled React since there's no node_modules conflict.
 */
export async function getProjectReact(): Promise<typeof React> {
  if (projectReactCache) {
    return projectReactCache;
  }

  if (isNodeRuntime()) {
    try {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const projectRequire = createRequire(pathToFileURL(process.cwd() + "/").href);
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
  if (isNodeRuntime()) {
    try {
      const { createRequire } = await import("node:module");
      const { pathToFileURL } = await import("node:url");
      const projectRequire = createRequire(pathToFileURL(process.cwd() + "/").href);
      const reactDomServerPath = projectRequire.resolve("react-dom/server");
      logger.debug("Resolved react-dom/server from project", { path: reactDomServerPath });
      return await import(pathToFileURL(reactDomServerPath).href);
    } catch (error) {
      logger.warn("Failed to resolve react-dom from project, falling back to bundled", error);
      return await import("react-dom/server");
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

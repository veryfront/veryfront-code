/**
 * Server-side React loader for SSR.
 *
 * Uses shared React facades to ensure a single React instance across all runtimes.
 * The facades (src/react/shared-*.ts) handle the complexity of loading React
 * from node_modules (Node/Bun) or caching from esm.sh (Deno).
 *
 * @module react/compat/ssr-adapter/server-loader
 */

import * as React from "react";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;

  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;

  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;

  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

// Caches to ensure single instance
let projectReactCache: typeof React | null = null;
let reactDOMServerCache: ReactDOMServer | null = null;

// Singleflight to prevent concurrent initialization races
const reactLoadFlight = new Singleflight<typeof React>();
const reactDOMServerLoadFlight = new Singleflight<ReactDOMServer>();

/**
 * Reset all cached React and ReactDOM instances.
 * This is critical for test isolation when running parallel tests
 * with different project directories.
 */
export function resetReactCache(): void {
  projectReactCache = null;
  reactDOMServerCache = null;
}

/**
 * Get React for SSR.
 *
 * Uses the shared React facade which handles cross-runtime loading.
 * In Node/Bun: resolves to node_modules
 * In Deno: caches from esm.sh to file://
 */
export async function getProjectReact(): Promise<typeof React> {
  if (projectReactCache) {
    return projectReactCache;
  }

  // Use Singleflight to ensure only one concurrent initialization
  // This prevents race conditions when many requests arrive before React is loaded
  return await reactLoadFlight.do("react", async () => {
    // Double-check after acquiring flight
    if (projectReactCache) {
      return projectReactCache;
    }

    // Import via shared facade (resolved by import map in Deno, or via module resolution in Node/Bun)
    // The facade handles the complexity of cross-runtime loading
    const reactModule = await import("react");
    const mod = reactModule.default ?? reactModule;
    projectReactCache = mod as typeof React;
    return projectReactCache;
  });
}

/**
 * Get ReactDOM server for SSR rendering.
 *
 * Uses the shared ReactDOM server facade which handles cross-runtime loading.
 */
export async function getReactDOMServer(): Promise<ReactDOMServer> {
  if (reactDOMServerCache) {
    return reactDOMServerCache;
  }

  // Use Singleflight to ensure only one concurrent initialization
  // This prevents race conditions when many requests arrive before ReactDOM server is loaded
  return await reactDOMServerLoadFlight.do("react-dom-server", async () => {
    // Double-check after acquiring flight
    if (reactDOMServerCache) {
      return reactDOMServerCache;
    }

    const versionInfo = getReactVersionInfo();

    // Import via shared facade
    const serverModule = await import("react-dom/server");

    const renderToString = serverModule.renderToString;
    const renderToStaticMarkup = serverModule.renderToStaticMarkup;

    let renderToPipeableStream:
      | typeof import("react-dom/server").renderToPipeableStream
      | undefined;
    let renderToReadableStream:
      | typeof import("react-dom/server").renderToReadableStream
      | undefined;

    if (versionInfo.isReact18 || versionInfo.isReact19) {
      renderToPipeableStream = serverModule
        .renderToPipeableStream as typeof import("react-dom/server").renderToPipeableStream;
      renderToReadableStream = serverModule
        .renderToReadableStream as typeof import("react-dom/server").renderToReadableStream;
    }

    reactDOMServerCache = {
      renderToString,
      renderToStaticMarkup,
      renderToPipeableStream,
      renderToReadableStream,
    };

    return reactDOMServerCache;
  });
}

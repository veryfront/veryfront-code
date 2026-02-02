import { getReactVersionInfo } from "../version-detector/index.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { getReactModulePaths } from "#veryfront/bundler/react-cache.ts";
import { rendererLogger as logger } from "#veryfront/utils";

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;
  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;
  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

let projectReactCache: typeof import("react") | null = null;
let reactDOMServerCache: ReactDOMServer | null = null;

const reactLoadFlight = new Singleflight<typeof import("react")>();
const reactDOMServerLoadFlight = new Singleflight<ReactDOMServer>();

export function resetReactCache(): void {
  projectReactCache = null;
  reactDOMServerCache = null;
}

/**
 * Get the shared React instance for SSR.
 *
 * Uses the centralized react-cache module to ensure the same React instance
 * is used by both JIT bundled code and SSR execution. This prevents
 * "multiple React instances" errors during server-side rendering.
 */
export function getProjectReact(): Promise<typeof import("react")> {
  if (projectReactCache) return Promise.resolve(projectReactCache);

  return reactLoadFlight.do("react", async () => {
    if (projectReactCache) return projectReactCache;

    // Use shared react-cache module to ensure same React instance as JIT bundles
    const reactPaths = await getReactModulePaths();
    const reactPath = reactPaths.react;

    logger.debug("[server-loader] Loading React from shared cache", {
      path: reactPath.slice(0, 60) + "...",
    });

    const reactModule = await import(reactPath) as { default?: typeof import("react") };
    projectReactCache = (reactModule.default ?? reactModule) as typeof import("react");
    return projectReactCache;
  });
}

/**
 * Get the shared ReactDOMServer instance for SSR.
 *
 * Uses the centralized react-cache module to ensure react-dom/server
 * uses the same React instance as components, preventing hook mismatches.
 */
export function getReactDOMServer(): Promise<ReactDOMServer> {
  if (reactDOMServerCache) return Promise.resolve(reactDOMServerCache);

  return reactDOMServerLoadFlight.do("react-dom-server", async () => {
    if (reactDOMServerCache) return reactDOMServerCache;

    const versionInfo = getReactVersionInfo();
    const react18Plus = versionInfo.isReact18 || versionInfo.isReact19;

    // Use shared react-cache module to ensure same React instance as JIT bundles
    const reactPaths = await getReactModulePaths();
    const serverPath = reactPaths["react-dom/server"];

    logger.debug("[server-loader] Loading react-dom/server from shared cache", {
      path: serverPath.slice(0, 60) + "...",
    });

    const serverModule = await import(serverPath) as typeof import("react-dom/server");

    reactDOMServerCache = {
      renderToString: serverModule.renderToString,
      renderToStaticMarkup: serverModule.renderToStaticMarkup,
      renderToPipeableStream: react18Plus ? serverModule.renderToPipeableStream : undefined,
      renderToReadableStream: react18Plus ? serverModule.renderToReadableStream : undefined,
    };

    return reactDOMServerCache;
  });
}

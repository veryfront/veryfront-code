import { getReactVersionInfo } from "../version-detector/index.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { getReactModulePaths } from "#veryfront/bundler/react-cache.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { rendererLogger as logger } from "#veryfront/utils";

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;
  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;
  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

/**
 * Per-version React module cache.
 * Key: React version string
 * Value: Loaded React module
 */
const projectReactCacheByVersion = new Map<string, typeof import("react")>();
const reactDOMServerCacheByVersion = new Map<string, ReactDOMServer>();

const reactLoadFlight = new Singleflight<typeof import("react")>();
const reactDOMServerLoadFlight = new Singleflight<ReactDOMServer>();

export function resetReactCache(): void {
  projectReactCacheByVersion.clear();
  reactDOMServerCacheByVersion.clear();
}

/**
 * Get the shared React instance for SSR.
 *
 * Uses the centralized react-cache module to ensure the same React instance
 * is used by both JIT bundled code and SSR execution. This prevents
 * "multiple React instances" errors during server-side rendering.
 *
 * @param reactVersion - React version to load (must match bundled version)
 */
export function getProjectReact(
  reactVersion: string = REACT_DEFAULT_VERSION,
): Promise<typeof import("react")> {
  const cached = projectReactCacheByVersion.get(reactVersion);
  if (cached) return Promise.resolve(cached);

  return reactLoadFlight.do(`react-${reactVersion}`, async () => {
    const existingCache = projectReactCacheByVersion.get(reactVersion);
    if (existingCache) return existingCache;

    // Use shared react-cache module to ensure same React instance as JIT bundles
    const reactPaths = await getReactModulePaths(reactVersion);
    const reactPath = reactPaths.react;

    logger.debug("[server-loader] Loading React from shared cache", {
      version: reactVersion,
      path: reactPath.slice(0, 60) + "...",
    });

    const reactModule = await import(reactPath) as { default?: typeof import("react") };
    const loadedReact = (reactModule.default ?? reactModule) as typeof import("react");
    projectReactCacheByVersion.set(reactVersion, loadedReact);
    return loadedReact;
  });
}

/**
 * Get the shared ReactDOMServer instance for SSR.
 *
 * Uses the centralized react-cache module to ensure react-dom/server
 * uses the same React instance as components, preventing hook mismatches.
 *
 * @param reactVersion - React version to load (must match bundled version)
 */
export function getReactDOMServer(
  reactVersion: string = REACT_DEFAULT_VERSION,
): Promise<ReactDOMServer> {
  const cached = reactDOMServerCacheByVersion.get(reactVersion);
  if (cached) return Promise.resolve(cached);

  return reactDOMServerLoadFlight.do(`react-dom-server-${reactVersion}`, async () => {
    const existingCache = reactDOMServerCacheByVersion.get(reactVersion);
    if (existingCache) return existingCache;

    const versionInfo = getReactVersionInfo();
    const react18Plus = versionInfo.isReact18 || versionInfo.isReact19;

    // Use shared react-cache module to ensure same React instance as JIT bundles
    const reactPaths = await getReactModulePaths(reactVersion);
    const serverPath = reactPaths["react-dom/server"];

    logger.debug("[server-loader] Loading react-dom/server from shared cache", {
      version: reactVersion,
      path: serverPath.slice(0, 60) + "...",
    });

    const serverModule = await import(serverPath) as typeof import("react-dom/server");

    const loadedServer: ReactDOMServer = {
      renderToString: serverModule.renderToString,
      renderToStaticMarkup: serverModule.renderToStaticMarkup,
      renderToPipeableStream: react18Plus ? serverModule.renderToPipeableStream : undefined,
      renderToReadableStream: react18Plus ? serverModule.renderToReadableStream : undefined,
    };

    reactDOMServerCacheByVersion.set(reactVersion, loadedServer);
    return loadedServer;
  });
}

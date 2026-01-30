import { getReactVersionInfo } from "../version-detector/index.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { isDenoCompiled } from "#veryfront/platform/compat/runtime.ts";
import { cacheModuleToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import { getReactUrls } from "#veryfront/transforms/esm/package-registry.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
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

export function getProjectReact(): Promise<typeof import("react")> {
  if (projectReactCache) return Promise.resolve(projectReactCache);

  return reactLoadFlight.do("react", async () => {
    if (projectReactCache) return projectReactCache;

    // For compiled Deno binaries, use cached HTTP modules to ensure the same
    // React instance as user components (which also use cached HTTP modules).
    // Bare imports in compiled binaries resolve to compiled-in versions,
    // creating multiple React instances and breaking hooks.
    if (isDenoCompiled) {
      const urls = getReactUrls();
      const cacheDir = getHttpBundleCacheDir();
      const reactUrl = urls.react;
      if (!reactUrl) {
        throw new Error("[server-loader] React URL not found in getReactUrls()");
      }
      const cachedPath = await cacheModuleToLocal(reactUrl, cacheDir);
      logger.debug("[server-loader] Loading React from cached HTTP module", { cachedPath });
      const reactModule = await import(cachedPath) as { default?: typeof import("react") };
      projectReactCache = (reactModule.default ?? reactModule) as typeof import("react");
    } else {
      const reactModule = await import("react");
      projectReactCache = (reactModule.default ?? reactModule) as typeof import("react");
    }
    return projectReactCache;
  });
}

export function getReactDOMServer(): Promise<ReactDOMServer> {
  if (reactDOMServerCache) return Promise.resolve(reactDOMServerCache);

  return reactDOMServerLoadFlight.do("react-dom-server", async () => {
    if (reactDOMServerCache) return reactDOMServerCache;

    const versionInfo = getReactVersionInfo();
    let serverModule: typeof import("react-dom/server");

    // For compiled Deno binaries, use cached HTTP modules to ensure the same
    // React instance as user components. See getProjectReact() for details.
    if (isDenoCompiled) {
      const urls = getReactUrls();
      const cacheDir = getHttpBundleCacheDir();
      const serverUrl = urls["react-dom/server"];
      if (!serverUrl) {
        throw new Error("[server-loader] react-dom/server URL not found in getReactUrls()");
      }
      const cachedPath = await cacheModuleToLocal(serverUrl, cacheDir);
      logger.debug("[server-loader] Loading react-dom/server from cached HTTP module", {
        cachedPath,
      });
      serverModule = await import(cachedPath) as typeof import("react-dom/server");
    } else {
      serverModule = await import("react-dom/server");
    }

    const react18Plus = versionInfo.isReact18 || versionInfo.isReact19;

    reactDOMServerCache = {
      renderToString: serverModule.renderToString,
      renderToStaticMarkup: serverModule.renderToStaticMarkup,
      renderToPipeableStream: react18Plus ? serverModule.renderToPipeableStream : undefined,
      renderToReadableStream: react18Plus ? serverModule.renderToReadableStream : undefined,
    };

    return reactDOMServerCache;
  });
}

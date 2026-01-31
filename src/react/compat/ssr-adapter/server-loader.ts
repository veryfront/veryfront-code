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

async function loadFromCachedHttpModule<T>(url: string, label: string): Promise<T> {
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(url, cacheDir);
  logger.debug(`[server-loader] Loading ${label} from cached HTTP module`, { cachedPath });
  return (await import(cachedPath)) as T;
}

export function getProjectReact(): Promise<typeof import("react")> {
  if (projectReactCache) return Promise.resolve(projectReactCache);

  return reactLoadFlight.do("react", async () => {
    if (projectReactCache) return projectReactCache;

    if (isDenoCompiled) {
      const reactUrl = getReactUrls().react;
      if (!reactUrl) {
        throw new Error("[server-loader] React URL not found in getReactUrls()");
      }

      const reactModule = await loadFromCachedHttpModule<{ default?: typeof import("react") }>(
        reactUrl,
        "React",
      );
      projectReactCache = (reactModule.default ?? reactModule) as typeof import("react");
      return projectReactCache;
    }

    const reactModule = await import("react");
    projectReactCache = (reactModule.default ?? reactModule) as typeof import("react");
    return projectReactCache;
  });
}

export function getReactDOMServer(): Promise<ReactDOMServer> {
  if (reactDOMServerCache) return Promise.resolve(reactDOMServerCache);

  return reactDOMServerLoadFlight.do("react-dom-server", async () => {
    if (reactDOMServerCache) return reactDOMServerCache;

    const versionInfo = getReactVersionInfo();
    const react18Plus = versionInfo.isReact18 || versionInfo.isReact19;

    let serverModule: typeof import("react-dom/server");
    if (isDenoCompiled) {
      const serverUrl = getReactUrls()["react-dom/server"];
      if (!serverUrl) {
        throw new Error("[server-loader] react-dom/server URL not found in getReactUrls()");
      }
      serverModule = await loadFromCachedHttpModule<typeof import("react-dom/server")>(
        serverUrl,
        "react-dom/server",
      );
    } else {
      serverModule = await import("react-dom/server");
    }

    reactDOMServerCache = {
      renderToString: serverModule.renderToString,
      renderToStaticMarkup: serverModule.renderToStaticMarkup,
      renderToPipeableStream: react18Plus ? serverModule.renderToPipeableStream : undefined,
      renderToReadableStream: react18Plus ? serverModule.renderToReadableStream : undefined,
    };

    return reactDOMServerCache;
  });
}

import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { cacheModuleToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import {
  getReactUrls,
  normalizeReactVersion,
  stripSemverRange,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { rendererLogger } from "#veryfront/utils";

const logger = rendererLogger.component("server-loader");

export interface ReactDOMServer {
  renderToString: typeof import("react-dom/server").renderToString;
  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;
  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

type ServerModuleLoader = (url: string, label: string, reactVersion: string) => Promise<unknown>;

const projectReactCache = new Map<string, typeof import("react")>();
const reactDOMServerCache = new Map<string, ReactDOMServer>();

const reactLoadFlight = new Singleflight<typeof import("react")>();
const reactDOMServerLoadFlight = new Singleflight<ReactDOMServer>();

export function resetReactCache(): void {
  projectReactCache.clear();
  reactDOMServerCache.clear();
}

function resolveReactVersion(version?: string): string {
  return normalizeReactVersion(version ? stripSemverRange(version) : undefined);
}

export function __injectReactDOMServerForTests(
  server: ReactDOMServer | null,
  version?: string,
): void {
  if (!server) {
    reactDOMServerCache.clear();
    return;
  }

  reactDOMServerCache.set(resolveReactVersion(version), server);
}

async function loadFromCachedHttpModule<T>(
  url: string,
  label: string,
  reactVersion: string,
): Promise<T> {
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(url, cacheDir, reactVersion);
  logger.debug(`Loading ${label} from cached HTTP module`, { cachedPath });
  return (await import(cachedPath)) as T;
}

let serverModuleLoader: ServerModuleLoader = loadFromCachedHttpModule;

export function __setServerModuleLoaderForTests(loader: ServerModuleLoader | null): void {
  serverModuleLoader = loader ?? loadFromCachedHttpModule;
}

export function getProjectReact(version?: string): Promise<typeof import("react")> {
  const normalizedVersion = resolveReactVersion(version);
  const cached = projectReactCache.get(normalizedVersion);
  if (cached) return Promise.resolve(cached);

  return reactLoadFlight.do(`react:${normalizedVersion}`, async () => {
    const cachedInFlight = projectReactCache.get(normalizedVersion);
    if (cachedInFlight) return cachedInFlight;

    // Always load React from cached HTTP modules to ensure the same React
    // instance is used by both react-dom/server and MDX components.
    // This prevents "multiple React instances" errors in SSR.
    const reactUrl = getReactUrls(normalizedVersion).react;
    if (!reactUrl) {
      throw INITIALIZATION_ERROR.create({
        detail: "[server-loader] React URL not found in getReactUrls()",
      });
    }

    const reactModule = await serverModuleLoader(
      reactUrl,
      "React",
      normalizedVersion,
    ) as { default?: typeof import("react") };
    const loadedReact = (reactModule.default ?? reactModule) as typeof import("react");
    projectReactCache.set(normalizedVersion, loadedReact);
    return loadedReact;
  });
}

export function getReactDOMServer(version?: string): Promise<ReactDOMServer> {
  const normalizedVersion = resolveReactVersion(version);
  const cached = reactDOMServerCache.get(normalizedVersion);
  if (cached) return Promise.resolve(cached);

  return reactDOMServerLoadFlight.do(`react-dom-server:${normalizedVersion}`, async () => {
    const cachedInFlight = reactDOMServerCache.get(normalizedVersion);
    if (cachedInFlight) return cachedInFlight;

    const react18Plus = Number(normalizedVersion.split(".")[0]) >= 18;

    // Always load react-dom/server from cached HTTP modules to ensure
    // it uses the same React instance as MDX components (which also use
    // cached HTTP bundles). This prevents "multiple React instances" errors
    // where components use React from one source and react-dom/server from another.
    const serverUrl = getReactUrls(normalizedVersion)["react-dom/server"];
    if (!serverUrl) {
      throw INITIALIZATION_ERROR.create({
        detail: "[server-loader] react-dom/server URL not found in getReactUrls()",
      });
    }
    const serverModule = await serverModuleLoader(
      serverUrl,
      "react-dom/server",
      normalizedVersion,
    ) as typeof import("react-dom/server");

    const loadedServer = {
      renderToString: serverModule.renderToString,
      renderToStaticMarkup: serverModule.renderToStaticMarkup,
      renderToPipeableStream: react18Plus ? serverModule.renderToPipeableStream : undefined,
      renderToReadableStream: react18Plus ? serverModule.renderToReadableStream : undefined,
    };

    reactDOMServerCache.set(normalizedVersion, loadedServer);
    return loadedServer;
  });
}

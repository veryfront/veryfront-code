import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { cacheModuleToLocal } from "#veryfront/transforms/esm/http-cache.ts";
import {
  isValidReactVersion,
  normalizeReactVersion,
  stripSemverRange,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getReactUrls } from "#veryfront/transforms/esm/react-cdn.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { rendererLogger } from "#veryfront/utils";
import type { SSROptions } from "./types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import { versionAdmission } from "#veryfront/platform/compat/semver.ts";
import {
  assertReactDOMPeerVersion,
  assertReactPackageDeclaration,
  getLocalReactPath,
  getLocalReactPaths,
  getLocalReactVersions,
  type LocalReactPeerSnapshot,
  resolveInstalledReactRange,
} from "#veryfront/platform/compat/react-paths.ts";

const logger = rendererLogger.component("server-loader");

export interface ReactDOMServer {
  readonly version?: string;
  renderToString: typeof import("react-dom/server").renderToString;
  renderToStaticMarkup: typeof import("react-dom/server").renderToStaticMarkup;
  renderToPipeableStream?: typeof import("react-dom/server").renderToPipeableStream;
  renderToReadableStream?: typeof import("react-dom/server").renderToReadableStream;
}

/** Realm-local React modules loaded from the same prepared dependency graph. */
export interface ReactServerRuntime {
  readonly react: typeof import("react");
  readonly server: ReactDOMServer;
}

function isReactDOMServer(
  module: unknown,
): module is ReactDOMServer {
  if (module === null || typeof module !== "object") return false;
  const server = module as Record<string, unknown>;
  return typeof server.renderToString === "function" &&
    typeof server.renderToStaticMarkup === "function" &&
    (server.renderToReadableStream === undefined ||
      typeof server.renderToReadableStream === "function") &&
    (server.renderToPipeableStream === undefined ||
      typeof server.renderToPipeableStream === "function");
}

/** Select an explicit runtime without reading or modifying the legacy module caches. */
export async function resolveSSRRuntime(
  options: Pick<SSROptions, "reactVersion" | "reactRuntime" | "renderContext" | "reactPeers">,
  adapter?: RuntimeAdapter,
): Promise<{ server: ReactDOMServer; react: typeof import("react") | null }> {
  const supplied = options.reactRuntime;
  if (supplied !== undefined) {
    const { react, server } = supplied;
    validateReactRuntimeVersion(react, options.reactVersion);
    if (!isReactDOMServer(server)) {
      throw INITIALIZATION_ERROR.create({
        detail: "Explicit React server runtime has invalid render exports",
      });
    }
    if (server.version !== undefined) assertReactDOMPeerVersion(react.version, server.version);
    return { react, server };
  }
  const [server, react] = await Promise.all([
    getReactDOMServer(options.reactVersion, adapter, options.reactPeers),
    options.renderContext || options.reactPeers || getRuntimeModuleLoader(adapter)
      ? getProjectReact(options.reactVersion, adapter, options.reactPeers)
      : Promise.resolve(null),
  ]);
  return { react, server };
}

function validateReactRuntimeVersion(
  react: typeof import("react"),
  requestedVersion?: string,
): void {
  const version = react.version;
  if (typeof version !== "string" || !isValidReactVersion(version)) {
    throw INITIALIZATION_ERROR.create({
      detail: "React runtime version must be an exact semantic version",
    });
  }
  if (
    requestedVersion !== undefined &&
    versionAdmission(version, requestedVersion) === false
  ) {
    throw INITIALIZATION_ERROR.create({
      detail: "React runtime version does not match the selected project version",
    });
  }
}

type ServerModuleLoader = (
  url: string,
  label: string,
  reactVersion: string,
  reactPeers?: LocalReactPeerSnapshot,
) => Promise<unknown>;

const projectReactCache = new Map<string, typeof import("react")>();
const reactDOMServerCache = new Map<string, ReactDOMServer>();

const reactLoadFlight = new Singleflight<typeof import("react")>();
const reactDOMServerLoadFlight = new Singleflight<ReactDOMServer>();

export function resetReactCache(): void {
  projectReactCache.clear();
  reactDOMServerCache.clear();
}

function resolveReactVersion(version?: string, peers?: LocalReactPeerSnapshot): string {
  if (peers?.versions.react) {
    assertReactPackageDeclaration(version);
    if (version !== undefined && versionAdmission(peers.versions.react, version) === false) {
      throw new TypeError("Captured React runtime does not match the selected project version");
    }
    return peers.versions.react;
  }
  const installed = resolveInstalledReactRange(version);
  if (installed) return installed;
  const normalized = normalizeReactVersion(version ? stripSemverRange(version) : undefined);
  // Exact SemVer permits a v prefix; package exports report the bare version.
  return normalized.startsWith("v") ? normalized.slice(1) : normalized;
}

export function __injectReactDOMServerForTests(
  server: ReactDOMServer | null,
  version?: string,
): void {
  if (!server) {
    reactDOMServerCache.clear();
    return;
  }

  reactDOMServerCache.set(rendererRuntimeCacheKey(resolveReactVersion(version)), server);
}

export function __injectProjectReactForTests(
  react: typeof import("react") | null,
  version?: string,
): void {
  if (!react) {
    projectReactCache.clear();
    return;
  }
  projectReactCache.set(rendererRuntimeCacheKey(resolveReactVersion(version)), react);
}

async function loadFromCachedHttpModule<T>(
  url: string,
  label: string,
  reactVersion: string,
  reactPeers?: LocalReactPeerSnapshot,
): Promise<T> {
  const localPath = getLocalReactPath(
    label === "React" ? "react" : label,
    reactVersion,
    reactPeers,
  );
  if (localPath) {
    const module = await import(localPath);
    if (label === "React") validateReactRuntimeVersion(module.default ?? module, reactVersion);
    return module as T;
  }
  const cacheDir = getHttpBundleCacheDir();
  const cachedPath = await cacheModuleToLocal(url, cacheDir, reactVersion);
  logger.debug(`Loading ${label} from cached HTTP module`, { cachedPath });
  return (await import(cachedPath)) as T;
}

const encodeCachePart = JSON.stringify;

/** Keep renderer modules and flights on the same fresh physical peer identity. */
function rendererRuntimeCacheKey(version: string, peers?: LocalReactPeerSnapshot): string {
  const paths = peers?.paths ?? getLocalReactPaths({ fresh: true });
  const versions = peers?.versions ?? getLocalReactVersions();
  // Quote only primitives; inherited object/array toJSON hooks cannot merge keys.
  return `${encodeCachePart(version)}|${encodeCachePart(paths.react ?? "")}|${
    encodeCachePart(paths["react-dom/server"] ?? "")
  }|${encodeCachePart(versions.react ?? "")}|${encodeCachePart(versions["react-dom"] ?? "")}`;
}

let serverModuleLoader: ServerModuleLoader = loadFromCachedHttpModule;

export function __setServerModuleLoaderForTests(loader: ServerModuleLoader | null): void {
  serverModuleLoader = loader ?? loadFromCachedHttpModule;
}

export function getProjectReact(
  version?: string,
  adapter?: RuntimeAdapter,
  reactPeers?: LocalReactPeerSnapshot,
): Promise<typeof import("react")> {
  const prepared = getRuntimeModuleLoader(adapter);
  if (prepared) {
    return prepared.importModule({ kind: "package", specifier: "react" }).then((module) => {
      const react = (module.default ?? module) as typeof import("react");
      validateReactRuntimeVersion(react, version);
      return react;
    });
  }
  const normalizedVersion = resolveReactVersion(version, reactPeers);
  const cacheKey = rendererRuntimeCacheKey(normalizedVersion, reactPeers);
  const cached = projectReactCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  return reactLoadFlight.do(`react:${cacheKey}`, async () => {
    const cachedInFlight = projectReactCache.get(cacheKey);
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
      reactPeers,
    ) as { default?: typeof import("react") };
    const loadedReact = (reactModule.default ?? reactModule) as typeof import("react");
    projectReactCache.set(cacheKey, loadedReact);
    return loadedReact;
  });
}

export function getReactDOMServer(
  version?: string,
  adapter?: RuntimeAdapter,
  reactPeers?: LocalReactPeerSnapshot,
): Promise<ReactDOMServer> {
  const prepared = getRuntimeModuleLoader(adapter);
  if (prepared) {
    return prepared.importModule({ kind: "package", specifier: "react-dom/server" }).then(
      (module) => {
        if (!isReactDOMServer(module)) {
          throw INITIALIZATION_ERROR.create({
            detail: "Prepared React server module has invalid render exports",
          });
        }
        return getProjectReact(version, adapter).then((react) => {
          assertReactDOMPeerVersion(react.version, module.version);
          return module;
        });
      },
    );
  }
  const normalizedVersion = resolveReactVersion(version, reactPeers);
  const cacheKey = rendererRuntimeCacheKey(normalizedVersion, reactPeers);
  const cached = reactDOMServerCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  return reactDOMServerLoadFlight.do(`react-dom-server:${cacheKey}`, async () => {
    const cachedInFlight = reactDOMServerCache.get(cacheKey);
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
      reactPeers,
    ) as typeof import("react-dom/server");

    // Node may retain a module instance when package files change in place.
    // A refreshed manifest must never relabel an older renderer as the new peer.
    assertReactDOMPeerVersion(normalizedVersion, serverModule.version);
    const loadedServer = {
      version: serverModule.version,
      renderToString: serverModule.renderToString,
      renderToStaticMarkup: serverModule.renderToStaticMarkup,
      renderToPipeableStream: react18Plus ? serverModule.renderToPipeableStream : undefined,
      renderToReadableStream: react18Plus ? serverModule.renderToReadableStream : undefined,
    };

    reactDOMServerCache.set(cacheKey, loadedServer);
    return loadedServer;
  });
}

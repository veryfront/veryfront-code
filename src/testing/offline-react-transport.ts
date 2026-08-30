import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  __getCapturedHostFetchForTests,
  __installOutboundFetchTransportForTests,
} from "#veryfront/security/http/outbound-fetch.ts";
import { resolveHostAddresses } from "#veryfront/platform/compat/dns.ts";
import { REACT_DEFAULT_VERSION, REACT_VERSION_18_3 } from "#veryfront/utils/constants/cdn.ts";
import { EsbuildBundler } from "@veryfront/ext-bundler-esbuild";

const OFFLINE_REACT_ORIGIN = "https://esm.sh";
const OFFLINE_REACT_MODULE_PREFIX = "/__veryfront_test_react__/";
// RFC 5737 TEST-NET-1 address: the offline transport answers esm.sh requests
// in-process, so this resolution result is never dialed.
const OFFLINE_REACT_RESOLVED_ADDRESS = "192.0.2.1";
const REACT_VERSION_19_1 = "19.1.1";
const MAX_OFFLINE_REACT_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_OFFLINE_REACT_CACHE_ENTRIES = 128;
const OFFLINE_UNIT_MODULE_FIXTURES: Readonly<Record<string, string>> = Object.freeze({
  "/lodash": "export function merge(left, right) { return { ...left, ...right }; }\n",
});

export const OFFLINE_REACT_TEST_ENV = "VERYFRONT_TEST_OFFLINE_REACT";

const OFFLINE_REACT_PACKAGE_URLS = Object.freeze({
  [REACT_VERSION_18_3]: Object.freeze({
    react: import.meta.resolve("npm:react@18.3.1"),
    "react-dom": import.meta.resolve("npm:react-dom@18.3.1"),
  }),
  [REACT_VERSION_19_1]: Object.freeze({
    react: import.meta.resolve("npm:react@19.1.1"),
    "react-dom": import.meta.resolve("npm:react-dom@19.1.1"),
  }),
  [REACT_DEFAULT_VERSION]: Object.freeze({
    react: import.meta.resolve("npm:react@19.2.4"),
    "react-dom": import.meta.resolve("npm:react-dom@19.2.4"),
  }),
});

type OfflineReactVersion = keyof typeof OFFLINE_REACT_PACKAGE_URLS;

type OfflineReactEntry = {
  readonly outputName: string;
  readonly packageName: "react" | "react-dom";
  readonly exportNamesByVersion: Readonly<
    Record<OfflineReactVersion, readonly string[]>
  >;
  readonly sourceFileName?: string;
};

function isOfflineReactVersion(value: string): value is OfflineReactVersion {
  return Object.hasOwn(OFFLINE_REACT_PACKAGE_URLS, value);
}

const OFFLINE_REACT_ENTRIES = Object.freeze(
  {
    react: {
      outputName: "react",
      packageName: "react",
      exportNamesByVersion: {
        [REACT_VERSION_18_3]: [
          "Children",
          "Component",
          "Fragment",
          "Profiler",
          "PureComponent",
          "StrictMode",
          "Suspense",
          "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
          "act",
          "cloneElement",
          "createContext",
          "createElement",
          "createFactory",
          "createRef",
          "forwardRef",
          "isValidElement",
          "lazy",
          "memo",
          "startTransition",
          "unstable_act",
          "useCallback",
          "useContext",
          "useDebugValue",
          "useDeferredValue",
          "useEffect",
          "useId",
          "useImperativeHandle",
          "useInsertionEffect",
          "useLayoutEffect",
          "useMemo",
          "useReducer",
          "useRef",
          "useState",
          "useSyncExternalStore",
          "useTransition",
          "version",
        ],
        [REACT_VERSION_19_1]: [
          "Children",
          "Component",
          "Fragment",
          "Profiler",
          "PureComponent",
          "StrictMode",
          "Suspense",
          "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
          "__COMPILER_RUNTIME",
          "act",
          "cache",
          "captureOwnerStack",
          "cloneElement",
          "createContext",
          "createElement",
          "createRef",
          "forwardRef",
          "isValidElement",
          "lazy",
          "memo",
          "startTransition",
          "unstable_useCacheRefresh",
          "use",
          "useActionState",
          "useCallback",
          "useContext",
          "useDebugValue",
          "useDeferredValue",
          "useEffect",
          "useId",
          "useImperativeHandle",
          "useInsertionEffect",
          "useLayoutEffect",
          "useMemo",
          "useOptimistic",
          "useReducer",
          "useRef",
          "useState",
          "useSyncExternalStore",
          "useTransition",
          "version",
        ],
        [REACT_DEFAULT_VERSION]: [
          "Activity",
          "Children",
          "Component",
          "Fragment",
          "Profiler",
          "PureComponent",
          "StrictMode",
          "Suspense",
          "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
          "__COMPILER_RUNTIME",
          "act",
          "cache",
          "cacheSignal",
          "captureOwnerStack",
          "cloneElement",
          "createContext",
          "createElement",
          "createRef",
          "forwardRef",
          "isValidElement",
          "lazy",
          "memo",
          "startTransition",
          "unstable_useCacheRefresh",
          "use",
          "useActionState",
          "useCallback",
          "useContext",
          "useDebugValue",
          "useDeferredValue",
          "useEffect",
          "useEffectEvent",
          "useId",
          "useImperativeHandle",
          "useInsertionEffect",
          "useLayoutEffect",
          "useMemo",
          "useOptimistic",
          "useReducer",
          "useRef",
          "useState",
          "useSyncExternalStore",
          "useTransition",
          "version",
        ],
      },
    },
    "react-jsx-runtime": {
      outputName: "react-jsx-runtime",
      packageName: "react",
      sourceFileName: "jsx-runtime.js",
      exportNamesByVersion: {
        [REACT_VERSION_18_3]: ["Fragment", "jsx", "jsxs"],
        [REACT_VERSION_19_1]: ["Fragment", "jsx", "jsxs"],
        [REACT_DEFAULT_VERSION]: ["Fragment", "jsx", "jsxs"],
      },
    },
    "react-jsx-dev-runtime": {
      outputName: "react-jsx-dev-runtime",
      packageName: "react",
      sourceFileName: "jsx-dev-runtime.js",
      exportNamesByVersion: {
        [REACT_VERSION_18_3]: ["Fragment", "jsxDEV"],
        [REACT_VERSION_19_1]: ["Fragment", "jsxDEV"],
        [REACT_DEFAULT_VERSION]: ["Fragment", "jsxDEV"],
      },
    },
    "react-dom": {
      outputName: "react-dom",
      packageName: "react-dom",
      exportNamesByVersion: {
        [REACT_VERSION_18_3]: [
          "__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED",
          "createPortal",
          "createRoot",
          "findDOMNode",
          "flushSync",
          "hydrate",
          "hydrateRoot",
          "render",
          "unmountComponentAtNode",
          "unstable_batchedUpdates",
          "unstable_renderSubtreeIntoContainer",
          "version",
        ],
        [REACT_VERSION_19_1]: [
          "__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
          "createPortal",
          "flushSync",
          "preconnect",
          "prefetchDNS",
          "preinit",
          "preinitModule",
          "preload",
          "preloadModule",
          "requestFormReset",
          "unstable_batchedUpdates",
          "useFormState",
          "useFormStatus",
          "version",
        ],
        [REACT_DEFAULT_VERSION]: [
          "__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
          "createPortal",
          "flushSync",
          "preconnect",
          "prefetchDNS",
          "preinit",
          "preinitModule",
          "preload",
          "preloadModule",
          "requestFormReset",
          "unstable_batchedUpdates",
          "useFormState",
          "useFormStatus",
          "version",
        ],
      },
    },
    "react-dom-client": {
      outputName: "react-dom-client",
      packageName: "react-dom",
      sourceFileName: "client.js",
      exportNamesByVersion: {
        [REACT_VERSION_18_3]: ["createRoot", "hydrateRoot"],
        [REACT_VERSION_19_1]: ["createRoot", "hydrateRoot", "version"],
        [REACT_DEFAULT_VERSION]: ["createRoot", "hydrateRoot", "version"],
      },
    },
    "react-dom-server": {
      outputName: "react-dom-server",
      packageName: "react-dom",
      sourceFileName: "server.browser.js",
      exportNamesByVersion: {
        [REACT_VERSION_18_3]: [
          "renderToNodeStream",
          "renderToReadableStream",
          "renderToStaticMarkup",
          "renderToStaticNodeStream",
          "renderToString",
          "version",
        ],
        [REACT_VERSION_19_1]: [
          "renderToReadableStream",
          "renderToStaticMarkup",
          "renderToString",
          "version",
        ],
        [REACT_DEFAULT_VERSION]: [
          "renderToReadableStream",
          "renderToStaticMarkup",
          "renderToString",
          "resume",
          "version",
        ],
      },
    },
  } satisfies Readonly<Record<string, OfflineReactEntry>>,
);

type OfflineReactEntryKey = keyof typeof OFFLINE_REACT_ENTRIES;

let bundledModules: Promise<ReadonlyMap<string, string>> | undefined;
let cachePaths: Promise<{ cache: string; lock: string }> | undefined;

async function getOfflineReactCachePaths(): Promise<{ cache: string; lock: string }> {
  cachePaths ??= (async () => {
    const identity = JSON.stringify({
      versions: Object.keys(OFFLINE_REACT_PACKAGE_URLS),
      entries: OFFLINE_REACT_ENTRIES,
      generation: [
        createEntrySource.toString(),
        buildOfflineReactModules.toString(),
      ],
    });
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)),
    );
    const key = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const cache = join(tmpdir(), `veryfront-offline-react-${key}.json`);
    return { cache, lock: `${cache}.lock` };
  })();
  return await cachePaths;
}

function parseBundledModuleCache(serialized: string): ReadonlyMap<string, string> | undefined {
  if (new TextEncoder().encode(serialized).byteLength > MAX_OFFLINE_REACT_CACHE_BYTES) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_OFFLINE_REACT_CACHE_ENTRIES) {
    return undefined;
  }
  const modules = new Map<string, string>();
  for (const entry of parsed) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== "string" ||
      !entry[0].startsWith(OFFLINE_REACT_MODULE_PREFIX) ||
      typeof entry[1] !== "string"
    ) {
      return undefined;
    }
    modules.set(entry[0], entry[1]);
  }
  return modules;
}

async function readBundledModuleCache(
  cachePath: string,
): Promise<ReadonlyMap<string, string> | undefined> {
  try {
    return parseBundledModuleCache(await Deno.readTextFile(cachePath));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function buildOrReadOfflineReactModules(): Promise<ReadonlyMap<string, string>> {
  const paths = await getOfflineReactCachePaths();
  const lockFile = await Deno.open(paths.lock, {
    create: true,
    read: true,
    write: true,
    mode: 0o600,
  });
  try {
    await lockFile.lock(true);
    const cached = await readBundledModuleCache(paths.cache);
    if (cached) return cached;
    const modules = await buildOfflineReactModules();
    const serialized = JSON.stringify([...modules]);
    if (
      modules.size > MAX_OFFLINE_REACT_CACHE_ENTRIES ||
      new TextEncoder().encode(serialized).byteLength > MAX_OFFLINE_REACT_CACHE_BYTES
    ) {
      return modules;
    }
    await Deno.writeTextFile(paths.cache, serialized, {
      mode: 0o600,
    });
    return modules;
  } finally {
    try {
      await lockFile.unlock();
    } finally {
      lockFile.close();
    }
  }
}

function createEntrySource(
  entry: OfflineReactEntry,
  version: OfflineReactVersion,
): string {
  const resolvedUrl = new URL(OFFLINE_REACT_PACKAGE_URLS[version][entry.packageName]);
  const packagePath = fileURLToPath(
    entry.sourceFileName === undefined ? resolvedUrl : new URL(entry.sourceFileName, resolvedUrl),
  );
  const exports = entry.exportNamesByVersion[version]
    .map((name) => `export const ${name} = moduleValue.${name};`)
    .join("\n");
  return `import moduleValue from ${
    JSON.stringify(packagePath)
  };\n${exports}\nexport default moduleValue;\n`;
}

async function buildOfflineReactModules(): Promise<ReadonlyMap<string, string>> {
  const bundler = new EsbuildBundler();
  try {
    const reactPathByReactDomDirectory = Object.values(OFFLINE_REACT_PACKAGE_URLS).map(
      (urls) => ({
        reactPath: fileURLToPath(new URL(urls.react)),
        reactDomDirectory: fileURLToPath(new URL(".", urls["react-dom"])),
      }),
    );
    const entryPoints = Object.fromEntries(
      Object.keys(OFFLINE_REACT_PACKAGE_URLS).flatMap((version) =>
        Object.entries(OFFLINE_REACT_ENTRIES).map(([key, entry]) => [
          `${version}/${entry.outputName}`,
          `offline-react:${version}:${key}`,
        ])
      ),
    );
    const result = await bundler.bundle({
      entryPoints,
      bundle: true,
      splitting: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      write: false,
      outdir: "offline-react",
      entryNames: "[dir]/[name]",
      chunkNames: "chunks/[name]-[hash]",
      publicPath: `${OFFLINE_REACT_ORIGIN}${OFFLINE_REACT_MODULE_PREFIX.slice(0, -1)}`,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "veryfront-offline-react-entries",
        setup(build) {
          build.onResolve(
            { filter: /^react$/ },
            (args) => {
              const match = reactPathByReactDomDirectory.find(({ reactDomDirectory }) =>
                args.importer.startsWith(reactDomDirectory)
              );
              return match ? { path: match.reactPath } : null;
            },
          );
          build.onResolve({ filter: /^offline-react:/ }, (args) => ({
            path: args.path.slice("offline-react:".length),
            namespace: "veryfront-offline-react",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "veryfront-offline-react" },
            (args) => {
              const [version, key] = args.path.split(":", 2);
              if (!version || !isOfflineReactVersion(version) || !key) return null;
              const entry = OFFLINE_REACT_ENTRIES[key as OfflineReactEntryKey];
              if (!entry) return null;
              return {
                contents: createEntrySource(entry, version),
                loader: "js",
                resolveDir: Deno.cwd(),
              };
            },
          );
        },
      }],
    });

    const modules = new Map<string, string>();
    for (const outputFile of result.outputFiles) {
      const normalizedPath = outputFile.path.replaceAll("\\", "/");
      const marker = "/offline-react/";
      const markerIndex = normalizedPath.lastIndexOf(marker);
      if (markerIndex < 0) continue;
      const relativePath = normalizedPath.slice(markerIndex + marker.length);
      modules.set(`${OFFLINE_REACT_MODULE_PREFIX}${relativePath}`, outputFile.text);
    }
    return modules;
  } finally {
    await bundler.stop();
  }
}

function getBundledModules(): Promise<ReadonlyMap<string, string>> {
  bundledModules ??= buildOrReadOfflineReactModules();
  return bundledModules;
}

/** Build and stop the test-only ESM bundler before per-test sanitizers start. */
export async function prepareOfflineReactModulesForTests(): Promise<void> {
  await getBundledModules();
}

function responsePath(url: URL): string | undefined {
  if (url.origin !== OFFLINE_REACT_ORIGIN) return undefined;
  if (url.pathname.startsWith(OFFLINE_REACT_MODULE_PREFIX)) return url.pathname;
  const match = /^\/(react|react-dom)@([^/]+)(?:\/(jsx-runtime|jsx-dev-runtime|client|server))?$/
    .exec(
      url.pathname,
    );
  if (!match) return undefined;
  const entryKey = (() => {
    const packageName = match[1];
    const subpath = match[3];
    if (packageName === "react") {
      if (subpath === undefined) return "react";
      if (subpath === "jsx-runtime") return "react-jsx-runtime";
      if (subpath === "jsx-dev-runtime") return "react-jsx-dev-runtime";
      return undefined;
    }
    if (subpath === undefined) return "react-dom";
    if (subpath === "client") return "react-dom-client";
    if (subpath === "server") return "react-dom-server";
    return undefined;
  })() satisfies OfflineReactEntryKey | undefined;
  const version = match[2];
  return entryKey === undefined || !version || !isOfflineReactVersion(version)
    ? undefined
    : `${OFFLINE_REACT_MODULE_PREFIX}${version}/${OFFLINE_REACT_ENTRIES[entryKey].outputName}.js`;
}

/** Return whether the URL is backed by the offline React module graph. */
export function isOfflineUnitModuleUrlForTests(url: URL): boolean {
  return (url.origin === OFFLINE_REACT_ORIGIN &&
    Object.hasOwn(OFFLINE_UNIT_MODULE_FIXTURES, url.pathname)) ||
    responsePath(url) !== undefined;
}

/**
 * Return one test-only React ESM response, or undefined for every unrelated URL.
 *
 * The suite verifies version selection through authored URLs and cache identity.
 * Module bytes come from the repository-pinned React build so a unit run never
 * downloads historical package versions merely to exercise that plumbing.
 */
export async function createOfflineReactModuleResponseForTests(
  url: URL,
): Promise<Response | undefined> {
  if (url.origin === OFFLINE_REACT_ORIGIN) {
    const fixture = OFFLINE_UNIT_MODULE_FIXTURES[url.pathname];
    if (fixture !== undefined) {
      return new Response(fixture, {
        status: 200,
        headers: { "content-type": "application/javascript; charset=utf-8" },
      });
    }
  }
  const path = responsePath(url);
  if (path === undefined) return undefined;
  const source = (await getBundledModules()).get(path);
  if (source === undefined) return undefined;
  return new Response(source, {
    status: 200,
    headers: { "content-type": "application/javascript; charset=utf-8" },
  });
}

async function resolveTestHost(hostname: string): Promise<string[]> {
  if (hostname === "esm.sh") return [OFFLINE_REACT_RESOLVED_ADDRESS];
  if (hostname === "localhost") return ["127.0.0.1", "::1"];
  if (isIP(hostname) !== 0) return [hostname];

  return await resolveHostAddresses(hostname);
}

function toRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  if (input instanceof URL) return input;
  return new URL(input);
}

/** Install the unit-suite-only React ESM transport until the returned cleanup runs. */
export function installOfflineReactTransportForTests(): () => void {
  const hostFetch = __getCapturedHostFetchForTests();
  const fetchWithOfflineReact: typeof globalThis.fetch = async (input, init) => {
    const url = toRequestUrl(input);
    return await createOfflineReactModuleResponseForTests(url) ?? await hostFetch(input, init);
  };
  return __installOutboundFetchTransportForTests({
    fetch: fetchWithOfflineReact,
    pinnedFetch: (url, _addresses, init) => fetchWithOfflineReact(url, init),
    resolveHost: resolveTestHost,
  }, {
    // The egress guard rejects the reserved TEST-NET-1 resolution unless it
    // is allowed explicitly; the transport still answers esm.sh in-process.
    allowedResolvedAddresses: [OFFLINE_REACT_RESOLVED_ADDRESS],
  });
}

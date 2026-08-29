import { isIP } from "node:net";
import { fileURLToPath } from "node:url";
import {
  __getCapturedHostFetchForTests,
  __installOutboundFetchTransportForTests,
} from "#veryfront/security/http/outbound-fetch.ts";
import { resolveHostAddresses } from "#veryfront/platform/compat/dns.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { EsbuildBundler } from "@veryfront/ext-bundler-esbuild";

const OFFLINE_REACT_ORIGIN = "https://esm.sh";
const OFFLINE_REACT_MODULE_PREFIX = "/__veryfront_test_react__/";
const OFFLINE_REACT_RESOLVED_ADDRESS = "93.184.216.34";
const OFFLINE_UNIT_MODULE_FIXTURES: Readonly<Record<string, string>> = Object.freeze({
  "/lodash": "export function merge(left, right) { return { ...left, ...right }; }\n",
});

export const OFFLINE_REACT_TEST_ENV = "VERYFRONT_TEST_OFFLINE_REACT";

type OfflineReactEntry = {
  readonly outputName: string;
  readonly packageSpecifier: string;
  readonly exportNames: readonly string[];
  readonly sourceFileName?: string;
};

const OFFLINE_REACT_ENTRIES = Object.freeze(
  {
    react: {
      outputName: "react",
      packageSpecifier: `npm:react@${REACT_DEFAULT_VERSION}`,
      exportNames: [
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
    "react-jsx-runtime": {
      outputName: "react-jsx-runtime",
      packageSpecifier: `npm:react@${REACT_DEFAULT_VERSION}/jsx-runtime`,
      exportNames: ["Fragment", "jsx", "jsxs"],
    },
    "react-jsx-dev-runtime": {
      outputName: "react-jsx-dev-runtime",
      packageSpecifier: `npm:react@${REACT_DEFAULT_VERSION}/jsx-dev-runtime`,
      exportNames: ["Fragment", "jsxDEV"],
    },
    "react-dom": {
      outputName: "react-dom",
      packageSpecifier: `npm:react-dom@${REACT_DEFAULT_VERSION}`,
      exportNames: [
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
    "react-dom-client": {
      outputName: "react-dom-client",
      packageSpecifier: `npm:react-dom@${REACT_DEFAULT_VERSION}/client`,
      exportNames: ["createRoot", "hydrateRoot", "version"],
    },
    "react-dom-server": {
      outputName: "react-dom-server",
      packageSpecifier: `npm:react-dom@${REACT_DEFAULT_VERSION}/server`,
      sourceFileName: "server.edge.js",
      exportNames: [
        "renderToReadableStream",
        "renderToStaticMarkup",
        "renderToString",
        "resume",
        "version",
      ],
    },
  } satisfies Readonly<Record<string, OfflineReactEntry>>,
);

type OfflineReactEntryKey = keyof typeof OFFLINE_REACT_ENTRIES;

let bundledModules: Promise<ReadonlyMap<string, string>> | undefined;

function createEntrySource(entry: OfflineReactEntry): string {
  const resolvedUrl = new URL(import.meta.resolve(entry.packageSpecifier));
  const packagePath = fileURLToPath(
    entry.sourceFileName === undefined ? resolvedUrl : new URL(entry.sourceFileName, resolvedUrl),
  );
  const exports = entry.exportNames.map((name) => `export const ${name} = moduleValue.${name};`)
    .join("\n");
  return `import moduleValue from ${
    JSON.stringify(packagePath)
  };\n${exports}\nexport default moduleValue;\n`;
}

async function buildOfflineReactModules(): Promise<ReadonlyMap<string, string>> {
  const bundler = new EsbuildBundler();
  try {
    const entryPoints = Object.fromEntries(
      Object.entries(OFFLINE_REACT_ENTRIES).map(([key, entry]) => [
        entry.outputName,
        `offline-react:${key}`,
      ]),
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
      entryNames: "[name]",
      chunkNames: "chunks/[name]-[hash]",
      publicPath: `${OFFLINE_REACT_ORIGIN}${OFFLINE_REACT_MODULE_PREFIX.slice(0, -1)}`,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [{
        name: "veryfront-offline-react-entries",
        setup(build) {
          build.onResolve({ filter: /^offline-react:/ }, (args) => ({
            path: args.path.slice("offline-react:".length),
            namespace: "veryfront-offline-react",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "veryfront-offline-react" },
            (args) => {
              const entry = OFFLINE_REACT_ENTRIES[args.path as OfflineReactEntryKey];
              if (!entry) return null;
              return {
                contents: createEntrySource(entry),
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
  return bundledModules ??= buildOfflineReactModules();
}

/** Build and stop the test-only ESM bundler before per-test sanitizers start. */
export async function prepareOfflineReactModulesForTests(): Promise<void> {
  await getBundledModules();
}

function responsePath(url: URL): string | undefined {
  if (url.origin !== OFFLINE_REACT_ORIGIN) return undefined;
  if (url.pathname.startsWith(OFFLINE_REACT_MODULE_PREFIX)) return url.pathname;
  const match = /^\/(react|react-dom)@[^/]+(?:\/(jsx-runtime|jsx-dev-runtime|client|server))?$/
    .exec(
      url.pathname,
    );
  if (!match) return undefined;
  const entryKey = (() => {
    const packageName = match[1];
    const subpath = match[2];
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
  return entryKey === undefined
    ? undefined
    : `${OFFLINE_REACT_MODULE_PREFIX}${OFFLINE_REACT_ENTRIES[entryKey].outputName}.js`;
}

/** Return whether the URL is backed by the offline React module graph. */
export function isOfflineReactModuleUrlForTests(url: URL): boolean {
  return responsePath(url) !== undefined;
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

/** Install the unit-suite-only React ESM transport until the returned cleanup runs. */
export function installOfflineReactTransportForTests(): () => void {
  const hostFetch = __getCapturedHostFetchForTests();
  const fetchWithOfflineReact: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request
      ? new URL(input.url)
      : input instanceof URL
      ? input
      : new URL(input);
    return await createOfflineReactModuleResponseForTests(url) ?? await hostFetch(input, init);
  };
  return __installOutboundFetchTransportForTests({
    fetch: fetchWithOfflineReact,
    pinnedFetch: (url, _addresses, init) => fetchWithOfflineReact(url, init),
    resolveHost: resolveTestHost,
  });
}

import { relative } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ApiRouteMatcher } from "./api-route-matcher.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];
const ROUTE_FILE_RE = /^route\.(ts|js|tsx|jsx)$/;
const PAGE_EXT_RE = /\.(ts|js|tsx|jsx)$/;
const ROUTE_DISCOVERY_IGNORE_PATTERNS = [
  "*.test.*",
  "*.spec.*",
  "__tests__",
  "node_modules",
] as const;
const MAX_ROUTE_DISCOVERY_DEPTH = 64;
const MAX_DISCOVERED_ROUTES = 10_000;

export function discoverPagesRoutes(
  router: ApiRouteMatcher,
  dir: string,
  prefix: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  return withSpan(
    "api.discoverPagesRoutes",
    async () => {
      let routeCount = 0;
      for await (
        const file of discoverFiles({
          baseDir: dir,
          extensions: EXTENSIONS,
          ignorePatterns: ROUTE_DISCOVERY_IGNORE_PATTERNS,
          maxDepth: MAX_ROUTE_DISCOVERY_DEPTH,
          adapter,
        })
      ) {
        routeCount++;
        if (routeCount > MAX_DISCOVERED_ROUTES) {
          throw INVALID_ARGUMENT.create({
            message: `API route discovery supports at most ${MAX_DISCOVERED_ROUTES} routes`,
          });
        }
        const relativePath = relative(dir, file.path);
        const routePath = `${prefix}/${relativePath.replace(PAGE_EXT_RE, "")}`;
        const pattern = routePath.replace(/\/index$/, "") || prefix;

        router.addRoute(pattern, file.path);
      }
    },
    { "api.discovery.prefix": prefix },
  );
}

interface AppDiscoveryState {
  routeCount: number;
}

function appendAppRoutePrefix(prefix: string, directoryName: string): string {
  if (directoryName.startsWith("(") && directoryName.endsWith(")")) return prefix;
  return `${prefix}/${directoryName}`;
}

async function discoverAppRoutesRecursive(
  router: ApiRouteMatcher,
  dir: string,
  prefix: string,
  adapter: RuntimeAdapter,
  state: AppDiscoveryState,
  depth: number,
): Promise<void> {
  if (depth > MAX_ROUTE_DISCOVERY_DEPTH) {
    throw INVALID_ARGUMENT.create({
      message: `API route discovery supports at most ${MAX_ROUTE_DISCOVERY_DEPTH} directory levels`,
    });
  }

  for await (
    const file of discoverFiles({
      baseDir: dir,
      extensions: EXTENSIONS,
      patterns: ["route"],
      ignorePatterns: ROUTE_DISCOVERY_IGNORE_PATTERNS,
      recursive: false,
      adapter,
    })
  ) {
    if (!file.isFile || !ROUTE_FILE_RE.test(file.name)) continue;
    state.routeCount++;
    if (state.routeCount > MAX_DISCOVERED_ROUTES) {
      throw INVALID_ARGUMENT.create({
        message: `API route discovery supports at most ${MAX_DISCOVERED_ROUTES} routes`,
      });
    }
    router.addRoute(prefix === "" ? "/" : prefix, file.path);
  }

  for await (
    const entry of discoverFiles({
      baseDir: dir,
      includeDirs: true,
      ignorePatterns: ROUTE_DISCOVERY_IGNORE_PATTERNS,
      recursive: false,
      adapter,
    })
  ) {
    if (!entry.isDirectory) continue;
    await discoverAppRoutesRecursive(
      router,
      entry.path,
      appendAppRoutePrefix(prefix, entry.name),
      adapter,
      state,
      depth + 1,
    );
  }
}

export function discoverAppRoutes(
  router: ApiRouteMatcher,
  dir: string,
  prefix: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  return withSpan(
    "api.discoverAppRoutes",
    async () => {
      await discoverAppRoutesRecursive(router, dir, prefix, adapter, { routeCount: 0 }, 0);
    },
    { "api.discovery.prefix": prefix },
  );
}

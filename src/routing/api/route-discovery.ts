import { relative } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ApiRouteMatcher } from "./api-route-matcher.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];
const ROUTE_FILE_RE = /^route\.(ts|js|tsx|jsx)$/;
const PAGE_EXT_RE = /\.(ts|js|tsx|jsx)$/;

export function discoverPagesRoutes(
  router: ApiRouteMatcher,
  dir: string,
  prefix: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  return withSpan(
    "api.discoverPagesRoutes",
    async () => {
      for await (const file of discoverFiles({ baseDir: dir, extensions: EXTENSIONS, adapter })) {
        const relativePath = relative(dir, file.path);
        const routePath = `${prefix}/${relativePath.replace(PAGE_EXT_RE, "")}`;
        const pattern = routePath.replace(/\/index$/, "") || prefix;

        router.addRoute(pattern, file.path);
      }
    },
    { "api.discovery.dir": dir, "api.discovery.prefix": prefix },
  );
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
      for await (
        const file of discoverFiles({
          baseDir: dir,
          extensions: EXTENSIONS,
          patterns: ["route"],
          recursive: false,
          adapter,
        })
      ) {
        if (!file.isFile || !ROUTE_FILE_RE.test(file.name)) continue;

        router.addRoute(prefix === "" ? "/" : prefix, file.path);
      }

      for await (
        const entry of discoverFiles({
          baseDir: dir,
          includeDirs: true,
          recursive: false,
          adapter,
        })
      ) {
        if (!entry.isDirectory) continue;

        await discoverAppRoutes(router, entry.path, `${prefix}/${entry.name}`, adapter);
      }
    },
    { "api.discovery.dir": dir, "api.discovery.prefix": prefix },
  );
}

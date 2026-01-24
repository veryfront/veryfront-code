import { relative } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DynamicRouter } from "./api-route-matcher.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const EXTENSIONS = [".ts", ".js", ".tsx", ".jsx"];

export function discoverPagesRoutes(
  router: DynamicRouter,
  dir: string,
  prefix: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  return withSpan(
    "api.discoverPagesRoutes",
    async () => {
      for await (
        const file of discoverFiles({
          baseDir: dir,
          extensions: EXTENSIONS,
          adapter,
        })
      ) {
        const relativePath = relative(dir, file.path);
        const routePath = `${prefix}/${relativePath.replace(/\.(ts|js|tsx|jsx)$/, "")}`;
        const pattern = routePath.replace(/\/index$/, "") || prefix;

        router.addRoute(pattern, file.path);
      }
    },
    { "api.discovery.dir": dir, "api.discovery.prefix": prefix },
  );
}

export function discoverAppRoutes(
  router: DynamicRouter,
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
        if (!file.isFile || !/^route\.(ts|js|tsx|jsx)$/.test(file.name)) continue;

        const pattern = prefix === "" ? "/" : prefix;
        router.addRoute(pattern, file.path);
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

        const dirPrefix = `${prefix}/${entry.name}`;
        await discoverAppRoutes(router, entry.path, dirPrefix, adapter);
      }
    },
    { "api.discovery.dir": dir, "api.discovery.prefix": prefix },
  );
}

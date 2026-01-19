import { relative } from "#veryfront/platform/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DynamicRouter } from "./api-route-matcher.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";

export async function discoverPagesRoutes(
  router: DynamicRouter,
  dir: string,
  prefix: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  for await (
    const file of discoverFiles({
      baseDir: dir,
      extensions: [".ts", ".js", ".tsx", ".jsx"],
      adapter,
    })
  ) {
    const relativePath = relative(dir, file.path);
    const routePath = `${prefix}/${relativePath.replace(/\.(ts|js|tsx|jsx)$/, "")}`;

    const pattern = routePath.replace(/\/index$/, "") || prefix;
    router.addRoute(pattern, file.path);
  }
}

export async function discoverAppRoutes(
  router: DynamicRouter,
  dir: string,
  prefix: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  for await (
    const file of discoverFiles({
      baseDir: dir,
      extensions: [".ts", ".js", ".tsx", ".jsx"],
      patterns: ["route"],
      recursive: false,
      adapter,
    })
  ) {
    if (file.isFile && /^route\.(ts|js|tsx|jsx)$/.test(file.name)) {
      const pattern = prefix === "" ? "/" : prefix;
      router.addRoute(pattern, file.path);
    }
  }

  for await (
    const dir_entry of discoverFiles({
      baseDir: dir,
      includeDirs: true,
      recursive: false,
      adapter,
    })
  ) {
    if (dir_entry.isDirectory) {
      const dirPrefix = `${prefix}/${dir_entry.name}`;
      await discoverAppRoutes(router, dir_entry.path, dirPrefix, adapter);
    }
  }
}

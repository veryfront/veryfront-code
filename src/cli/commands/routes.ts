import { join } from "#std/path.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { APIRouteHandler, DynamicRouter } from "#veryfront/routing/api/index.ts";
import { getConfig } from "#veryfront/config";
import { cliLogger } from "#veryfront/utils";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";

export async function routesCommand(
  projectDir: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const fs = createFileSystem();
  const adapter = await runtime.get();
  await getConfig(projectDir, adapter);

  const apiHandler = new APIRouteHandler(projectDir, adapter);
  await apiHandler.initialize();

  const router = new DynamicRouter();
  const pagesDir = join(projectDir, "pages");

  try {
    const entries = fs.readDir(pagesDir);
    for await (const entry of entries) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".mdx") && !entry.name.endsWith(".tsx")) continue;

      const slug = entry.name.replace(/\.(mdx|tsx)$/i, "");
      const path = slug === "index" ? "/" : `/${slug}`;
      router.addRoute(path, `pages/${entry.name}`);
    }
  } catch (error) {
    // Pages directory might not exist, which is okay for app router projects
    cliLogger.debug("Could not read pages directory:", error);
  }

  const pages = Array.from(router.routes, ([pattern, { route }]) => ({
    pattern,
    file: route.page,
  }));

  const apis: string[] = [];
  const apiDir = join(projectDir, "pages", "api");
  if (await fs.exists(apiDir)) {
    await collectApiPatterns(fs, apiDir, "/api", apis);
  }

  if (options.json) {
    console.log(JSON.stringify({ pages, apis }, null, 2));
    return;
  }

  cliLogger.info("Pages:");
  for (const p of pages) {
    cliLogger.info(`  ${p.pattern} -> ${p.file}`);
  }

  cliLogger.info("\nAPI:");
  for (const a of apis) {
    cliLogger.info(`  ${a}`);
  }
}

async function collectApiPatterns(
  fs: FileSystem,
  dir: string,
  prefix: string,
  out: string[],
): Promise<void> {
  const entries = fs.readDir(dir);

  for await (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory) {
      await collectApiPatterns(fs, fullPath, `${prefix}/${entry.name}`, out);
      continue;
    }

    if (!entry.isFile || !/\.(ts|js|tsx|jsx)$/i.test(entry.name)) continue;

    const nameWithoutExt = entry.name.replace(/\.(ts|js|tsx|jsx)$/i, "");
    const routePath = `${prefix}/${nameWithoutExt}`;
    const pattern = routePath.replace(/\/index$/, "");

    out.push(pattern);
  }
}

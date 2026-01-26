import { join } from "../../../deps/deno.land/std@0.220.0/path/mod.js";
import { runtime } from "../../platform/adapters/detect.js";
import { APIRouteHandler, DynamicRouter } from "../../routing/api/index.js";
import { getConfig } from "../../config/index.js";
import { cliLogger } from "../../utils/index.js";
import { createFileSystem, type FileSystem } from "../../platform/compat/fs.js";

let fs: FileSystem;

export async function routesCommand(
  projectDir: string,
  options: { json?: boolean } = {},
): Promise<void> {
  fs = createFileSystem();
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
    await collectApiPatterns(apiDir, "/api", apis);
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

async function collectApiPatterns(dir: string, prefix: string, out: string[]): Promise<void> {
  const entries = fs.readDir(dir);

  for await (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory) {
      const nextPrefix = `${prefix}/${entry.name}`;
      await collectApiPatterns(fullPath, nextPrefix, out);
      continue;
    }

    if (!entry.isFile || !/\.(ts|js|tsx|jsx)$/i.test(entry.name)) continue;

    const nameWithoutExt = entry.name.replace(/\.(ts|js|tsx|jsx)$/i, "");
    const routePath = `${prefix}/${nameWithoutExt}`;

    let pattern = routePath.replace(/\/index$/, "");
    if (pattern === prefix && nameWithoutExt === "index") {
      pattern = prefix;
    }

    out.push(pattern);
  }
}

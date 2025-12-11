import { join } from "@std/path";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { APIRouteHandler, DynamicRouter } from "@veryfront/routing/api/index.ts";
import { getConfig } from "@veryfront/config";
import { cliLogger } from "@veryfront/utils";
import { createFileSystem, type FileSystem } from "../../platform/compat/fs.ts";

let fs: FileSystem;

export async function routesCommand(projectDir: string, options: { json?: boolean } = {}) {
  fs = createFileSystem();
  const adapter = await getAdapter();
  await getConfig(projectDir, adapter);
  const pagesDir = join(projectDir, "pages");
  const apiHandler = new APIRouteHandler(projectDir, adapter);
  await apiHandler.initialize();

  const router = new DynamicRouter();
  try {
    const entries = fs.readDir(pagesDir);
    for await (const entry of entries) {
      if (!entry.isFile) continue;
      if (entry.name.endsWith(".mdx") || entry.name.endsWith(".tsx")) {
        const slug = entry.name.replace(/\.(mdx|tsx)$/i, "");
        const path = slug === "index" ? "/" : `/${slug}`;
        router.addRoute(path, `pages/${entry.name}`);
      }
    }
  } catch (error) {
    cliLogger.debug("Could not read pages directory:", error);
  }

  const pages: Array<{ pattern: string; file: string }> = [];
  for (const [pattern, { route }] of (router as any).routes) {
    pages.push({ pattern, file: route.page });
  }

  const apis: string[] = [];
  const apiDir = join(projectDir, "pages", "api");
  if (await fs.exists(apiDir)) {
    await collectApiPatterns(apiDir, "/api", apis);
  }

  if (options.json) {
    console.log(JSON.stringify({ pages, apis }, null, 2));
  } else {
    cliLogger.info("Pages:");
    for (const p of pages) {
      cliLogger.info(`  ${p.pattern} -> ${p.file}`);
    }
    cliLogger.info("\nAPI:");
    for (const a of apis) {
      cliLogger.info(`  ${a}`);
    }
  }
}

async function collectApiPatterns(dir: string, prefix: string, out: string[]) {
  const entries = fs.readDir(dir);
  for await (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const routePath = `${prefix}/${entry.name.replace(/\.(ts|js|tsx|jsx)$/i, "")}`;
    if (entry.isDirectory) {
      await collectApiPatterns(fullPath, routePath, out);
    } else if (entry.isFile && /\.(ts|js|tsx|jsx)$/i.test(entry.name)) {
      let pattern = routePath.replace(/\/index$/, "");
      if (pattern === prefix && entry.name.replace(/\.(ts|js|tsx|jsx)$/i, "") === "index") {
        pattern = prefix;
      }
      out.push(pattern);
    }
  }
}

import { join } from "@std/path";
import { exists } from "std/fs/mod.ts";
import { getAdapter } from "@veryfront/platform/adapters/detect.ts";
import { APIRouteHandler, DynamicRouter } from "@veryfront/routing/api/index.ts";
import { getConfig } from "@veryfront/config";
import { cliLogger } from "@veryfront/utils";

export async function routesCommand(projectDir: string, options: { json?: boolean } = {}) {
  const adapter = await getAdapter();
  const _config = await getConfig(projectDir, adapter);
  const pagesDir = join(projectDir, "pages");
  const apiHandler = new APIRouteHandler(projectDir, adapter);
  await apiHandler.initialize();

  const router = new DynamicRouter();
  // naive page scan
  try {
    for await (const entry of Deno.readDir(pagesDir)) {
      if (!entry.isFile) continue;
      if (entry.name.endsWith(".mdx") || entry.name.endsWith(".tsx")) {
        const slug = entry.name.replace(/\.(mdx|tsx)$/i, "");
        const path = slug === "index" ? "/" : `/${slug}`;
        router.addRoute(path, `pages/${entry.name}`);
      }
    }
  } catch (error) {
    // Pages directory might not exist, which is okay for app router projects
    cliLogger.debug("Could not read pages directory:", error);
  }

  const pages: Array<{ pattern: string; file: string }> = [];
  for (const [pattern, { route }] of (router as any).routes) {
    pages.push({ pattern, file: route.page });
  }

  const apis: string[] = [];
  // Re-discover API files and print patterns without depending on internal state
  const apiDir = join(projectDir, "pages", "api");
  if (await exists(apiDir)) {
    await collectApiPatterns(apiDir, "/api", apis);
  }

  if (options.json) {
    // Use console.log directly to avoid [CLI] prefix for valid JSON output
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
  for await (const entry of Deno.readDir(dir)) {
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

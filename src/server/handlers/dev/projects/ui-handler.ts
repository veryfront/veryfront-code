import * as esbuild from "esbuild";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { logger } from "#veryfront/utils";

const moduleCache = new Map<string, { code: string; timestamp: number }>();
const CACHE_TTL = 5000;

const JS_HEADERS = {
  "Content-Type": "application/javascript",
  "Cache-Control": "no-cache",
};

function getUiDirectory(): string {
  const currentFile = new URL(import.meta.url).pathname;
  return currentFile.replace(/\/ui-handler\.ts$/, "/ui");
}

function resolveRelativeImport(currentDir: string, importPath: string): string {
  const parts = currentDir ? currentDir.split("/") : [];

  for (const part of importPath.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }

  return parts.join("/");
}

function transformModule(filePath: string, source: string, relativePath: string): Promise<string> {
  return withSpan(
    "server.dev.projectsUI.transformModule",
    async () => {
      const result = await esbuild.transform(source, {
        loader: filePath.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "react",
        sourcemap: false,
        minify: false,
      });

      const parts = relativePath.split("/");
      parts.pop();
      const currentDir = parts.join("/");

      return result.code.replace(
        /from\s+["'](\.\.?\/[^"']+)\.tsx?["']/g,
        (_match, importPath) =>
          `from "/_projects/ui/${resolveRelativeImport(currentDir, importPath)}.js"`,
      );
    },
    { "module.filePath": filePath, "module.relativePath": relativePath },
  );
}

async function readUiSource(
  uiDir: string,
  relativePath: string,
): Promise<{ filePath: string; source: string } | null> {
  const tsxPath = `${uiDir}/${relativePath}.tsx`;
  try {
    return { filePath: tsxPath, source: await readTextFile(tsxPath) };
  } catch {
    // fall through
  }

  const tsPath = `${uiDir}/${relativePath}.ts`;
  try {
    return { filePath: tsPath, source: await readTextFile(tsPath) };
  } catch {
    return null;
  }
}

export function handleProjectsUI(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/_projects/ui/")) return Promise.resolve(null);

  return withSpan(
    "server.dev.projectsUI.handle",
    async () => {
      const relativePath = pathname.replace("/_projects/ui/", "").replace(/\.js$/, "");
      const uiDir = getUiDirectory();

      const module = await readUiSource(uiDir, relativePath);
      if (!module) {
        return new Response(`Module not found: ${relativePath}`, {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const { filePath, source } = module;

      const cached = moduleCache.get(filePath);
      const now = Date.now();
      if (cached && now - cached.timestamp < CACHE_TTL) {
        return new Response(cached.code, { headers: JS_HEADERS });
      }

      try {
        const code = await transformModule(filePath, source, relativePath);
        moduleCache.set(filePath, { code, timestamp: now });
        return new Response(code, { headers: JS_HEADERS });
      } catch (error) {
        logger.error("[Projects] Transform error", { filePath, error });
        return new Response(
          `// Transform error: ${error instanceof Error ? error.message : String(error)}`,
          { status: 500, headers: JS_HEADERS },
        );
      }
    },
    { "handler.pathname": pathname },
  );
}

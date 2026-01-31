import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
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
  return currentFile.replace(/\/handlers\/dev\/dashboard\/ui-handler\.ts$/, "/dev-ui/dashboard");
}

function resolveRelativeImport(currentDir: string, importPath: string): string {
  const parts = currentDir ? currentDir.split("/") : [];

  for (const part of importPath.split("/")) {
    if (part === "..") {
      parts.pop();
      continue;
    }
    if (part === ".") continue;
    parts.push(part);
  }

  return parts.join("/");
}

function transformModule(filePath: string, source: string, relativePath: string): Promise<string> {
  return withSpan(
    "server.dev.dashboardUI.transformModule",
    async () => {
      const esbuild = await getEsbuild();
      const result = await esbuild.transform(source, {
        loader: filePath.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "react",
        sourcemap: false,
        minify: false,
      });

      const currentDir = relativePath.split("/").slice(0, -1).join("/");

      return result.code.replace(
        /from\s+["'](\.\.?\/[^"']+)\.tsx?["']/g,
        (_match, importPath) =>
          `from "/_dev/ui/${resolveRelativeImport(currentDir, importPath)}.js"`,
      );
    },
    { "module.filePath": filePath, "module.relativePath": relativePath },
  );
}

async function readUiModule(
  uiDir: string,
  relativePath: string,
): Promise<{ filePath: string; source: string } | null> {
  const tsxPath = `${uiDir}/${relativePath}.tsx`;
  try {
    return { filePath: tsxPath, source: await readTextFile(tsxPath) };
  } catch {
    // try .ts
  }

  const tsPath = `${uiDir}/${relativePath}.ts`;
  try {
    return { filePath: tsPath, source: await readTextFile(tsPath) };
  } catch {
    return null;
  }
}

export function handleDashboardUI(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/_dev/ui/")) return Promise.resolve(null);

  return withSpan(
    "server.dev.dashboardUI.handle",
    async () => {
      const relativePath = pathname.slice("/_dev/ui/".length).replace(/\.js$/, "");
      const uiDir = getUiDirectory();

      const module = await readUiModule(uiDir, relativePath);
      if (!module) {
        return new Response(`Module not found: ${relativePath}`, {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      }

      const { filePath, source } = module;

      const now = Date.now();
      const cached = moduleCache.get(filePath);
      if (cached && now - cached.timestamp < CACHE_TTL) {
        return new Response(cached.code, { headers: JS_HEADERS });
      }

      try {
        const code = await transformModule(filePath, source, relativePath);
        moduleCache.set(filePath, { code, timestamp: now });
        return new Response(code, { headers: JS_HEADERS });
      } catch (error) {
        logger.error("[DevDashboard] Transform error", { filePath, error });
        const message = error instanceof Error ? error.message : String(error);
        return new Response(`// Transform error: ${message}`, { status: 500, headers: JS_HEADERS });
      }
    },
    { "handler.pathname": pathname },
  );
}

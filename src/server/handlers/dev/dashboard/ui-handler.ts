import * as esbuild from "esbuild";
import { readTextFile } from "@veryfront/platform/compat/fs.ts";

const moduleCache = new Map<string, { code: string; timestamp: number }>();
const CACHE_TTL = 5000;

function getUiDirectory(): string {
  const currentFile = new URL(import.meta.url).pathname;
  return currentFile.replace(/\/ui-handler\.ts$/, "/ui");
}

async function transformModule(
  filePath: string,
  source: string,
  relativePath: string,
): Promise<string> {
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
    (_match, importPath) => `from "/_dev/ui/${resolveRelativeImport(currentDir, importPath)}.js"`,
  );
}

function resolveRelativeImport(currentDir: string, importPath: string): string {
  const parts = currentDir ? currentDir.split("/") : [];
  for (const part of importPath.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

const JS_HEADERS = { "Content-Type": "application/javascript", "Cache-Control": "no-cache" };

export async function handleDashboardUI(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/_dev/ui/")) return null;

  const relativePath = pathname.replace("/_dev/ui/", "").replace(/\.js$/, "");
  const uiDir = getUiDirectory();

  let filePath = `${uiDir}/${relativePath}.tsx`;
  let source: string | null = null;

  try {
    source = await readTextFile(filePath);
  } catch {
    filePath = `${uiDir}/${relativePath}.ts`;
    try {
      source = await readTextFile(filePath);
    } catch {
      return new Response(`Module not found: ${relativePath}`, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

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
    console.error(`[DevDashboard] Transform error for ${filePath}:`, error);
    return new Response(
      `// Transform error: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500, headers: JS_HEADERS },
    );
  }
}

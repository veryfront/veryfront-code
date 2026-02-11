import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { transformUiModule } from "../shared/ui-module-transform.ts";
import { logger as baseLogger } from "#veryfront/utils";
import devUiManifest from "#veryfront/server/dev-ui/manifest.json" with { type: "json" };

const logger = baseLogger.component("dev-dashboard");

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

/**
 * Read UI module from filesystem (for dev) or embedded manifest (for compiled binary)
 */
async function readUiModule(
  uiDir: string,
  relativePath: string,
): Promise<{ filePath: string; source: string } | null> {
  // Try filesystem first (works in development, allows hot reload)
  const tsxPath = `${uiDir}/${relativePath}.tsx`;
  try {
    return { filePath: tsxPath, source: await readTextFile(tsxPath) };
  } catch {
    // try .ts from filesystem
  }

  const tsPath = `${uiDir}/${relativePath}.ts`;
  try {
    return { filePath: tsPath, source: await readTextFile(tsPath) };
  } catch {
    // Filesystem failed, try embedded manifest (for compiled binary)
  }

  // Try embedded manifest - paths are relative to dev-ui directory
  // The manifest uses "dashboard/..." paths, so we need to match that
  const manifest = devUiManifest as { files: Record<string, string> };

  // Try .tsx from manifest
  const manifestTsxPath = `dashboard/${relativePath}.tsx`;
  if (manifest.files[manifestTsxPath]) {
    return { filePath: manifestTsxPath, source: manifest.files[manifestTsxPath] };
  }

  // Try .ts from manifest
  const manifestTsPath = `dashboard/${relativePath}.ts`;
  if (manifest.files[manifestTsPath]) {
    return { filePath: manifestTsPath, source: manifest.files[manifestTsPath] };
  }

  return null;
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
        const code = await transformUiModule(filePath, source, relativePath, {
          spanName: "server.dev.dashboardUI.transformModule",
          importBasePath: "/_dev/ui",
        });
        moduleCache.set(filePath, { code, timestamp: now });
        return new Response(code, { headers: JS_HEADERS });
      } catch (error) {
        logger.error("Transform error", { filePath, error });
        const message = error instanceof Error ? error.message : String(error);
        return new Response(`// Transform error: ${message}`, { status: 500, headers: JS_HEADERS });
      }
    },
    { "handler.pathname": pathname },
  );
}

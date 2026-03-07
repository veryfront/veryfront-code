import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { transformUiModule } from "../shared/ui-module-transform.ts";
import { logger as baseLogger } from "#veryfront/utils";
import devUiManifest from "#veryfront/server/dev-ui/manifest.json" with { type: "json" };

const logger = baseLogger.component("projects");

const moduleCache = new Map<string, { code: string; timestamp: number }>();
const CACHE_TTL = 5000;

const JS_HEADERS = {
  "Content-Type": "application/javascript",
  "Cache-Control": "no-cache",
};

function getUiDirectory(): string {
  const currentFile = new URL(import.meta.url).pathname;
  return currentFile.replace(/\/handlers\/dev\/projects\/ui-handler\.ts$/, "/dev-ui");
}

/**
 * Resolve the actual file path for a relative path.
 * - "index" → "projects/index" (projects UI files)
 * - "shared/mount-react-app" → "shared/mount-react-app" (shared files)
 * - "components/Foo" → "projects/components/Foo" (projects UI components)
 */
function resolveFilePath(relativePath: string): string {
  // shared/ files are at dev-ui/shared/, not dev-ui/projects/shared/
  if (relativePath.startsWith("shared/")) {
    return relativePath;
  }
  // Everything else is under dev-ui/projects/
  return `projects/${relativePath}`;
}

/**
 * Read UI module from filesystem (for dev) or embedded manifest (for compiled binary)
 */
async function readUiSource(
  uiDir: string,
  relativePath: string,
): Promise<{ filePath: string; source: string } | null> {
  const resolvedPath = resolveFilePath(relativePath);

  // Try filesystem first (works in development, allows hot reload)
  const tsxPath = `${uiDir}/${resolvedPath}.tsx`;
  try {
    return { filePath: tsxPath, source: await readTextFile(tsxPath) };
  } catch (_) {
    /* expected: .tsx file may not exist, try .ts */
  }

  const tsPath = `${uiDir}/${resolvedPath}.ts`;
  try {
    return { filePath: tsPath, source: await readTextFile(tsPath) };
  } catch (_) {
    /* expected: filesystem files may not exist, try embedded manifest */
  }

  // Try embedded manifest - paths match the resolved path
  const manifest = devUiManifest as { files: Record<string, string> };

  // Try .tsx from manifest
  const manifestTsxPath = `${resolvedPath}.tsx`;
  if (manifest.files[manifestTsxPath]) {
    return { filePath: manifestTsxPath, source: manifest.files[manifestTsxPath] };
  }

  // Try .ts from manifest
  const manifestTsPath = `${resolvedPath}.ts`;
  if (manifest.files[manifestTsPath]) {
    return { filePath: manifestTsPath, source: manifest.files[manifestTsPath] };
  }

  return null;
}

export function handleProjectsUI(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith("/_projects/ui/")) return Promise.resolve(null);

  return withSpan(
    "server.dev.projectsUI.handle",
    async () => {
      const relativePath = pathname.replace("/_projects/ui/", "").replace(/\.js$/, "");
      if (relativePath.includes("..")) {
        return new Response("Invalid path", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        });
      }

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
        const code = await transformUiModule(filePath, source, relativePath, {
          spanName: "server.dev.projectsUI.transformModule",
          importBasePath: "/_projects/ui",
        });
        moduleCache.set(filePath, { code, timestamp: now });
        return new Response(code, { headers: JS_HEADERS });
      } catch (error) {
        logger.error("Transform error", { filePath, error });
        return new Response(
          `// Transform error: ${error instanceof Error ? error.message : String(error)}`,
          { status: 500, headers: JS_HEADERS },
        );
      }
    },
    { "handler.pathname": pathname },
  );
}

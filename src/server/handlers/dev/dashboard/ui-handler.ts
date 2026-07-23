import { readTextFile, realPath, stat } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/compat/path/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { transformUiModule } from "../shared/ui-module-transform.ts";
import {
  DevUiModuleCache,
  type DevUiModuleDependencies,
  loadDevUiModule,
  parseDevUiModulePath,
} from "../shared/dev-ui-module-service.ts";
import { logger as baseLogger } from "#veryfront/utils";
import devUiManifest from "#veryfront/server/dev-ui/manifest.json" with { type: "json" };

const logger = baseLogger.component("dev-dashboard");
const moduleCache = new DevUiModuleCache();
const MODULE_PATH_PREFIX = "/_dev/ui/";
const JS_HEADERS = {
  "Content-Type": "application/javascript",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function getUiDirectory(): string {
  return fromFileUrl(new URL("../../../dev-ui/dashboard/", import.meta.url));
}

interface DashboardUIDeps extends DevUiModuleDependencies {
  getUiDirectory: typeof getUiDirectory;
}

let injectedDeps: Partial<DashboardUIDeps> | null = null;

export function __injectDashboardUIDepsForTests(
  deps: Partial<DashboardUIDeps> | null,
): void {
  injectedDeps = deps;
}

export function __resetDashboardUICacheForTests(): void {
  moduleCache.clear();
}

export function __getDashboardUICacheSizeForTests(): number {
  return moduleCache.size;
}

function getDeps(): DashboardUIDeps {
  return {
    getUiDirectory: injectedDeps?.getUiDirectory ?? getUiDirectory,
    readTextFile: injectedDeps?.readTextFile ?? readTextFile,
    realPath: injectedDeps?.realPath ?? realPath,
    stat: injectedDeps?.stat ?? stat,
    transformUiModule: injectedDeps?.transformUiModule ?? transformUiModule,
  };
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...JS_HEADERS, "Content-Type": "text/plain" },
  });
}

function unavailableResponse(): Response {
  return new Response("// Dashboard module unavailable", {
    status: 500,
    headers: JS_HEADERS,
  });
}

export function handleDashboardUI(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(MODULE_PATH_PREFIX)) return Promise.resolve(null);
  if (req.method.toUpperCase() !== "GET") {
    const response = textResponse("Method Not Allowed", 405);
    response.headers.set("Allow", "GET");
    return Promise.resolve(response);
  }

  const relativePath = parseDevUiModulePath(pathname, MODULE_PATH_PREFIX);
  if (!relativePath) return Promise.resolve(textResponse("Invalid module path", 400));

  return withSpan("server.dev.dashboardUI.handle", async () => {
    const deps = getDeps();
    const result = await loadDevUiModule(
      {
        uiDirectory: deps.getUiDirectory(),
        relativePath,
        sourcePath: `dashboard/${relativePath}`,
        manifestFiles: devUiManifest.files,
        transform: {
          spanName: "server.dev.dashboardUI.transformModule",
          importBasePath: "/_dev/ui",
        },
      },
      deps,
      moduleCache,
    );

    if (result.kind === "loaded") return new Response(result.code, { headers: JS_HEADERS });
    if (result.kind === "unsafe") return textResponse("Invalid module path", 400);
    if (result.kind === "missing") return textResponse("Module not found", 404);
    if (result.kind === "unavailable") {
      if (result.error !== undefined) {
        logger.error("Dashboard UI module source unavailable", {
          errorCategory: classifyTelemetryError(result.error),
        });
      }
      return unavailableResponse();
    }

    logger.error("Dashboard UI module transform failed", {
      errorCategory: classifyTelemetryError(result.error),
    });
    return new Response("// Dashboard module transform failed", {
      status: 500,
      headers: JS_HEADERS,
    });
  });
}

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
import {
  createPrivateProjectsResponse,
  isAuthorizedProjectsRequest,
  PROJECTS_PRIVATE_HEADERS,
} from "./request-policy.ts";

const logger = baseLogger.component("projects");
const moduleCache = new DevUiModuleCache();
const MODULE_PATH_PREFIX = "/_projects/ui/";
const JS_HEADERS = {
  ...PROJECTS_PRIVATE_HEADERS,
  "Content-Type": "application/javascript",
};

function getUiDirectory(): string {
  return fromFileUrl(new URL("../../../dev-ui/", import.meta.url));
}

interface ProjectsUIDeps extends DevUiModuleDependencies {
  getUiDirectory: typeof getUiDirectory;
}

let injectedDeps: Partial<ProjectsUIDeps> | null = null;

export function __injectProjectsUIDepsForTests(
  deps: Partial<ProjectsUIDeps> | null,
): void {
  injectedDeps = deps;
}

export function __resetProjectsUICacheForTests(): void {
  moduleCache.clear();
}

export function __getProjectsUICacheSizeForTests(): number {
  return moduleCache.size;
}

function getDeps(): ProjectsUIDeps {
  return {
    getUiDirectory: injectedDeps?.getUiDirectory ?? getUiDirectory,
    readTextFile: injectedDeps?.readTextFile ?? readTextFile,
    realPath: injectedDeps?.realPath ?? realPath,
    stat: injectedDeps?.stat ?? stat,
    transformUiModule: injectedDeps?.transformUiModule ?? transformUiModule,
  };
}

function sourcePathFor(relativePath: string): string {
  return relativePath.startsWith("shared/") ? relativePath : `projects/${relativePath}`;
}

function unavailableResponse(): Response {
  return new Response("// Projects module unavailable", {
    status: 500,
    headers: JS_HEADERS,
  });
}

export function handleProjectsUI(req: Request): Promise<Response | null> {
  const { pathname } = new URL(req.url);
  if (!pathname.startsWith(MODULE_PATH_PREFIX)) return Promise.resolve(null);
  if (!isAuthorizedProjectsRequest(req)) {
    return Promise.resolve(createPrivateProjectsResponse("Unauthorized", 401));
  }
  if (req.method.toUpperCase() !== "GET") {
    return Promise.resolve(
      createPrivateProjectsResponse("Method Not Allowed", 405, { "Allow": "GET" }),
    );
  }

  const relativePath = parseDevUiModulePath(pathname, MODULE_PATH_PREFIX);
  if (!relativePath) {
    return Promise.resolve(createPrivateProjectsResponse("Invalid module path", 400));
  }

  return withSpan("server.dev.projectsUI.handle", async () => {
    const deps = getDeps();
    const result = await loadDevUiModule(
      {
        uiDirectory: deps.getUiDirectory(),
        relativePath,
        sourcePath: sourcePathFor(relativePath),
        manifestFiles: devUiManifest.files,
        transform: {
          spanName: "server.dev.projectsUI.transformModule",
          importBasePath: "/_projects/ui",
        },
      },
      deps,
      moduleCache,
    );

    if (result.kind === "loaded") return new Response(result.code, { headers: JS_HEADERS });
    if (result.kind === "unsafe") {
      return createPrivateProjectsResponse("Invalid module path", 400);
    }
    if (result.kind === "missing") return createPrivateProjectsResponse("Module not found", 404);
    if (result.kind === "unavailable") {
      if (result.error !== undefined) {
        logger.error("Projects UI module source unavailable", {
          errorCategory: classifyTelemetryError(result.error),
        });
      }
      return unavailableResponse();
    }

    logger.error("Projects UI module transform failed", {
      errorCategory: classifyTelemetryError(result.error),
    });
    return new Response("// Projects module transform failed", {
      status: 500,
      headers: JS_HEADERS,
    });
  });
}

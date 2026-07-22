import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import type { MiddlewareHandler } from "#veryfront/middleware/core/types.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { dirname, join } from "#veryfront/compat/path/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { cors } from "#veryfront/security";
import { getBaseLogger, type RequestContext, runWithRequestContextAsync } from "#veryfront/utils";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { generateRequestId } from "#veryfront/utils/request-id.ts";

export type MiddlewareFunction = MiddlewareHandler;

interface MiddlewareLoadOptions {
  throwOnError?: boolean;
}

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("middleware");

function createRequestLoggerMiddleware(): MiddlewareFunction {
  return async (c, next) => {
    const start = performance.now();
    const { pathname } = new URL(c.req.url);
    const method = c.req.method;
    const incomingId = c.req.headers.get("x-request-id") ?? "";
    const requestId = generateRequestId(incomingId);

    const host = c.req.headers.get("host") ?? "";
    const domain = host.replace(/:\d+$/, "");
    const projectSlug = c.req.headers.get("x-project-slug") ?? undefined;
    const projectId = c.req.headers.get("x-project-id") ?? undefined;
    const releaseId = c.req.headers.get("x-release-id") ?? undefined;
    const branchId = c.req.headers.get("x-branch-id") ?? undefined;
    const branchName = c.req.headers.get("x-branch-name") ?? undefined;

    const reqLogger = logger.child({
      requestId,
      request_url: c.req.url,
      domain,
      project_slug: projectSlug,
      project_id: projectId,
      release_id: releaseId,
      branch_id: branchId,
      branch_name: branchName,
      pathname,
    });

    c.var.requestId = requestId;
    c.var.logger = reqLogger;

    const requestContext: RequestContext = {
      logger: reqLogger,
      requestId,
      projectSlug,
      projectId,
      domain,
    };

    return runWithRequestContextAsync(requestContext, async () => {
      try {
        await enrichSpanWithRequestInfo(method, pathname, requestId);
        reqLogger.debug(`${method} ${pathname} started`);
      } catch (_) {
        /* expected: OpenTelemetry may not be available in dev */
      }

      let response: Response | undefined;
      try {
        response = await next();
      } catch (error) {
        const durationMs = Math.round(performance.now() - start);
        reqLogger.error(`${method} ${pathname} failed`, { durationMs }, error);
        throw error;
      }

      const durationMs = Math.round(performance.now() - start);

      if (response && response.status !== 101) {
        response.headers.set("x-request-id", requestId);
      }

      try {
        reqLogger.debug(`${method} ${pathname} completed`, {
          status: response?.status ?? 0,
          durationMs,
        });
      } catch (_) {
        /* expected: logging may fail in edge cases */
      }

      return response;
    });
  };
}

export async function loadMiddlewareFile(
  projectDir: string,
  adapter: RuntimeAdapter,
  options: MiddlewareLoadOptions = {},
): Promise<MiddlewareFunction[]> {
  const middlewareFiles = ["middleware.ts", "middleware.js", "middleware.mjs"];

  for (const middlewareFile of middlewareFiles) {
    const middlewarePath = join(projectDir, middlewareFile);
    if (!(await adapter.fs.exists(middlewarePath))) continue;

    try {
      logger.debug(`Loading ${middlewareFile}`);

      if (isVirtualFilesystem(adapter.fs)) {
        return await loadMiddlewareFromVirtualFS(
          middlewarePath,
          adapter,
          options.throwOnError === true,
          middlewareFile,
        );
      }

      const middlewareUrl = `file://${middlewarePath}?t=${Date.now()}-${crypto.randomUUID()}`;
      const middlewareModule = await import(middlewareUrl);
      return normalizeMiddlewareExport(
        middlewareModule,
        options.throwOnError === true,
        middlewareFile,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to load ${middlewareFile}: ${errorMessage}`);
      if (options.throwOnError) throw error;
    }
  }

  return [];
}

async function loadMiddlewareFromVirtualFS(
  middlewarePath: string,
  adapter: RuntimeAdapter,
  strictExport: boolean,
  sourceFile = "middleware.ts",
): Promise<MiddlewareFunction[]> {
  const fs = createFileSystem();

  const content = await adapter.fs.readFile(middlewarePath);
  const source = typeof content === "string" ? content : new TextDecoder().decode(content);
  const loader = getEsbuildLoader(middlewarePath);

  const { build } = await import("veryfront/extensions/bundler");
  const result = await build({
    bundle: false,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    stdin: {
      contents: source,
      loader,
      resolveDir: dirname(middlewarePath),
      sourcefile: middlewarePath,
    },
  });

  const firstError = result.errors?.[0]?.text;
  if (firstError) {
    throw COMPILATION_ERROR.create({ detail: `Failed to transpile middleware: ${firstError}` });
  }

  const js = result.outputFiles?.[0]?.text ?? "export default []";

  const tempDir = await fs.makeTempDir({ prefix: "vf-middleware-" });
  const tempFile = join(tempDir, "middleware.mjs");

  try {
    await fs.writeTextFile(tempFile, js);
    const middlewareModule = await import(`file://${tempFile}?v=${Date.now()}`);
    return normalizeMiddlewareExport(middlewareModule, strictExport, sourceFile);
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

/** Describe the shape of the default export that was rejected. */
function describeDefaultExport(exported: unknown): string {
  if (Array.isArray(exported)) {
    if (exported.length === 0) return `Found an empty default export array.`;
    const badIndex = exported.findIndex((value) => typeof value !== "function");
    if (badIndex >= 0) {
      return `Found a default export array with a non-function at index ${badIndex} ` +
        `(${typeof exported[badIndex]}).`;
    }
  }

  if (exported && typeof exported === "object") {
    const keys = Object.keys(exported as Record<string, unknown>);
    return keys.length > 0
      ? `Found a default export of type object with keys: ${keys.join(", ")}.`
      : `Found a default export of type object with no keys.`;
  }

  return `Found a default export of type ${typeof exported}.`;
}

/**
 * Explain what a root middleware file must export. When the module looks like it
 * was written for Next.js, say so, because that is overwhelmingly why this
 * fails. A bad root middleware takes down every route, so the message has
 * to be enough to fix the file without reading the source.
 */
function invalidMiddlewareExport(
  middlewareModule: unknown,
  sourceFile: string,
  exported: unknown,
): TypeError {
  const named = middlewareModule && typeof middlewareModule === "object"
    ? Object.keys(middlewareModule as Record<string, unknown>)
    : [];

  const looksLikeNext = named.includes("middleware") &&
    typeof (middlewareModule as { middleware?: unknown }).middleware === "function";

  const hasDefault = middlewareModule && typeof middlewareModule === "object" &&
    "default" in middlewareModule;

  const detail = looksLikeNext
    ? `Found a named "middleware" export, which is the Next.js convention. ` +
      `Veryfront expects a default export, and its middleware receives ` +
      `(c, next), where c is a context carrying c.req, not the Request itself.`
    : hasDefault
    ? describeDefaultExport(exported)
    : named.length > 0
    ? `Found export(s): ${named.join(", ")}.`
    : `The module has no usable export.`;

  return new TypeError(
    `Invalid middleware export in ${sourceFile}. ${detail}\n` +
      `Expected a default export that is a middleware function, or a non-empty ` +
      `array of them:\n\n` +
      `  export default async function middleware(c, next) {\n` +
      `    const response = await next();\n` +
      `    return response;\n` +
      `  }\n\n` +
      `See docs/guides/middleware.md.`,
  );
}

function normalizeMiddlewareExport(
  middlewareModule: unknown,
  strict = false,
  sourceFile = "middleware.ts",
): MiddlewareFunction[] {
  const exported = middlewareModule && typeof middlewareModule === "object" &&
      "default" in middlewareModule
    ? (middlewareModule as { default?: unknown }).default
    : middlewareModule;

  if (Array.isArray(exported)) {
    if (
      strict && (exported.length === 0 || exported.some((value) => typeof value !== "function"))
    ) {
      throw invalidMiddlewareExport(middlewareModule, sourceFile, exported);
    }
    return exported.filter((middleware): middleware is MiddlewareFunction =>
      typeof middleware === "function"
    );
  }

  if (typeof exported === "function") {
    return [exported as MiddlewareFunction];
  }

  if (strict) {
    throw invalidMiddlewareExport(middlewareModule, sourceFile, exported);
  }

  return [];
}

export async function setupMiddleware(
  pipeline: MiddlewarePipeline,
  config: VeryfrontConfig,
  requestHandler: (req: Request) => Promise<Response>,
): Promise<void> {
  pipeline.use(createRequestLoggerMiddleware());

  const corsConfig = config.security?.cors;
  if (corsConfig) {
    pipeline.use(cors(corsConfig === true ? {} : corsConfig));
  }

  pipeline.use((c) => requestHandler(c.req));
}

async function enrichSpanWithRequestInfo(
  method: string,
  pathname: string,
  requestId: string,
): Promise<void> {
  try {
    const { trace } = await import("#veryfront/observability/tracing/api-shim.ts");
    const span = trace.getActiveSpan();
    if (!span) return;

    span.setAttribute("http.route", pathname);
    span.setAttribute("veryfront.request_id", requestId);
    span.updateName(`${method} ${pathname}`);
  } catch (_) {
    /* expected: OpenTelemetry is optional */
  }
}

import { serverLogger as logger } from "#veryfront/utils";
import { MiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { cors } from "#veryfront/security";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { dirname, join } from "#veryfront/platform/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";

type MiddlewareFunction = (
  c: { req: Request; var: Record<string, unknown> },
  next: () => Promise<Response | undefined> | Response,
) => Promise<Response | undefined> | Response | undefined;

export function createRequestLoggerMiddleware() {
  return async (
    c: { req: Request; var: Record<string, unknown> },
    next: () => Promise<Response | undefined> | Response,
  ) => {
    const start = performance.now();
    const url = new URL(c.req.url);
    const method = c.req.method;
    const incomingId = c.req.headers.get("x-request-id") || "";
    const requestId = generateRequestId(incomingId);
    c.var.requestId = requestId;

    try {
      await enrichSpanWithRequestInfo(method, url.pathname, requestId);
      logger.debug(`[${requestId}] --> ${method} ${url.pathname}`);
    } catch {
      /* dev only */
    }

    let response: Response | undefined;
    try {
      response = (await next()) as Response | undefined;
    } catch (error) {
      try {
        logger.error(
          `[${requestId}] ERROR ${method} ${url.pathname}`,
          error instanceof Error ? error : new Error(String(error)),
        );
      } catch (loggingError) {
        logger.debug("[dev-server] logging failed", loggingError);
      }
      throw error;
    }

    const duration = (performance.now() - start).toFixed(0);
    // Don't modify headers for WebSocket upgrade responses (status 101) - they're immutable
    if (response && response.status !== 101) {
      response.headers.set("x-request-id", requestId);
    }

    try {
      logger.debug(
        `[${requestId}] <-- ${method} ${url.pathname} ${response?.status ?? 0} ${duration}ms`,
      );
    } catch {
      /* dev only */
    }

    return response;
  };
}

function isVirtualFilesystem(adapter: RuntimeAdapter): boolean {
  const fs = adapter?.fs;
  if (!fs || typeof fs !== "object") return false;

  return isExtendedFSAdapter(fs) && fs.isVeryfrontAdapter();
}

async function loadMiddlewareFile(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<MiddlewareFunction[]> {
  const middlewareFiles = ["middleware.ts", "middleware.js", "middleware.mjs"];

  for (const middlewareFile of middlewareFiles) {
    const middlewarePath = join(projectDir, middlewareFile);
    const exists = await adapter.fs.exists(middlewarePath);
    if (!exists) continue;

    try {
      logger.debug(`[MIDDLEWARE] Loading ${middlewareFile}`);

      if (isVirtualFilesystem(adapter)) {
        return await loadMiddlewareFromVirtualFS(middlewarePath, adapter);
      } else {
        const middlewareUrl = `file://${middlewarePath}?t=${Date.now()}-${crypto.randomUUID()}`;
        const middlewareModule = await import(middlewareUrl);
        return normalizeMiddlewareExport(middlewareModule);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(`[MIDDLEWARE] Failed to load ${middlewareFile}: ${errorMessage}`);
      continue;
    }
  }

  return [];
}

async function loadMiddlewareFromVirtualFS(
  middlewarePath: string,
  adapter: RuntimeAdapter,
): Promise<MiddlewareFunction[]> {
  const fs = createFileSystem();

  const content = await adapter.fs.readFile(middlewarePath);
  const source = typeof content === "string" ? content : new TextDecoder().decode(content);

  const loader = getEsbuildLoader(middlewarePath);

  const { build } = await import("esbuild");

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

  if (result.errors && result.errors.length > 0) {
    const first = result.errors[0]?.text || "unknown error";
    throw new Error(`Failed to transpile middleware: ${first}`);
  }

  const js = result.outputFiles?.[0]?.text ?? "export default []";

  const tempDir = await fs.makeTempDir({ prefix: "vf-middleware-" });
  const tempFile = join(tempDir, "middleware.mjs");

  try {
    await fs.writeTextFile(tempFile, js);
    const middlewareModule = await import(`file://${tempFile}?v=${Date.now()}`);
    return normalizeMiddlewareExport(middlewareModule);
  } finally {
    await fs.remove(tempDir, { recursive: true });
  }
}

function normalizeMiddlewareExport(middlewareModule: unknown): MiddlewareFunction[] {
  const exported = (middlewareModule as { default?: unknown })?.default || middlewareModule;

  if (Array.isArray(exported)) {
    return exported.filter((m): m is MiddlewareFunction => typeof m === "function");
  }

  return typeof exported === "function" ? [exported as MiddlewareFunction] : [];
}

export async function setupMiddleware(
  pipeline: MiddlewarePipeline,
  config: VeryfrontConfig,
  requestHandler: (req: Request) => Promise<Response>,
  projectDir?: string,
  adapter?: RuntimeAdapter,
): Promise<void> {
  pipeline.use(createRequestLoggerMiddleware());

  if (config.security?.cors) {
    pipeline.use(
      cors(
        config.security.cors === true ? {} : config.security.cors,
      ),
    );
  }

  // Skip loading middleware file in proxy mode - no request context at startup
  const isProxyMode = config.fs?.veryfront?.proxyMode === true;
  if (projectDir && adapter && !isProxyMode) {
    const fileMiddlewares = await loadMiddlewareFile(projectDir, adapter);
    for (const middleware of fileMiddlewares) {
      logger.debug("[MIDDLEWARE] Registered middleware from file");
      pipeline.use(middleware);
    }
  } else if (isProxyMode) {
    logger.debug("[MIDDLEWARE] Skipping file middleware in proxy mode");
  }

  if (config.middleware?.custom) {
    for (const middleware of config.middleware.custom) {
      pipeline.use(middleware);
    }
  }

  pipeline.use((
    c: { req: Request; var: Record<string, unknown> },
    _next: () => Promise<Response | undefined> | Response,
  ) => requestHandler(c.req));
}

function generateRequestId(incomingId: string): string {
  return (
    incomingId ||
    crypto
      .getRandomValues(new Uint32Array(2))
      .reduce((acc, n) => acc + n.toString(16).padStart(8, "0"), "")
  );
}

async function enrichSpanWithRequestInfo(
  method: string,
  pathname: string,
  requestId: string,
): Promise<void> {
  try {
    const { trace } = await import("@opentelemetry/api");
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute("http.route", pathname);
      span.setAttribute("veryfront.request_id", requestId);
      span.updateName(`${method} ${pathname}`);
    }
  } catch {
    /* otel optional */
  }
}

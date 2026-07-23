import { RuntimeMiddlewarePipeline } from "#veryfront/middleware/core/pipeline/index.ts";
import { getSafeRequestMethod } from "#veryfront/middleware/core/pipeline/executor.ts";
import type { MiddlewareHandler } from "#veryfront/middleware/core/types.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { isVirtualFilesystem } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { RuntimeAdapter, RuntimeRequestHandler } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { dirname, join, toFileUrl } from "#veryfront/compat/path/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { cors } from "#veryfront/security";
import { getBaseLogger, type RequestContext, runWithRequestContextAsync } from "#veryfront/utils";
import { getEsbuildLoader } from "#veryfront/utils/path-utils.ts";
import { generateRequestId } from "#veryfront/utils/request-id.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { validatePath } from "#veryfront/security/path-validation/index.ts";

export type MiddlewareFunction = MiddlewareHandler;

interface MiddlewareLoadOptions {
  throwOnError?: boolean;
}

const baseLogger = getBaseLogger("SERVER");

const logger = baseLogger.component("middleware");

export const PROJECT_MIDDLEWARE_FILES = [
  "middleware.ts",
  "middleware.js",
  "middleware.mjs",
] as const;
export const MAX_MIDDLEWARE_SOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_MIDDLEWARE_OUTPUT_BYTES = 8 * 1024 * 1024;
export const MAX_MIDDLEWARE_FUNCTIONS = 128;

const MAX_MIDDLEWARE_PROJECT_DIR_BYTES = 4_096;
const textEncoder = new TextEncoder();

function setRequestIdHeader(response: Response, requestId: string): Response {
  try {
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (_) {
    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

function createRequestLoggerMiddleware(): MiddlewareFunction {
  return async (c, next) => {
    const start = performance.now();
    const method = getSafeRequestMethod(c.req.method);
    const incomingId = c.req.headers.get("x-request-id") ?? "";
    const requestId = generateRequestId(incomingId);

    const reqLogger = logger.child({
      requestId,
      request_url: "[REDACTED]",
    });

    c.var.requestId = requestId;
    c.var.logger = reqLogger;

    const requestContext: RequestContext = {
      logger: reqLogger,
      requestId,
    };

    return runWithRequestContextAsync(requestContext, async () => {
      try {
        await enrichSpanWithRequestInfo(method, requestId);
        reqLogger.debug("Request started", { method });
      } catch (_) {
        /* expected: OpenTelemetry may not be available in dev */
      }

      let response: Response | undefined;
      try {
        response = await next();
      } catch (error) {
        const durationMs = Math.round(performance.now() - start);
        reqLogger.error("Request failed", {
          durationMs,
          errorCategory: classifyTelemetryError(error),
          method,
        });
        throw error;
      }

      const durationMs = Math.round(performance.now() - start);

      if (response && response.status !== 101) {
        response = setRequestIdHeader(response, requestId);
      }

      try {
        reqLogger.debug("Request completed", {
          method,
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
  assertProjectDirectory(projectDir);

  for (const middlewareFile of PROJECT_MIDDLEWARE_FILES) {
    const middlewarePath = join(projectDir, middlewareFile);
    let exists: boolean;
    try {
      exists = await adapter.fs.exists(middlewarePath);
    } catch (error) {
      logger.warn("Failed to inspect project middleware", {
        failureCategory: classifyTelemetryError(error),
      });
      throw error;
    }
    if (!exists) continue;

    try {
      logger.debug(`Loading ${middlewareFile}`);
      const validatedPath = await validateMiddlewarePath(
        projectDir,
        middlewareFile,
        adapter,
      );

      if (isVirtualFilesystem(adapter.fs)) {
        return await loadMiddlewareFromVirtualFS(
          validatedPath,
          adapter,
        );
      }

      await assertBoundedMiddlewareFile(validatedPath, adapter);
      const middlewareUrl = toFileUrl(validatedPath);
      middlewareUrl.searchParams.set("v", crypto.randomUUID());
      const middlewareModule = await import(middlewareUrl.href);
      return normalizeMiddlewareExport(middlewareModule);
    } catch (error) {
      logger.warn("Failed to load project middleware", {
        fileType: middlewareFile.split(".").at(-1) ?? "unknown",
        failureCategory: classifyTelemetryError(error),
      });
      if (options.throwOnError) throw error;
      return [];
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
  const source = decodeBoundedMiddlewareSource(content);
  const loader = getEsbuildLoader(middlewarePath);

  const { build } = await import("veryfront/extensions/bundler");
  const result = await build({
    bundle: false,
    logLevel: "silent",
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
    throw COMPILATION_ERROR.create({ detail: "Middleware compilation failed" });
  }

  if (result.outputFiles?.length !== 1 || typeof result.outputFiles[0]?.text !== "string") {
    throw COMPILATION_ERROR.create({ detail: "Middleware compilation produced no output" });
  }
  const js = result.outputFiles[0].text;
  if (textEncoder.encode(js).byteLength > MAX_MIDDLEWARE_OUTPUT_BYTES) {
    throw COMPILATION_ERROR.create({ detail: "Middleware output exceeds the size limit" });
  }

  const tempDir = await fs.makeTempDir({ prefix: "vf-middleware-" });
  const tempFile = join(tempDir, "middleware.mjs");
  let loadFailed = false;
  let loadFailure: unknown;
  let middlewareFunctions: MiddlewareFunction[] = [];

  try {
    await fs.writeTextFile(tempFile, js);
    const middlewareUrl = toFileUrl(tempFile);
    middlewareUrl.searchParams.set("v", crypto.randomUUID());
    const middlewareModule = await import(middlewareUrl.href);
    middlewareFunctions = normalizeMiddlewareExport(middlewareModule);
  } catch (error) {
    loadFailed = true;
    loadFailure = error;
  }

  let cleanupFailed = false;
  try {
    await fs.remove(tempDir, { recursive: true });
  } catch (error) {
    logger.warn("Failed to clean up middleware temporary files", {
      failureCategory: classifyTelemetryError(error),
    });
    cleanupFailed = true;
  }

  if (loadFailed) {
    throw loadFailure;
  }
  if (cleanupFailed) {
    throw COMPILATION_ERROR.create({ detail: "Middleware temporary file cleanup failed" });
  }

  return middlewareFunctions;
}

async function assertBoundedMiddlewareFile(
  middlewarePath: string,
  adapter: RuntimeAdapter,
): Promise<void> {
  const info = await adapter.fs.stat(middlewarePath);
  if (!info.isFile) {
    throw new TypeError("Middleware source must be a file");
  }
  if (!Number.isSafeInteger(info.size) || info.size < 0) {
    throw COMPILATION_ERROR.create({ detail: "Middleware source size is invalid" });
  }
  if (info.size > MAX_MIDDLEWARE_SOURCE_BYTES) {
    throw COMPILATION_ERROR.create({ detail: "Middleware source exceeds the size limit" });
  }
}

function assertProjectDirectory(projectDir: unknown): asserts projectDir is string {
  if (
    typeof projectDir !== "string" || projectDir.length === 0 ||
    textEncoder.encode(projectDir).byteLength > MAX_MIDDLEWARE_PROJECT_DIR_BYTES
  ) {
    throw new TypeError("projectDir must be a bounded non-empty path");
  }
}

async function validateMiddlewarePath(
  projectDir: string,
  middlewareFile: string,
  adapter: RuntimeAdapter,
): Promise<string> {
  const result = await validatePath(middlewareFile, {
    adapter,
    allowAbsolute: false,
    baseDir: projectDir,
    checkExists: false,
    followSymlinks: true,
    level: "normal",
  });
  if (!result.valid || !result.canonicalPath) {
    throw COMPILATION_ERROR.create({ detail: "Middleware path is outside the project" });
  }
  return result.canonicalPath;
}

function decodeBoundedMiddlewareSource(content: unknown): string {
  if (typeof content === "string") {
    if (textEncoder.encode(content).byteLength > MAX_MIDDLEWARE_SOURCE_BYTES) {
      throw COMPILATION_ERROR.create({ detail: "Middleware source exceeds the size limit" });
    }
    return content;
  }
  if (content instanceof Uint8Array) {
    if (content.byteLength > MAX_MIDDLEWARE_SOURCE_BYTES) {
      throw COMPILATION_ERROR.create({ detail: "Middleware source exceeds the size limit" });
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  }
  throw new TypeError("Middleware source must be text or bytes");
}

export function validateMiddlewareFunctionList(
  value: unknown,
  label: string,
  allowEmpty: boolean,
): MiddlewareFunction[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Invalid ${label}: expected an array of functions`);
  }
  if (!allowEmpty && value.length === 0) {
    throw new TypeError(`Invalid ${label}: expected a non-empty array of functions`);
  }
  if (value.length > MAX_MIDDLEWARE_FUNCTIONS) {
    throw new TypeError(`Invalid ${label}: too many functions`);
  }
  if (value.some((middleware) => typeof middleware !== "function")) {
    throw new TypeError(`Invalid ${label}: expected only functions`);
  }
  return value.slice() as MiddlewareFunction[];
}

function normalizeMiddlewareExport(
  middlewareModule: unknown,
): MiddlewareFunction[] {
  const exported = middlewareModule && typeof middlewareModule === "object" &&
      "default" in middlewareModule
    ? (middlewareModule as { default?: unknown }).default
    : middlewareModule;

  if (Array.isArray(exported)) {
    return validateMiddlewareFunctionList(exported, "middleware export", false);
  }

  if (typeof exported === "function") {
    return [exported as MiddlewareFunction];
  }

  throw new TypeError(
    "Invalid middleware export: expected a function or non-empty array of functions",
  );
}

export async function setupMiddleware(
  pipeline: RuntimeMiddlewarePipeline,
  config: VeryfrontConfig,
  requestHandler: RuntimeRequestHandler,
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
  requestId: string,
): Promise<void> {
  try {
    const { trace } = await import("#veryfront/observability/tracing/api-shim.ts");
    const span = trace.getActiveSpan();
    if (!span) return;

    span.setAttribute("http.request.method", method);
    span.setAttribute("veryfront.request_id", requestId);
    span.updateName(`${method} request`);
  } catch (_) {
    /* expected: OpenTelemetry is optional */
  }
}

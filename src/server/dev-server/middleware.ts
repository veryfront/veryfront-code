import { serverLogger as logger } from "@veryfront/utils";
import { MiddlewarePipeline } from "@veryfront/middleware/core/pipeline/index.ts";
import { cors } from "@veryfront/security";
import type { VeryfrontConfig } from "@veryfront/config";

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
      logger.info(`[${requestId}] --> ${method} ${url.pathname}`);
    } catch {
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
    if (response) response.headers.set("x-request-id", requestId);

    try {
      logger.info(
        `[${requestId}] <-- ${method} ${url.pathname} ${response?.status ?? 0} ${duration}ms`,
      );
    } catch {
    }

    return response;
  };
}

export function setupMiddleware(
  pipeline: MiddlewarePipeline,
  config: VeryfrontConfig,
  requestHandler: (req: Request) => Promise<Response>,
): void {
  pipeline.use(createRequestLoggerMiddleware());

  if (config.security?.cors) {
    pipeline.use(
      cors(
        config.security.cors === true ? {} : config.security.cors,
      ),
    );
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
  }
}

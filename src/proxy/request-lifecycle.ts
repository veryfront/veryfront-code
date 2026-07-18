import type { Context, Span } from "#veryfront/observability";

export interface ProxyRequestLifecycle {
  end(statusCode: number, error?: Error): void;
}

export interface RunProxyRequestLifecycleOptions {
  req: Request;
  url: URL;
  extractContext(headers: Headers): Context | undefined;
  startServerSpan(
    method: string,
    path: string,
    parentContext?: Context,
  ): { span: Span; context: Context } | null;
  withContext<T>(spanContext: Context, fn: () => Promise<T>): Promise<T>;
  endSpan(span: Span | undefined, statusCode: number, error?: Error): void;
  handle(lifecycle: ProxyRequestLifecycle): Promise<Response>;
}

/** Run a proxied HTTP request with tracing context and exactly-once span finalization. */
export async function runProxyRequestLifecycle(
  options: RunProxyRequestLifecycleOptions,
): Promise<Response> {
  const parentContext = options.extractContext(options.req.headers);
  const spanInfo = options.startServerSpan(options.req.method, options.url.pathname, parentContext);
  let ended = false;

  const lifecycle: ProxyRequestLifecycle = {
    end(statusCode, error) {
      if (ended) return;
      ended = true;
      options.endSpan(spanInfo?.span, statusCode, error);
    },
  };

  const execute = async (): Promise<Response> => {
    try {
      const response = await options.handle(lifecycle);
      lifecycle.end(response.status);
      return response;
    } catch (error) {
      const spanError = error instanceof Error ? error : new Error(String(error));
      lifecycle.end(500, spanError);
      throw error;
    }
  };

  return spanInfo?.context ? options.withContext(spanInfo.context, execute) : execute();
}

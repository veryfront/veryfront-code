import * as React from "react";
import { isCompiledBinary, rendererLogger as logger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getReactDOMServer } from "./server-loader.ts";
import { getSSRAdapterTimeoutMs } from "./timeout.ts";
import type { SSROptions } from "./types.ts";

interface RenderDeadline {
  readonly promise: Promise<never>;
  readonly signal: AbortSignal;
  dispose(): void;
}

function createRenderDeadline(timeoutMs: number): RenderDeadline {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(`SSR timeout: buffered React render exceeded ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  return {
    promise,
    signal: controller.signal,
    dispose() {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = undefined;
    },
  };
}

async function streamToString(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let completed = false;
  let rejectAbort!: (reason: unknown) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    rejectAbort(signal.reason ?? new DOMException("The render was aborted", "AbortError"));
  };

  try {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });

    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) {
        completed = true;
        break;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    signal.removeEventListener("abort", abort);
    if (!completed) {
      try {
        reader.cancel(signal.reason).catch(() => {
          /* expected: the stream may already be errored or cancelled */
        });
      } catch {
        /* expected: the stream may already be errored or cancelled */
      }
    }
    try {
      reader.releaseLock();
    } catch {
      /* expected: a stream implementation may release its lock during cancellation */
    }
  }
}

function notifyErrorObserver(observer: SSROptions["onError"], error: unknown): void {
  try {
    observer?.(error instanceof Error ? error : new Error(String(error)));
  } catch (observerError) {
    logger.error("SSR onError observer failed", observerError);
  }
}

export async function renderToStringAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const server = await getReactDOMServer(options.reactVersion);
  const canUseReadableStream = server.renderToReadableStream && !isCompiledBinary();

  if (canUseReadableStream) {
    const timeoutMs = getSSRAdapterTimeoutMs();
    const deadline = createRenderDeadline(timeoutMs);
    const reportedErrors = new Set<unknown>();
    try {
      const setupPromise = withSpan(
        SpanNames.SSR_REACT_RENDER_TO_STREAM,
        () =>
          server.renderToReadableStream!(element, {
            bootstrapModules: options.bootstrapModules,
            bootstrapScripts: options.bootstrapScripts,
            identifierPrefix: options.identifierPrefix,
            namespaceURI: options.namespaceURI,
            nonce: options.nonce,
            onError: (error: unknown) => {
              if (deadline.signal.aborted) return;
              reportedErrors.add(error);
              logger.error("SSR renderToReadableStream error", error);
              notifyErrorObserver(options.onError, error);
            },
            progressiveChunkSize: options.progressiveChunkSize,
            signal: deadline.signal,
          }),
        { "ssr.method": "renderToReadableStream" },
      ) as Promise<ReadableStream<Uint8Array>>;

      // A renderer that ignores AbortSignal may resolve after our deadline.
      // Cancel that late stream instead of leaving its work detached.
      setupPromise.then(
        (lateStream) => {
          if (deadline.signal.aborted) {
            lateStream.cancel(deadline.signal.reason).catch(() => {
              /* expected: a late stream may already be closed */
            });
          }
        },
        () => {
          /* the awaited race below owns setup failures */
        },
      );

      const stream = await Promise.race([setupPromise, deadline.promise]);

      return await Promise.race([
        streamToString(stream, deadline.signal),
        deadline.promise,
      ]);
    } catch (error) {
      logger.error("SSR renderToReadableStream failed", error);
      if (!reportedErrors.has(error)) notifyErrorObserver(options.onError, error);
      throw error;
    } finally {
      deadline.dispose();
    }
  }

  try {
    return (await withSpan(
      SpanNames.SSR_REACT_RENDER_TO_STRING,
      () =>
        Promise.resolve(
          server.renderToString(element, {
            identifierPrefix: options.identifierPrefix,
          }),
        ),
      { "ssr.method": "renderToString" },
    )) as string;
  } catch (error) {
    logger.error("SSR renderToString failed", error);
    notifyErrorObserver(options.onError, error);
    throw error;
  }
}

export async function renderToStaticMarkupAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const { renderToStaticMarkup } = await getReactDOMServer(options.reactVersion);

  try {
    return renderToStaticMarkup(element, {
      identifierPrefix: options.identifierPrefix,
    });
  } catch (error) {
    logger.error("SSR renderToStaticMarkup failed", error);
    notifyErrorObserver(options.onError, error);
    throw error;
  }
}

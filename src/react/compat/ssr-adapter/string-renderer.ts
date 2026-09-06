import * as React from "react";
import { isCompiledBinary, rendererLogger as logger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveSSRRuntime } from "./server-loader.ts";
import {
  getSSRAdapterDeadlineRuntime,
  getSSRAdapterTimeoutMs,
  getSSRBufferLimitBytes,
} from "./timeout.ts";
import type { SSROptions } from "./types.ts";
import { wrapWithServerRenderContext } from "../../server-render-context.ts";

const STREAM_YIELD_INTERVAL_BYTES = 256 * 1024;

interface RenderDeadline {
  readonly error: Error;
  readonly expiresAt: number;
  readonly promise: Promise<never>;
  readonly signal: AbortSignal;
  throwIfExpired(): void;
  dispose(): void;
}

function createRenderDeadline(timeoutMs: number): RenderDeadline {
  const runtime = getSSRAdapterDeadlineRuntime();
  const controller = new AbortController();
  const error = new Error(`SSR timeout: buffered React render exceeded ${timeoutMs}ms`);
  const expiresAt = runtime.now() + timeoutMs;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  let rejectTimeout!: (error: Error) => void;
  const promise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const expire = () => {
    if (expired) return;
    expired = true;
    if (!controller.signal.aborted) {
      controller.abort(error);
    }
    rejectTimeout(error);
  };
  timeoutId = runtime.setTimer(expire, timeoutMs);

  return {
    error,
    expiresAt,
    promise,
    signal: controller.signal,
    throwIfExpired() {
      if (!expired && runtime.now() < expiresAt) return;
      expire();
      throw error;
    },
    dispose() {
      if (timeoutId !== undefined) runtime.clearTimer(timeoutId);
      timeoutId = undefined;
    },
  };
}

async function streamToString(
  stream: ReadableStream<Uint8Array>,
  deadline: RenderDeadline,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let completed = false;
  let totalBytes = 0;
  let bytesSinceYield = 0;
  let failure: unknown;
  let rejectAbort!: (reason: unknown) => void;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    rejectAbort(
      deadline.signal.reason ?? new DOMException("The render was aborted", "AbortError"),
    );
  };

  try {
    if (deadline.signal.aborted) abort();
    else deadline.signal.addEventListener("abort", abort, { once: true });

    while (true) {
      // Timers cannot run while an always-ready stream continuously schedules
      // microtasks, so enforce the same absolute deadline inside the loop.
      deadline.throwIfExpired();
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      deadline.throwIfExpired();
      if (done) {
        completed = true;
        break;
      }

      if (value.byteLength > maxBytes - totalBytes) {
        throw new RangeError(
          `SSR buffered output exceeded ${maxBytes} bytes`,
        );
      }
      totalBytes += value.byteLength;
      bytesSinceYield += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      if (bytesSinceYield >= STREAM_YIELD_INTERVAL_BYTES) {
        bytesSinceYield = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        deadline.throwIfExpired();
      }
    }

    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    deadline.signal.removeEventListener("abort", abort);
    if (!completed) {
      try {
        reader.cancel(failure ?? deadline.signal.reason).catch(() => {
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
  const maxBufferedBytes = getSSRBufferLimitBytes(options.maxBufferedBytes);
  const { server, react: projectReact } = await resolveSSRRuntime(options);
  const renderElement = projectReact
    ? wrapWithServerRenderContext(element, options.renderContext, projectReact)
    : element;
  const canUseReadableStream = server.renderToReadableStream && !isCompiledBinary();

  if (canUseReadableStream) {
    const timeoutMs = getSSRAdapterTimeoutMs();
    const deadline = createRenderDeadline(timeoutMs);
    const reportedErrors = new Set<unknown>();
    try {
      const setupPromise = withSpan(
        SpanNames.SSR_REACT_RENDER_TO_STREAM,
        () =>
          server.renderToReadableStream!(renderElement, {
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
            try {
              lateStream.cancel(deadline.signal.reason).catch(() => {
                /* expected: a late stream may already be closed */
              });
            } catch {
              /* expected: a non-conforming stream may throw during cancellation */
            }
          }
        },
        () => {
          /* the awaited race below owns setup failures */
        },
      );

      const stream = await Promise.race([setupPromise, deadline.promise]);

      return await Promise.race([
        streamToString(stream, deadline, maxBufferedBytes),
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
    const html = (await withSpan(
      SpanNames.SSR_REACT_RENDER_TO_STRING,
      () =>
        Promise.resolve(
          server.renderToString(renderElement, {
            identifierPrefix: options.identifierPrefix,
          }),
        ),
      { "ssr.method": "renderToString" },
    )) as string;
    assertBufferedOutputWithinLimit(html, maxBufferedBytes);
    return html;
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
  const maxBufferedBytes = getSSRBufferLimitBytes(options.maxBufferedBytes);
  const { server: { renderToStaticMarkup }, react: projectReact } = await resolveSSRRuntime(
    options,
  );
  const renderElement = projectReact
    ? wrapWithServerRenderContext(element, options.renderContext, projectReact)
    : element;

  try {
    const html = renderToStaticMarkup(renderElement, {
      identifierPrefix: options.identifierPrefix,
    });
    assertBufferedOutputWithinLimit(html, maxBufferedBytes);
    return html;
  } catch (error) {
    logger.error("SSR renderToStaticMarkup failed", error);
    notifyErrorObserver(options.onError, error);
    throw error;
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) {
      bytes += 1;
    } else if (codeUnit < 0x800) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function assertBufferedOutputWithinLimit(html: string, maxBytes: number): void {
  if (utf8ByteLength(html) > maxBytes) {
    throw new RangeError(`SSR buffered output exceeded ${maxBytes} bytes`);
  }
}

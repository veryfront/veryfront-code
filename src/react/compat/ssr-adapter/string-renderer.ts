import * as React from "react";
import { isCompiledBinary, rendererLogger as logger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getReactDOMServer } from "./server-loader.ts";
import type { SSROptions } from "./types.ts";

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }

    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
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
    try {
      const stream = (await withSpan(
        SpanNames.SSR_REACT_RENDER_TO_STREAM,
        () =>
          server.renderToReadableStream!(element, {
            bootstrapModules: options.bootstrapModules,
            bootstrapScripts: options.bootstrapScripts,
            identifierPrefix: options.identifierPrefix,
            namespaceURI: options.namespaceURI,
            nonce: options.nonce,
            onError: (error: unknown) => {
              logger.error("SSR renderToReadableStream error", error);
              notifyErrorObserver(options.onError, error);
            },
            progressiveChunkSize: options.progressiveChunkSize,
          }),
        { "ssr.method": "renderToReadableStream" },
      )) as ReadableStream<Uint8Array>;

      return await streamToString(stream);
    } catch (error) {
      logger.warn("SSR renderToReadableStream failed, falling back to renderToString", error);
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

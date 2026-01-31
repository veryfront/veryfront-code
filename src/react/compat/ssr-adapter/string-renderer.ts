import * as React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { getReactDOMServer } from "./server-loader.ts";
import type { SSROptions } from "./types.ts";

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }

  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function renderToStringAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const server = await getReactDOMServer();

  if (server.renderToReadableStream) {
    try {
      const stream = (await withSpan(
        SpanNames.SSR_REACT_RENDER_TO_STREAM,
        () =>
          server.renderToReadableStream!(element, {
            onError: (error: unknown) => {
              logger.error("SSR renderToReadableStream error", error);
              options.onError?.(error as Error);
            },
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
      () => Promise.resolve(server.renderToString(element)),
      { "ssr.method": "renderToString" },
    )) as string;
  } catch (error) {
    logger.error("SSR renderToString failed", error);
    options.onError?.(error as Error);
    throw error;
  }
}

export async function renderToStaticMarkupAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const { renderToStaticMarkup } = await getReactDOMServer();

  try {
    return renderToStaticMarkup(element);
  } catch (error) {
    logger.error("SSR renderToStaticMarkup failed", error);
    options.onError?.(error as Error);
    throw error;
  }
}

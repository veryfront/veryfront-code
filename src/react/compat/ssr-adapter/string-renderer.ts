import * as React from "react";
import { getBaseLogger, isCompiledBinary } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { getReactDOMServer } from "./server-loader.ts";
import type { SSROptions } from "./types.ts";

const logger = getBaseLogger("RENDERER").component("string-renderer");

function renderFailureContext(error: unknown): { errorCategory: string } {
  return { errorCategory: classifyTelemetryError(error) };
}

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
  const server = await getReactDOMServer(options.reactVersion);
  const canUseReadableStream = server.renderToReadableStream && !isCompiledBinary();

  if (canUseReadableStream) {
    try {
      const stream = (await withSpan(
        SpanNames.SSR_REACT_RENDER_TO_STREAM,
        () =>
          server.renderToReadableStream!(element, {
            onError: (error: unknown) => {
              logger.error(
                "SSR renderToReadableStream error",
                renderFailureContext(error),
              );
              options.onError?.(error as Error);
            },
          }),
        { "ssr.method": "renderToReadableStream" },
      )) as ReadableStream<Uint8Array>;

      return await streamToString(stream);
    } catch (error) {
      logger.warn(
        "SSR renderToReadableStream failed, falling back to renderToString",
        renderFailureContext(error),
      );
    }
  }

  try {
    return (await withSpan(
      SpanNames.SSR_REACT_RENDER_TO_STRING,
      () => Promise.resolve(server.renderToString(element)),
      { "ssr.method": "renderToString" },
    )) as string;
  } catch (error) {
    logger.error("SSR renderToString failed", renderFailureContext(error));
    options.onError?.(error as Error);
    throw error;
  }
}

export async function renderToStaticMarkupAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const { renderToStaticMarkup } = await getReactDOMServer(options.reactVersion);

  try {
    return renderToStaticMarkup(element);
  } catch (error) {
    logger.error("SSR renderToStaticMarkup failed", renderFailureContext(error));
    options.onError?.(error as Error);
    throw error;
  }
}

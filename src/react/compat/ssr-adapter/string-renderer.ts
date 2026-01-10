import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { getReactDOMServer } from "./server-loader.ts";
import type { SSROptions } from "./types.ts";

/**
 * Collect a ReadableStream into a string.
 */
async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }

  // Flush the decoder
  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function renderToStringAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<string> {
  const server = await getReactDOMServer();

  // Prefer renderToReadableStream for concurrent-safe SSR (React 18+)
  // This avoids the global state issues with legacy renderToString
  if (server.renderToReadableStream) {
    try {
      const stream = await server.renderToReadableStream(
        element as Parameters<NonNullable<typeof server.renderToReadableStream>>[0],
        {
          onError: (error: unknown) => {
            logger.error("SSR renderToReadableStream error", error);
            options.onError?.(error as Error);
          },
        },
      );
      return await streamToString(stream);
    } catch (error) {
      logger.warn("SSR renderToReadableStream failed, falling back to renderToString", error);
      // Fall through to legacy renderToString
    }
  }

  // Fallback to legacy renderToString (React 17 or if streaming fails)
  try {
    return server.renderToString(element as Parameters<typeof server.renderToString>[0]);
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
    return renderToStaticMarkup(element as Parameters<typeof renderToStaticMarkup>[0]);
  } catch (error) {
    logger.error("SSR renderToStaticMarkup failed", error);
    options.onError?.(error as Error);
    throw error;
  }
}

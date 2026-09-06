import type * as React from "react";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { createHTMLShell, wrapInHTML } from "./html-wrapper.ts";
import { renderToStreamAdapter } from "./stream-renderer.ts";
import type { HTMLWrapOptions, SSRResponseOptions, SSRResult } from "./types.ts";

function createHtmlHeaders(baseHeaders: HeadersInit | undefined, reactVersion: string): Headers {
  const headers = new Headers(baseHeaders);
  headers.delete("Content-Length");
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-React-Version", reactVersion);
  return headers;
}

function createWrapOptions(options: SSRResponseOptions): HTMLWrapOptions {
  return {
    title: options.title ?? "Veryfront App",
    meta: options.meta ?? {},
    links: options.links ?? [],
    scripts: options.scripts ?? [],
    bootstrapScripts: options.bootstrapScripts ?? [],
    bootstrapModules: options.bootstrapModules ?? [],
    nonce: options.nonce,
  };
}

function createComponentRenderOptions(options: SSRResponseOptions): SSRResponseOptions {
  return {
    ...options,
    // The response builder owns the surrounding document. Keep document-level
    // bootstrap tags out of the component render so they cannot become children
    // of the hydration root; createHTMLShell appends them after that root closes.
    bootstrapScripts: [],
    bootstrapModules: [],
  };
}

/** Wrap a component byte stream in one complete HTML document. */
export function wrapReadableStreamInHTML(
  source: ReadableStream<Uint8Array>,
  options: HTMLWrapOptions,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const encoder = new TextEncoder();
  const { prefix, suffix } = createHTMLShell(options);
  let prefixSent = false;
  let sourceDone = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true;
        controller.enqueue(encoder.encode(prefix));
        return;
      }
      if (sourceDone) return;

      try {
        const chunk = await reader.read();
        if (!chunk.done) {
          controller.enqueue(chunk.value);
          return;
        }
        sourceDone = true;
        controller.enqueue(encoder.encode(suffix));
        controller.close();
      } catch (error) {
        sourceDone = true;
        controller.error(error);
      }
    },
    async cancel(reason) {
      sourceDone = true;
      await reader.cancel(reason);
    },
  });
}

async function pipeableToReadableStream(
  result: Pick<SSRResult, "abort" | "pipe">,
): Promise<ReadableStream<Uint8Array>> {
  if (!result.pipe) {
    throw new TypeError("SSR pipeable result is missing its pipe function");
  }

  const { PassThrough } = await import("node:stream");
  const destination = new PassThrough();
  try {
    result.pipe(destination);
  } catch (error) {
    result.abort?.();
    destination.destroy();
    throw error;
  }

  // Deno's Readable.toWeb adapter can enqueue a buffered Node `data` event
  // after the web consumer has cancelled. Drive the paused Node stream through
  // its async iterator instead so cancellation has one deterministic owner.
  const iterator = destination[Symbol.asyncIterator]();
  let cancelled = false;
  const bridged = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await iterator.next();
        if (cancelled) return;
        if (chunk.done) {
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    async cancel(reason) {
      cancelled = true;
      let abortError: unknown;
      try {
        result.abort?.();
      } catch (error) {
        abortError = error;
      }
      destination.destroy();
      await iterator.return?.(reason);
      if (abortError !== undefined) throw abortError;
    },
  });
  return bridged;
}

/** Build an HTTP response from an already-created SSR result. */
export async function createSSRResponseFromResult(
  result: SSRResult,
  options: SSRResponseOptions,
  reactVersion: string,
): Promise<Response> {
  const headers = createHtmlHeaders(options.headers, reactVersion);
  const wrapOptions = createWrapOptions(options);

  if (result.stream || result.pipe) {
    const componentStream = result.stream ?? await pipeableToReadableStream(result);
    const body = wrapReadableStreamInHTML(componentStream, wrapOptions);
    return new Response(body, { status: 200, headers });
  }

  if (result.html !== undefined) {
    return new Response(wrapInHTML(result.html, wrapOptions), {
      status: 200,
      headers,
    });
  }

  throw new TypeError(
    "SSR renderer returned no HTML, readable stream, or pipeable stream",
  );
}

export async function createSSRResponse(
  element: React.ReactNode,
  options: SSRResponseOptions = {},
): Promise<Response> {
  const version = options.reactVersion ?? options.reactRuntime?.react.version ??
    getReactVersionInfo().version;
  const result = await renderToStreamAdapter(element, createComponentRenderOptions(options));
  return createSSRResponseFromResult(result, options, version);
}

import * as React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { getReactVersionInfo, hasFeature } from "../version-detector/index.ts";
import { getReactDOMServer } from "./server-loader.ts";
import { renderToStringAdapter } from "./string-renderer.ts";
import type { SSROptions, SSRResult } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { isDebugEnvEnabled } from "#veryfront/config/env.ts";
import { SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";

interface VeryfrontGlobal {
  __VERYFRONT_DEBUG__?: boolean;
}

function isDebugMode(): boolean {
  return Boolean(
    (globalThis as VeryfrontGlobal).__VERYFRONT_DEBUG__ || isDebugEnvEnabled(),
  );
}

async function renderToReadableStreamImpl(
  element: React.ReactNode,
  options: SSROptions,
  server: Awaited<ReturnType<typeof getReactDOMServer>>,
): Promise<SSRResult> {
  const debug = isDebugMode();
  const start = performance.now();

  if (!server.renderToReadableStream) {
    throw toError(createError({
      type: "not_supported",
      message: "renderToReadableStream not available",
      feature: "renderToReadableStream",
    }));
  }

  // Create AbortController for timeout - this actually aborts the React render
  // When aborted, React will flush loading fallbacks as HTML and render the rest on client
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    logger.error("SSR_TIMEOUT aborting React render", { timeoutMs: SSR_TIMEOUT_MS });
    controller.abort(new Error(`SSR timeout: React render exceeded ${SSR_TIMEOUT_MS}ms`));
  }, SSR_TIMEOUT_MS);

  try {
    if (debug) logger.info("SSR renderToReadableStream started");

    const stream = await server.renderToReadableStream(
      element as Parameters<typeof server.renderToReadableStream>[0],
      {
        signal: controller.signal, // Pass abort signal to React
        bootstrapScripts: options.bootstrapScripts,
        bootstrapModules: options.bootstrapModules,
        identifierPrefix: options.identifierPrefix,
        namespaceURI: options.namespaceURI,
        nonce: options.nonce,
        onError: (error: unknown) => {
          // Don't log abort errors as they're expected on timeout
          if (error instanceof Error && error.name === "AbortError") {
            logger.warn("SSR_ABORT React render aborted due to timeout");
            return;
          }
          logger.error("SSR_ERROR React streaming error", error);
          options.onError?.(error as Error);
        },
        progressiveChunkSize: options.progressiveChunkSize,
      },
    );

    // Clear timeout since render completed successfully
    clearTimeout(timeoutId);

    if (debug) {
      const durationMs = Math.round(performance.now() - start);
      logger.info("SSR renderToReadableStream completed", { durationMs });
    }

    return { stream };
  } catch (error) {
    // Clear timeout to prevent memory leak
    clearTimeout(timeoutId);
    const durationMs = Math.round(performance.now() - start);

    // Check if this was an abort/timeout error
    const isAbort = error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("SSR timeout") ||
        error.message.includes("aborted"));
    if (isAbort) {
      logger.error("SSR_TIMEOUT React render was aborted", { durationMs, timeoutMs: SSR_TIMEOUT_MS });
      // Re-throw timeout errors - don't try fallback, fail fast
      throw error;
    }

    logger.error("SSR_ERROR renderToReadableStream failed", { durationMs }, error);
    options.onError?.(error as Error);

    try {
      if (debug) logger.info("SSR trying string rendering fallback");
      const html = await renderToStringAdapter(element, options);
      if (debug) {
        logger.info("SSR string fallback succeeded", { htmlLength: html.length });
      }
      return { html };
    } catch (fallbackError) {
      logger.error("SSR_ERROR string rendering fallback also failed", fallbackError);
      throw fallbackError;
    }
  }
}

function renderToPipeableStreamImpl(
  element: React.ReactNode,
  options: SSROptions,
  server: Awaited<ReturnType<typeof getReactDOMServer>>,
): Promise<SSRResult> {
  const start = performance.now();

  if (!server.renderToPipeableStream) {
    throw toError(createError({
      type: "not_supported",
      message: "renderToPipeableStream not available",
      feature: "renderToPipeableStream",
    }));
  }

  const renderFn = server.renderToPipeableStream;

  return new Promise<SSRResult>((resolve, reject) => {
    let abortFn: (() => void) | undefined;
    let settled = false;

    // Set up timeout that will abort the React render
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;

      logger.error("SSR_TIMEOUT aborting pipeable React render", { timeoutMs: SSR_TIMEOUT_MS });

      // Call React's abort function to stop the render
      if (abortFn) {
        try {
          abortFn();
        } catch (e) {
          logger.warn("SSR_ABORT error calling abort", e);
        }
      }

      reject(
        new Error(
          `SSR timeout: React render exceeded ${SSR_TIMEOUT_MS}ms - likely a hanging data fetch`,
        ),
      );
    }, SSR_TIMEOUT_MS);

    try {
      const { pipe, abort } = renderFn(element as Parameters<typeof renderFn>[0], {
        bootstrapScripts: options.bootstrapScripts,
        bootstrapModules: options.bootstrapModules,
        identifierPrefix: options.identifierPrefix,
        namespaceURI: options.namespaceURI,
        nonce: options.nonce,
        onError: (error: unknown) => {
          logger.error("SSR_ERROR pipeable stream error", error);
          options.onError?.(error as Error);
        },
        onAllReady: () => {
          logger.debug("SSR pipeable stream all ready");
          options.onAllReady?.();
        },
        onShellReady: () => {
          if (settled) return;
          settled = true;
          if (timeoutId) clearTimeout(timeoutId);

          logger.debug("SSR pipeable stream shell ready");
          options.onShellReady?.();
          resolve({ pipe, abort });
        },
        onShellError: (error: unknown) => {
          if (settled) return;
          settled = true;
          if (timeoutId) clearTimeout(timeoutId);

          logger.error("SSR_ERROR pipeable stream shell error", error);
          options.onShellError?.(error as Error);
          reject(error);
        },
        progressiveChunkSize: options.progressiveChunkSize,
      });

      // Store abort function for timeout handler
      abortFn = abort;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    }
  }).catch(async (error) => {
    const durationMs = Math.round(performance.now() - start);
    // Check if this was a timeout error
    const isTimeout = error instanceof Error && error.message.includes("SSR timeout");
    if (!isTimeout) {
      logger.error("SSR_ERROR renderToPipeableStream failed", { durationMs }, error);
    }
    options.onError?.(error as Error);

    // Don't try fallback for timeouts - just fail fast
    if (isTimeout) {
      throw error;
    }

    try {
      const html = await renderToStringAdapter(element, options);
      return { html };
    } catch (fallbackError) {
      logger.error("SSR_ERROR string rendering fallback also failed", fallbackError);
      throw fallbackError;
    }
  });
}

export async function renderToStreamAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<SSRResult> {
  const debug = isDebugMode();
  const server = await getReactDOMServer();

  if (hasFeature("renderToReadableStream") && server.renderToReadableStream) {
    if (debug) logger.info("SSR using renderToReadableStream");
    return renderToReadableStreamImpl(element, options, server);
  }

  if (hasFeature("renderToPipeableStream") && server.renderToPipeableStream) {
    if (debug) logger.info("SSR using renderToPipeableStream");
    return renderToPipeableStreamImpl(element, options, server);
  }

  const { version } = getReactVersionInfo();
  if (debug) logger.info("SSR using string rendering", { reactVersion: version });
  try {
    const html = await renderToStringAdapter(element, options);
    return { html };
  } catch (error) {
    logger.error("SSR_ERROR string rendering failed", error);
    throw error;
  }
}

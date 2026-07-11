import * as React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { getReactDOMServer } from "./server-loader.ts";
import { renderToStringAdapter } from "./string-renderer.ts";
import type { SSROptions, SSRResult } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { isDebugEnvEnabled } from "#veryfront/config/env.ts";
import { SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";

interface VeryfrontGlobal {
  __VERYFRONT_DEBUG__?: boolean;
}

let ssrTimeoutMs = SSR_TIMEOUT_MS;

function isDebugMode(): boolean {
  return Boolean((globalThis as VeryfrontGlobal).__VERYFRONT_DEBUG__ || isDebugEnvEnabled());
}

export function __setSSRStreamTimeoutForTests(timeoutMs: number): void {
  ssrTimeoutMs = timeoutMs;
}

export function __resetSSRStreamRendererForTests(): void {
  ssrTimeoutMs = SSR_TIMEOUT_MS;
}

async function renderToReadableStreamImpl(
  element: React.ReactNode,
  options: SSROptions,
  server: Awaited<ReturnType<typeof getReactDOMServer>>,
): Promise<SSRResult> {
  if (!server.renderToReadableStream) {
    throw toError(
      createError({
        type: "not_supported",
        message: "renderToReadableStream not available",
        feature: "renderToReadableStream",
      }),
    );
  }

  const debug = isDebugMode();
  const start = performance.now();

  const controller = new AbortController();
  // Track whether the abort was triggered by our own timeout so we can detect
  // it reliably in the catch block without string-matching error messages.
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    logger.error("SSR_TIMEOUT aborting React render", { timeoutMs: ssrTimeoutMs });
    controller.abort(new Error(`SSR timeout: React render exceeded ${ssrTimeoutMs}ms`));
  }, ssrTimeoutMs);

  try {
    if (debug) logger.info("SSR renderToReadableStream started");

    const stream = await server.renderToReadableStream(element, {
      signal: controller.signal,
      bootstrapScripts: options.bootstrapScripts,
      bootstrapModules: options.bootstrapModules,
      identifierPrefix: options.identifierPrefix,
      namespaceURI: options.namespaceURI,
      nonce: options.nonce,
      onError: (error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") {
          logger.warn("SSR_ABORT React render aborted due to timeout");
          return;
        }

        logger.error("SSR_ERROR React streaming error", error);
        options.onError?.(error as Error);
      },
      progressiveChunkSize: options.progressiveChunkSize,
    });

    clearTimeout(timeoutId);

    if (debug) {
      const durationMs = Math.round(performance.now() - start);
      logger.info("SSR renderToReadableStream completed", { durationMs });
    }

    return { stream };
  } catch (error) {
    clearTimeout(timeoutId);

    const durationMs = Math.round(performance.now() - start);
    // Detect abort via our own flag (most reliable) or the standard AbortError
    // name. Avoids brittle substring matching on error messages that could
    // false-positive on unrelated errors mentioning "aborted".
    const isAbort = timedOut || (error instanceof Error && error.name === "AbortError");

    if (isAbort) {
      logger.error("SSR_TIMEOUT React render was aborted", {
        durationMs,
        timeoutMs: ssrTimeoutMs,
      });
      throw error;
    }

    logger.error("SSR_ERROR renderToReadableStream failed", { durationMs }, error);
    options.onError?.(error as Error);

    try {
      if (debug) logger.info("SSR trying string rendering fallback");
      const html = await renderToStringAdapter(element, options);
      if (debug) logger.info("SSR string fallback succeeded", { htmlLength: html.length });
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
  if (!server.renderToPipeableStream) {
    throw toError(
      createError({
        type: "not_supported",
        message: "renderToPipeableStream not available",
        feature: "renderToPipeableStream",
      }),
    );
  }

  const renderToPipeableStream = server.renderToPipeableStream;
  const start = performance.now();
  // Track whether the rejection was caused by our own timeout so the catch
  // block can detect it without string-matching the error message.
  let timedOut = false;

  const promise = new Promise<SSRResult>((resolve, reject) => {
    let abortFn: (() => void) | undefined;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      timedOut = true;

      logger.error("SSR_TIMEOUT aborting pipeable React render", { timeoutMs: ssrTimeoutMs });

      if (abortFn) {
        try {
          abortFn();
        } catch (e) {
          logger.warn("SSR_ABORT error calling abort", e);
        }
      }

      reject(
        new Error(
          `SSR timeout: React render exceeded ${ssrTimeoutMs}ms - likely a hanging data fetch`,
        ),
      );
    }, ssrTimeoutMs);

    try {
      const { pipe, abort } = renderToPipeableStream(element, {
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
          clearTimeout(timeoutId);

          logger.debug("SSR pipeable stream shell ready");
          options.onShellReady?.();
          resolve({ pipe, abort });
        },
        onShellError: (error: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          logger.error("SSR_ERROR pipeable stream shell error", error);
          options.onShellError?.(error as Error);
          reject(error);
        },
        progressiveChunkSize: options.progressiveChunkSize,
      });

      abortFn = abort;
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });

  return promise.catch(async (error) => {
    const durationMs = Math.round(performance.now() - start);

    if (!timedOut) logger.error("SSR_ERROR renderToPipeableStream failed", { durationMs }, error);
    options.onError?.(error as Error);

    if (timedOut) throw error;

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
  const server = await getReactDOMServer(options.reactVersion);

  if (server.renderToReadableStream) {
    if (debug) logger.info("SSR using renderToReadableStream");
    return renderToReadableStreamImpl(element, options, server);
  }

  if (server.renderToPipeableStream) {
    if (debug) logger.info("SSR using renderToPipeableStream");
    return renderToPipeableStreamImpl(element, options, server);
  }

  const version = options.reactVersion ?? getReactVersionInfo().version;
  if (debug) logger.info("SSR using string rendering", { reactVersion: version });

  try {
    const html = await renderToStringAdapter(element, options);
    return { html };
  } catch (error) {
    logger.error("SSR_ERROR string rendering failed", error);
    throw error;
  }
}

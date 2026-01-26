import * as dntShim from "../../../../_dnt.shims.js";
import * as React from "react";
import { rendererLogger as logger } from "../../../utils/index.js";
import { getReactVersionInfo, hasFeature } from "../version-detector/index.js";
import { getReactDOMServer } from "./server-loader.js";
import { renderToStringAdapter } from "./string-renderer.js";
import type { SSROptions, SSRResult } from "./types.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
import { isDebugEnvEnabled } from "../../../config/env.js";
import { SSR_TIMEOUT_MS } from "../../../config/defaults.js";

interface VeryfrontGlobal {
  __VERYFRONT_DEBUG__?: boolean;
}

function isDebugMode(): boolean {
  return Boolean((dntShim.dntGlobalThis as VeryfrontGlobal).__VERYFRONT_DEBUG__ || isDebugEnvEnabled());
}

async function renderToReadableStreamImpl(
  element: React.ReactNode,
  options: SSROptions,
  server: Awaited<ReturnType<typeof getReactDOMServer>>,
): Promise<SSRResult> {
  const debug = isDebugMode();
  const start = performance.now();

  if (!server.renderToReadableStream) {
    throw toError(
      createError({
        type: "not_supported",
        message: "renderToReadableStream not available",
        feature: "renderToReadableStream",
      }),
    );
  }

  const controller = new AbortController();
  const timeoutId = dntShim.setTimeout(() => {
    logger.error("SSR_TIMEOUT aborting React render", { timeoutMs: SSR_TIMEOUT_MS });
    controller.abort(new Error(`SSR timeout: React render exceeded ${SSR_TIMEOUT_MS}ms`));
  }, SSR_TIMEOUT_MS);

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
    const isAbort = error instanceof Error &&
      (error.name === "AbortError" ||
        error.message.includes("SSR timeout") ||
        error.message.includes("aborted"));

    if (isAbort) {
      logger.error("SSR_TIMEOUT React render was aborted", {
        durationMs,
        timeoutMs: SSR_TIMEOUT_MS,
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
  const start = performance.now();

  if (!server.renderToPipeableStream) {
    throw toError(
      createError({
        type: "not_supported",
        message: "renderToPipeableStream not available",
        feature: "renderToPipeableStream",
      }),
    );
  }

  return new Promise<SSRResult>((resolve, reject) => {
    let abortFn: (() => void) | undefined;
    let settled = false;

    const timeoutId = dntShim.setTimeout(() => {
      if (settled) return;
      settled = true;

      logger.error("SSR_TIMEOUT aborting pipeable React render", { timeoutMs: SSR_TIMEOUT_MS });

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
      const { pipe, abort } = server.renderToPipeableStream(element, {
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
  }).catch(async (error) => {
    const durationMs = Math.round(performance.now() - start);
    const isTimeout = error instanceof Error && error.message.includes("SSR timeout");

    if (!isTimeout) logger.error("SSR_ERROR renderToPipeableStream failed", { durationMs }, error);
    options.onError?.(error as Error);

    if (isTimeout) throw error;

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

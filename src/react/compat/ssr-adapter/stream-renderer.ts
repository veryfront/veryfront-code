import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { getReactVersionInfo, hasFeature } from "../version-detector/index.ts";
import { getReactDOMServer } from "./server-loader.ts";
import { renderToStringAdapter } from "./string-renderer.ts";
import type { SSROptions, SSRResult } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

async function renderToReadableStreamImpl(
  element: React.ReactNode,
  options: SSROptions,
  server: Awaited<ReturnType<typeof getReactDOMServer>>,
): Promise<SSRResult> {
  if (!server.renderToReadableStream) {
    throw toError(createError({
      type: "not_supported",
      message: "renderToReadableStream not available",
      feature: "renderToReadableStream",
    }));
  }

  try {
    const stream = await server.renderToReadableStream(
      element as Parameters<typeof server.renderToReadableStream>[0],
      {
        bootstrapScripts: options.bootstrapScripts,
        bootstrapModules: options.bootstrapModules,
        identifierPrefix: options.identifierPrefix,
        namespaceURI: options.namespaceURI,
        nonce: options.nonce,
        onError: (error: unknown) => {
          logger.error("React streaming error", error);
          options.onError?.(error as Error);
        },
        progressiveChunkSize: options.progressiveChunkSize,
      },
    );

    return { stream };
  } catch (error) {
    logger.error("renderToReadableStream failed", error);
    options.onError?.(error as Error);

    try {
      const html = await renderToStringAdapter(element, options);
      return { html };
    } catch (fallbackError) {
      logger.error("String rendering fallback also failed", fallbackError);
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
    throw toError(createError({
      type: "not_supported",
      message: "renderToPipeableStream not available",
      feature: "renderToPipeableStream",
    }));
  }

  const renderFn = server.renderToPipeableStream;

  return new Promise<SSRResult>((resolve, reject) => {
    try {
      const { pipe, abort } = renderFn(element as Parameters<typeof renderFn>[0], {
        bootstrapScripts: options.bootstrapScripts,
        bootstrapModules: options.bootstrapModules,
        identifierPrefix: options.identifierPrefix,
        namespaceURI: options.namespaceURI,
        nonce: options.nonce,
        onError: (error: unknown) => {
          logger.error("React pipeable stream error", error);
          options.onError?.(error as Error);
        },
        onAllReady: () => {
          logger.debug("React pipeable stream: all ready");
          options.onAllReady?.();
        },
        onShellReady: () => {
          logger.debug("React pipeable stream: shell ready");
          options.onShellReady?.();
          resolve({ pipe, abort });
        },
        onShellError: (error: unknown) => {
          logger.error("React pipeable stream shell error", error);
          options.onShellError?.(error as Error);
          reject(error);
        },
        progressiveChunkSize: options.progressiveChunkSize,
      });
    } catch (error) {
      reject(error);
    }
  }).catch(async (error) => {
    logger.error("renderToPipeableStream failed", error);
    options.onError?.(error as Error);

    try {
      const html = await renderToStringAdapter(element, options);
      return { html };
    } catch (fallbackError) {
      logger.error("String rendering fallback also failed", fallbackError);
      throw fallbackError;
    }
  });
}

export async function renderToStreamAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
): Promise<SSRResult> {
  const versionInfo = getReactVersionInfo();
  const server = await getReactDOMServer();

  if (hasFeature("renderToReadableStream") && server.renderToReadableStream) {
    return renderToReadableStreamImpl(element, options, server);
  }

  if (hasFeature("renderToPipeableStream") && server.renderToPipeableStream) {
    return renderToPipeableStreamImpl(element, options, server);
  }

  logger.info("Using string rendering for React", versionInfo.version);
  try {
    const html = await renderToStringAdapter(element, options);
    return { html };
  } catch (error) {
    logger.error("String rendering failed", error);
    throw error;
  }
}

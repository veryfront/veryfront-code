import * as React from "react";
import { rendererLogger as logger } from "#veryfront/utils";
import { getReactVersionInfo } from "../version-detector/index.ts";
import { type getReactDOMServer, resolveSSRRuntime } from "./server-loader.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { renderToStringAdapter } from "./string-renderer.ts";
import type { SSROptions, SSRResult } from "./types.ts";
import { createError, ensureError, toError } from "#veryfront/errors";
import { isDebugEnvEnabled } from "#veryfront/config/env.ts";
import {
  getSSRAdapterTimeoutMs,
  resetSSRAdapterTimeoutForTests,
  setSSRAdapterTimeoutForTests,
} from "./timeout.ts";
import { wrapWithServerRenderContext } from "../../server-render-context.ts";

interface VeryfrontGlobal {
  __VERYFRONT_DEBUG__?: boolean;
}

interface AbsoluteSetupDeadline {
  readonly error: Error;
  readonly expiresAt: number;
  readonly promise: Promise<never>;
  readonly expired: boolean;
  throwIfExpired(): void;
  dispose(): void;
}

function createAbsoluteSetupDeadline(
  timeoutMs: number,
  message: string,
  onExpire: (error: Error) => void,
): AbsoluteSetupDeadline {
  const error = new Error(message);
  const expiresAt = performance.now() + timeoutMs;
  let expired = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let rejectTimeout!: (error: Error) => void;
  const promise = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const expire = () => {
    if (expired) return;
    expired = true;
    onExpire(error);
    rejectTimeout(error);
  };
  timeoutId = setTimeout(expire, timeoutMs);

  return {
    error,
    expiresAt,
    promise,
    get expired() {
      return expired;
    },
    throwIfExpired() {
      if (!expired && performance.now() < expiresAt) return;
      expire();
      throw error;
    },
    dispose() {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      timeoutId = undefined;
    },
  };
}

function isDebugMode(): boolean {
  return Boolean((globalThis as VeryfrontGlobal).__VERYFRONT_DEBUG__ || isDebugEnvEnabled());
}

function notifyObserver<Args extends unknown[]>(
  name: string,
  observer: ((...args: Args) => void) | undefined,
  ...args: Args
): void {
  try {
    observer?.(...args);
  } catch (error) {
    logger.error(`SSR ${name} observer failed`, error);
  }
}

function createErrorReporter(
  observer: SSROptions["onError"],
): (error: unknown) => void {
  const reported = new Set<unknown>();
  return (error) => {
    if (reported.has(error)) return;
    reported.add(error);
    notifyObserver("onError", observer, ensureError(error));
  };
}

export function __setSSRStreamTimeoutForTests(timeoutMs: number): void {
  setSSRAdapterTimeoutForTests(timeoutMs);
}

export function __resetSSRStreamRendererForTests(): void {
  resetSSRAdapterTimeoutForTests();
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
  const timeoutMs = getSSRAdapterTimeoutMs();
  const reportError = createErrorReporter(options.onError);

  const controller = new AbortController();
  const deadline = createAbsoluteSetupDeadline(
    timeoutMs,
    `SSR timeout: React render exceeded ${timeoutMs}ms`,
    (error) => {
      logger.error("SSR_TIMEOUT aborting React render", { timeoutMs });
      if (!controller.signal.aborted) controller.abort(error);
    },
  );
  let cancelledStream: ReadableStream<Uint8Array> | undefined;
  const cancelTimedOutStream = (stream: ReadableStream<Uint8Array>) => {
    if (cancelledStream === stream) return;
    cancelledStream = stream;
    try {
      stream.cancel(deadline.error).catch(() => {
        /* expected: the late stream may already be closed or locked */
      });
    } catch {
      /* expected: a non-conforming stream may throw during cancellation */
    }
  };

  try {
    if (debug) logger.info("SSR renderToReadableStream started");

    const setupPromise = server.renderToReadableStream(element, {
      signal: controller.signal,
      bootstrapScripts: options.bootstrapScripts,
      bootstrapModules: options.bootstrapModules,
      identifierPrefix: options.identifierPrefix,
      namespaceURI: options.namespaceURI,
      nonce: options.nonce,
      onError: (error: unknown) => {
        if (deadline.expired) return;
        if (error instanceof Error && error.name === "AbortError") {
          logger.warn("SSR_ABORT React render aborted due to timeout");
          return;
        }

        logger.error("SSR_ERROR React streaming error", error);
        reportError(error);
      },
      progressiveChunkSize: options.progressiveChunkSize,
    });

    // AbortSignal is cooperative. If an implementation ignores it and settles
    // after the deadline, cancel the detached stream rather than leaking its
    // rendering work into the request lifecycle.
    setupPromise.then(
      (lateStream) => {
        if (deadline.expired) cancelTimedOutStream(lateStream);
      },
      () => {
        /* the race below owns setup failures */
      },
    );

    const stream = await Promise.race([setupPromise, deadline.promise]);
    try {
      deadline.throwIfExpired();
    } catch (error) {
      cancelTimedOutStream(stream);
      throw error;
    }

    if (debug) {
      const durationMs = Math.round(performance.now() - start);
      logger.info("SSR renderToReadableStream completed", { durationMs });
    }

    return {
      stream,
      allReady: (stream as ReadableStream<Uint8Array> & { allReady?: Promise<unknown> }).allReady,
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - start);
    // Detect abort via our own flag (most reliable) or the standard AbortError
    // name. Avoids brittle substring matching on error messages that could
    // false-positive on unrelated errors mentioning "aborted".
    const isAbort = deadline.expired || (error instanceof Error && error.name === "AbortError");

    if (isAbort) {
      logger.error("SSR_TIMEOUT React render was aborted", {
        durationMs,
        timeoutMs,
      });
      throw error;
    }

    logger.error("SSR_ERROR renderToReadableStream failed", { durationMs }, error);
    reportError(error);
    throw error;
  } finally {
    deadline.dispose();
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
  const timeoutMs = getSSRAdapterTimeoutMs();
  const reportError = createErrorReporter(options.onError);
  let abortFn: (() => void) | undefined;
  let abortCalled = false;
  let pipeFn: ((writable: NodeJS.WritableStream) => void) | undefined;
  let shellReadyBeforeRendererReturned = false;
  let settled = false;
  let rejectSetup: ((error: unknown) => void) | undefined;
  let resolveAllReady!: () => void;
  let rejectAllReady!: (error: unknown) => void;
  const allReady = new Promise<void>((resolve, reject) => {
    resolveAllReady = resolve;
    rejectAllReady = reject;
  });
  // Consumers are not required to await allReady. Keep its rejection observed
  // while retaining the original promise and error identity for those that do.
  allReady.catch(() => {});

  const abortOnce = () => {
    if (abortCalled || !abortFn) return;
    abortCalled = true;
    try {
      abortFn();
    } catch (error) {
      logger.warn("SSR_ABORT error calling abort", error);
    }
  };
  const deadline = createAbsoluteSetupDeadline(
    timeoutMs,
    `SSR timeout: React render exceeded ${timeoutMs}ms - likely a hanging data fetch`,
    (error) => {
      settled = true;
      logger.error("SSR_TIMEOUT aborting pipeable React render", { timeoutMs });
      abortOnce();
      rejectAllReady(error);
      rejectSetup?.(error);
    },
  );

  const promise = new Promise<SSRResult>((resolve, reject) => {
    rejectSetup = reject;

    const settleShellReady = () => {
      if (settled || deadline.expired) return;
      if (!pipeFn || !abortFn) {
        shellReadyBeforeRendererReturned = true;
        return;
      }

      try {
        deadline.throwIfExpired();
      } catch {
        return;
      }

      settled = true;
      logger.debug("SSR pipeable stream shell ready");
      resolve({ pipe: pipeFn, abort: abortFn, allReady });
      notifyObserver("onShellReady", options.onShellReady);
    };

    try {
      const { pipe, abort } = renderToPipeableStream(element, {
        bootstrapScripts: options.bootstrapScripts,
        bootstrapModules: options.bootstrapModules,
        identifierPrefix: options.identifierPrefix,
        namespaceURI: options.namespaceURI,
        nonce: options.nonce,
        onError: (error: unknown) => {
          if (deadline.expired) return;
          logger.error("SSR_ERROR pipeable stream error", error);
          rejectAllReady(error);
          reportError(error);
        },
        onAllReady: () => {
          if (deadline.expired) return;
          logger.debug("SSR pipeable stream all ready");
          resolveAllReady();
          notifyObserver("onAllReady", options.onAllReady);
        },
        onShellReady: settleShellReady,
        onShellError: (error: unknown) => {
          if (settled || deadline.expired) return;
          try {
            deadline.throwIfExpired();
          } catch {
            return;
          }

          settled = true;
          logger.error("SSR_ERROR pipeable stream shell error", error);
          reject(error);
          notifyObserver("onShellError", options.onShellError, ensureError(error));
        },
        progressiveChunkSize: options.progressiveChunkSize,
      });

      pipeFn = pipe;
      abortFn = abort;
      try {
        deadline.throwIfExpired();
      } catch {
        abortOnce();
        return;
      }
      if (shellReadyBeforeRendererReturned) settleShellReady();
    } catch (error) {
      try {
        deadline.throwIfExpired();
      } catch {
        abortOnce();
        return;
      }
      settled = true;
      reject(error);
    }
  });

  return Promise.race([promise, deadline.promise])
    .catch((error) => {
      const durationMs = Math.round(performance.now() - start);

      if (!deadline.expired) {
        logger.error("SSR_ERROR renderToPipeableStream failed", { durationMs }, error);
      }
      reportError(error);
      throw error;
    })
    .finally(() => deadline.dispose());
}

export async function renderToStreamAdapter(
  element: React.ReactNode,
  options: SSROptions = {},
  adapter?: RuntimeAdapter,
): Promise<SSRResult> {
  const debug = isDebugMode();
  const { server, react: projectReact } = await resolveSSRRuntime(options, adapter);
  const renderElement = projectReact
    ? wrapWithServerRenderContext(element, options.renderContext, projectReact)
    : element;

  if (server.renderToReadableStream) {
    if (debug) logger.info("SSR using renderToReadableStream");
    return renderToReadableStreamImpl(renderElement, options, server);
  }

  if (server.renderToPipeableStream) {
    if (debug) logger.info("SSR using renderToPipeableStream");
    return renderToPipeableStreamImpl(renderElement, options, server);
  }

  const version = options.reactVersion ?? options.reactRuntime?.react.version ??
    getReactVersionInfo().version;
  if (debug) logger.info("SSR using string rendering", { reactVersion: version });

  try {
    const html = await renderToStringAdapter(renderElement, {
      ...options,
      reactRuntime: projectReact ? { react: projectReact, server } : undefined,
      renderContext: undefined,
    });
    return { html };
  } catch (error) {
    logger.error("SSR_ERROR string rendering failed", error);
    throw error;
  }
}

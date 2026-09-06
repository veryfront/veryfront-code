import { RENDER_ERROR } from "#veryfront/errors";
import { SSR_MAX_BUFFERED_BYTES, SSR_TIMEOUT_MS } from "#veryfront/config/defaults.ts";
import { isErrorAcrossRealms } from "#veryfront/platform/compat/error-introspection.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  getReactVersionInfo,
  renderToStreamAdapter,
  renderToStringAdapter,
} from "#veryfront/react";
import { isCompiledBinary, rendererLogger as logger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type * as React from "react";
import { streamToString } from "./utils/index.ts";
import { setupSSRGlobals } from "./ssr-globals.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  normalizeReactVersion,
  resolveProjectReactVersion,
  stripSemverRange,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { ServerRenderContextValue } from "#veryfront/react/server-render-context.ts";
import type { ReactServerRuntime } from "#veryfront/react/compat/ssr-adapter/server-loader.ts";

function supportsStreamingReactVersion(version: string): boolean {
  return Number(version.split(".")[0]) >= 18;
}

function pipeToReadableStream(
  pipeFn: (writable: NodeJS.WritableStream) => void,
  abortFn?: () => void,
): ReadableStream<Uint8Array> {
  let passThrough: import("node:stream").PassThrough | null = null;
  let cancelled = false;
  let settled = false;
  let abortCalled = false;

  const abortOnce = () => {
    if (abortCalled || !abortFn) return;
    abortCalled = true;
    try {
      abortFn();
    } catch (error) {
      logger.warn("Error aborting pipeable SSR stream", error);
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const { PassThrough } = await import("node:stream");
      passThrough = new PassThrough();
      if (cancelled) {
        passThrough.destroy();
        return;
      }

      passThrough.on("data", (chunk: Uint8Array) => {
        if (cancelled || settled) return;
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) <= 0) passThrough?.pause();
      });
      passThrough.on("end", () => {
        if (cancelled || settled) return;
        settled = true;
        controller.close();
      });
      passThrough.on("error", (err: Error) => {
        if (cancelled || settled) return;
        settled = true;
        abortOnce();
        controller.error(err);
      });

      try {
        pipeFn(passThrough);
      } catch (error) {
        if (cancelled || settled) return;
        settled = true;
        abortOnce();
        controller.error(error);
        if (!passThrough.destroyed) {
          passThrough.destroy(error instanceof Error ? error : undefined);
        }
      }
    },
    pull() {
      if (!cancelled && !settled) passThrough?.resume();
    },
    cancel(reason) {
      if (cancelled) return;
      cancelled = true;
      settled = true;
      abortOnce();

      if (passThrough && !passThrough.destroyed) {
        passThrough.destroy(isErrorAcrossRealms(reason) ? reason : undefined);
      }
    },
  });
}

function attachAllReady<T extends ReadableStream<Uint8Array>>(
  stream: T,
  allReady?: Promise<unknown>,
): T {
  if (!allReady) return stream;
  return Object.assign(stream, { allReady });
}

export interface SSRRenderOptions {
  mode: string;
  wantsStream: boolean;
  /** Realm-local renderer modules owned by the selected artifact generation. */
  reactRuntime?: ReactServerRuntime;
  /** Response-scoped CSP nonce for React-owned bootstrap scripts. */
  nonce?: string;
  /** Request capabilities that must survive async React retries. */
  renderContext?: ServerRenderContextValue;
  debugMode?: boolean;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Maximum UTF-8 bytes retained when the result must be buffered. */
  maxBufferedBytes?: number;
}

export interface SSRRenderResult {
  html: string;
  stream: ReadableStream | null;
}

export class SSRRenderer {
  private readonly mode: string;
  private readonly projectDir?: string;
  private readonly config?: VeryfrontConfig;
  private reactVersionPromise: Promise<string> | null = null;
  private resolvedReactVersion: string | null = null;

  constructor(
    mode: string,
    _adapter?: RuntimeAdapter,
    projectDir?: string,
    _projectId?: string,
    config?: VeryfrontConfig,
  ) {
    this.mode = mode;
    this.projectDir = projectDir;
    this.config = config;

    const legacyVersions = config?.client?.cdn?.versions;
    const configuredVersion = config?.react?.version ??
      (legacyVersions && legacyVersions !== "auto" ? legacyVersions.react : undefined);
    if (configuredVersion) {
      this.resolvedReactVersion = normalizeReactVersion(stripSemverRange(configuredVersion));
    }
  }

  private async getReactVersion(
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
  ): Promise<string> {
    if (
      dependencyPinningDependencies !== undefined ||
      dependencyPinningCacheKey?.startsWith("on:")
    ) {
      return await resolveProjectReactVersion({
        projectDir: this.projectDir,
        config: this.config,
        dependencyPinningCacheKey,
        dependencyPinningDependencies,
      });
    }

    if (this.resolvedReactVersion) return this.resolvedReactVersion;

    this.reactVersionPromise ??= resolveProjectReactVersion({
      projectDir: this.projectDir,
      config: this.config,
    });
    this.resolvedReactVersion = await this.reactVersionPromise;
    return this.resolvedReactVersion;
  }

  async renderToHTML(
    pageElement: React.ReactElement,
    options: SSRRenderOptions,
  ): Promise<SSRRenderResult> {
    setupSSRGlobals();

    const reactVersion = await this.getReactVersion(
      options.dependencyPinningCacheKey,
      options.dependencyPinningDependencies,
    );
    const wantsStreamingMode = this.mode === "production" || options.wantsStream;
    const compiledBinary = isCompiledBinary();
    const maxBufferedBytes = options.maxBufferedBytes ?? SSR_MAX_BUFFERED_BYTES;

    if (compiledBinary && wantsStreamingMode) {
      logger.debug(
        "Streaming SSR disabled in compiled binary (using string rendering)",
        {
          reactVersion,
          reason: "Workers with blob URLs not supported in deno compile binaries",
        },
      );
    }

    const useStreaming = !compiledBinary &&
      wantsStreamingMode &&
      supportsStreamingReactVersion(reactVersion);

    if (!useStreaming) {
      logger.debug("Using string SSR", {
        mode: this.mode,
        reactVersion,
      });

      const html = await withSpan(
        SpanNames.SSR_REACT_RENDER,
        () =>
          renderToStringAdapter(pageElement, {
            identifierPrefix: "vf",
            maxBufferedBytes,
            nonce: options.nonce,
            renderContext: options.renderContext,
            reactVersion,
            reactRuntime: options.reactRuntime,
          }),
        {
          "ssr.method": "string",
          "ssr.react_version": reactVersion,
        },
      );

      return { html, stream: null };
    }

    logger.debug("Rendering via streaming adapter", {
      reactVersion,
      delivery: options.wantsStream ? "stream" : "string",
    });

    const renderResult = await withSpan(
      SpanNames.SSR_REACT_RENDER,
      () =>
        renderToStreamAdapter(pageElement, {
          identifierPrefix: "vf",
          maxBufferedBytes,
          nonce: options.nonce,
          renderContext: options.renderContext,
          reactVersion,
          reactRuntime: options.reactRuntime,
        }),
      {
        "ssr.method": "streaming",
        "ssr.react_version": reactVersion,
        "ssr.wants_stream": options.wantsStream,
      },
    );

    if (renderResult.stream) {
      if (options.wantsStream) {
        logger.debug("True streaming SSR - returning stream without buffering");
        return { html: "", stream: attachAllReady(renderResult.stream, renderResult.allReady) };
      }

      const html = await streamToString(
        renderResult.stream,
        SSR_TIMEOUT_MS,
        maxBufferedBytes,
      );

      if (options.debugMode) {
        logger.debug("Streaming SSR completed (buffered)", { htmlLength: html.length });
      }

      return { html, stream: null };
    }

    if (renderResult.pipe) {
      if (options.wantsStream) {
        logger.debug("Converting pipeable stream to ReadableStream for true streaming");
        const stream = pipeToReadableStream(renderResult.pipe, renderResult.abort);
        return { html: "", stream: attachAllReady(stream, renderResult.allReady) };
      }

      logger.debug("Converting pipeable stream to string (Node.js renderToPipeableStream)");
      const html = await streamToString(
        pipeToReadableStream(renderResult.pipe, renderResult.abort),
        SSR_TIMEOUT_MS,
        maxBufferedBytes,
      );

      if (options.debugMode) {
        logger.debug("Pipeable SSR completed", { htmlLength: html.length });
      }

      return { html, stream: null };
    }

    if (renderResult.html) return { html: renderResult.html, stream: null };

    throw RENDER_ERROR.create({
      detail: "SSR failed - no output",
    });
  }

  getRenderingStrategy(): {
    method: "streaming" | "string";
    reactVersion: string;
    features: {
      streaming: boolean;
      suspense: boolean;
      concurrent: boolean;
    };
  } {
    const reactVersion = this.resolvedReactVersion ?? getReactVersionInfo().version;
    const hasStreamingSupport = supportsStreamingReactVersion(reactVersion);
    const useStreaming = this.mode === "production" && hasStreamingSupport;

    return {
      method: useStreaming ? "streaming" : "string",
      reactVersion,
      features: {
        streaming: hasStreamingSupport,
        suspense: hasStreamingSupport,
        concurrent: hasStreamingSupport,
      },
    };
  }

  supportsStreaming(): boolean {
    const reactVersion = this.resolvedReactVersion ?? getReactVersionInfo().version;
    return supportsStreamingReactVersion(reactVersion);
  }
}

import { RENDER_ERROR } from "#veryfront/errors/error-registry.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  getReactVersionInfo,
  renderToStreamAdapter,
  renderToStringAdapter,
} from "#veryfront/react";
import { isCompiledBinary, rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type * as React from "react";
import { streamToString } from "./utils/index.ts";
import { setupSSRGlobals } from "./ssr-globals.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  normalizeReactVersion,
  resolveProjectReactVersion,
  stripSemverRange,
} from "#veryfront/transforms/esm/package-registry.ts";

function supportsStreamingReactVersion(version: string): boolean {
  return Number(version.split(".")[0]) >= 18;
}

async function pipeToString(
  pipeFn: (writable: NodeJS.WritableStream) => void,
): Promise<string> {
  const { PassThrough } = await import("node:stream");
  const { Buffer } = await import("node:buffer");

  return await new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const passThrough = new PassThrough();

    passThrough.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    passThrough.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    passThrough.on("error", (err: Error) => reject(err));

    try {
      pipeFn(passThrough);
    } catch (error) {
      reject(error);
    }
  });
}

function pipeToReadableStream(
  pipeFn: (writable: NodeJS.WritableStream) => void,
  abortFn?: () => void,
): ReadableStream<Uint8Array> {
  let passThrough: import("node:stream").PassThrough | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const { PassThrough } = await import("node:stream");
      passThrough = new PassThrough();

      passThrough.on("data", (chunk: Uint8Array) => {
        if (cancelled) return;
        controller.enqueue(new Uint8Array(chunk));
      });
      passThrough.on("end", () => {
        if (!cancelled) controller.close();
      });
      passThrough.on("error", (err: Error) => {
        if (!cancelled) controller.error(err);
      });

      try {
        pipeFn(passThrough);
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel(reason) {
      cancelled = true;

      if (abortFn) {
        try {
          abortFn();
        } catch (error) {
          logger.warn("Error aborting pipeable SSR stream", error);
        }
      }

      if (passThrough && !passThrough.destroyed) {
        passThrough.destroy(reason instanceof Error ? reason : undefined);
      }
    },
  });
}

export interface SSRRenderOptions {
  mode: string;
  wantsStream: boolean;
  debugMode?: boolean;
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

  private async getReactVersion(): Promise<string> {
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

    const reactVersion = await this.getReactVersion();
    const wantsStreamingMode = this.mode === "production" || options.wantsStream;
    const compiledBinary = isCompiledBinary();

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
        () => renderToStringAdapter(pageElement, { reactVersion }),
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
          reactVersion,
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
        return { html: "", stream: renderResult.stream };
      }

      const html = await streamToString(renderResult.stream);

      if (options.debugMode) {
        logger.debug("Streaming SSR completed (buffered)", { htmlLength: html.length });
      }

      return { html, stream: null };
    }

    if (renderResult.pipe) {
      if (options.wantsStream) {
        logger.debug("Converting pipeable stream to ReadableStream for true streaming");
        return { html: "", stream: pipeToReadableStream(renderResult.pipe, renderResult.abort) };
      }

      logger.debug("Converting pipeable stream to string (Node.js renderToPipeableStream)");
      const html = await pipeToString(renderResult.pipe);

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

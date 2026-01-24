/**
 * SSR Renderer
 *
 * Handles server-side rendering of React elements using both streaming and string methods.
 * Provides React 18/19 streaming support with fallback to string rendering.
 */

import { ErrorCode, VeryfrontError } from "#veryfront/errors/index.ts";
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

/** Check if React version supports streaming/concurrent features (React 18+) */
function supportsStreamingSSR(
  versionInfo: ReturnType<typeof getReactVersionInfo>,
): boolean {
  return versionInfo.isReact18 || versionInfo.isReact19;
}

/**
 * Convert Node.js pipeable stream to string
 *
 * renderToPipeableStream returns { pipe, abort } instead of a ReadableStream.
 * This function creates a PassThrough stream, pipes the content to it,
 * and collects the output as a string.
 */
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
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Convert Node.js pipeable stream to Web ReadableStream for true streaming SSR
 *
 * This enables immediate TTFB by returning a ReadableStream that can be
 * piped to the HTTP response before React finishes rendering.
 */
function pipeToReadableStream(
  pipeFn: (writable: NodeJS.WritableStream) => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const { PassThrough } = await import("node:stream");
      const passThrough = new PassThrough();

      passThrough.on("data", (chunk: Uint8Array) => {
        controller.enqueue(new Uint8Array(chunk));
      });
      passThrough.on("end", () => controller.close());
      passThrough.on("error", (err: Error) => controller.error(err));

      try {
        pipeFn(passThrough);
      } catch (err) {
        controller.error(err);
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
  private readonly adapter?: RuntimeAdapter;
  private readonly projectDir?: string;
  private versionInfo: ReturnType<typeof getReactVersionInfo> | null = null;

  constructor(mode: string, adapter?: RuntimeAdapter, projectDir?: string) {
    this.mode = mode;
    this.adapter = adapter;
    this.projectDir = projectDir;
  }

  private async getVersionInfo(): Promise<ReturnType<typeof getReactVersionInfo>> {
    if (this.versionInfo) return this.versionInfo;

    if (this.projectDir) {
      const { getReactVersionInfoForProject } = await import("#veryfront/react");
      this.versionInfo = await getReactVersionInfoForProject(this.projectDir);
      return this.versionInfo;
    }

    this.versionInfo = getReactVersionInfo();
    return this.versionInfo;
  }

  async renderToHTML(
    pageElement: React.ReactElement,
    options: SSRRenderOptions,
  ): Promise<SSRRenderResult> {
    setupSSRGlobals();

    const versionInfo = await this.getVersionInfo();
    const wantsStreamingMode = this.mode === "production" || options.wantsStream;
    const compiledBinary = isCompiledBinary();

    const useStreaming = !compiledBinary &&
      wantsStreamingMode &&
      supportsStreamingSSR(versionInfo);

    if (compiledBinary && wantsStreamingMode) {
      logger.debug(
        "Streaming SSR disabled in compiled binary (using string rendering)",
        {
          reactVersion: versionInfo.version,
          reason: "Workers with blob URLs not supported in deno compile binaries",
        },
      );
    }

    if (!useStreaming) {
      logger.debug("Using string SSR", {
        mode: this.mode,
        reactVersion: versionInfo.version,
      });

      const html = await withSpan(
        SpanNames.SSR_REACT_RENDER,
        () => renderToStringAdapter(pageElement),
        {
          "ssr.method": "string",
          "ssr.react_version": versionInfo.version,
        },
      );

      return { html, stream: null };
    }

    logger.debug("Rendering via streaming adapter", {
      reactVersion: versionInfo.version,
      delivery: options.wantsStream ? "stream" : "string",
    });

    const renderResult = await withSpan(
      SpanNames.SSR_REACT_RENDER,
      () =>
        renderToStreamAdapter(pageElement, {
          identifierPrefix: "vf",
        }),
      {
        "ssr.method": "streaming",
        "ssr.react_version": versionInfo.version,
        "ssr.wants_stream": options.wantsStream,
      },
    );

    if (renderResult.stream) {
      if (options.wantsStream) {
        logger.debug("True streaming SSR - returning stream without buffering");
        return { html: "", stream: renderResult.stream as ReadableStream };
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
        return { html: "", stream: pipeToReadableStream(renderResult.pipe) };
      }

      logger.debug("Converting pipeable stream to string (Node.js renderToPipeableStream)");
      const html = await pipeToString(renderResult.pipe);

      if (options.debugMode) {
        logger.debug("Pipeable SSR completed", { htmlLength: html.length });
      }

      return { html, stream: null };
    }

    if (renderResult.html) {
      return { html: renderResult.html, stream: null };
    }

    throw new VeryfrontError("SSR failed - no output", ErrorCode.RENDER_ERROR);
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
    const versionInfo = getReactVersionInfo();
    const hasStreamingSupport = supportsStreamingSSR(versionInfo);
    const useStreaming = this.mode === "production" && hasStreamingSupport;

    return {
      method: useStreaming ? "streaming" : "string",
      reactVersion: versionInfo.version,
      features: {
        streaming: hasStreamingSupport,
        suspense: hasStreamingSupport,
        concurrent: hasStreamingSupport,
      },
    };
  }

  supportsStreaming(): boolean {
    return supportsStreamingSSR(getReactVersionInfo());
  }
}

/**
 * SSR Renderer
 *
 * Handles server-side rendering of React elements using both streaming and string methods.
 * Provides React 18/19 streaming support with fallback to string rendering.
 */

import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import {
  getReactVersionInfo,
  renderToStreamAdapter,
  renderToStringAdapter,
} from "@veryfront/react";
import { isCompiledBinary, rendererLogger as logger } from "@veryfront/utils";
import type * as React from "react";
import { streamToString } from "./utils/index.ts";
import { setupSSRGlobals } from "./ssr-globals.ts";

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
  // Dynamically import Node.js modules for Node environments
  // In Deno, renderToReadableStream is used instead, so this won't be called
  const { PassThrough } = await import("node:stream");
  const { Buffer } = await import("node:buffer");

  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const passThrough = new PassThrough();

    passThrough.on("data", (chunk: Uint8Array) => {
      chunks.push(chunk);
    });

    passThrough.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    passThrough.on("error", (err: Error) => {
      reject(err);
    });

    // Pipe the React output to our PassThrough stream
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
  // Use ReadableStream.from with an async generator for clean stream conversion
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const { PassThrough } = await import("node:stream");
      const passThrough = new PassThrough();

      passThrough.on("data", (chunk: Uint8Array) => {
        controller.enqueue(new Uint8Array(chunk));
      });

      passThrough.on("end", () => {
        controller.close();
      });

      passThrough.on("error", (err: Error) => {
        controller.error(err);
      });

      // Start piping React output
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

/**
 * SSRRenderer - Handles server-side rendering of React elements
 *
 * This class manages the React SSR process, supporting:
 * - React 18/19 streaming SSR (renderToReadableStream)
 * - React 17 string SSR (renderToString)
 * - Per-project version detection for multi-tenant rendering
 * - Stream/string delivery modes
 */
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

  /**
   * Get React version info, using per-project detection for multi-tenant support.
   */
  private async getVersionInfo(): Promise<ReturnType<typeof getReactVersionInfo>> {
    if (this.versionInfo) {
      return this.versionInfo;
    }

    if (this.projectDir) {
      const { getReactVersionInfoForProject } = await import("@veryfront/react");
      this.versionInfo = await getReactVersionInfoForProject(this.projectDir);
    } else {
      this.versionInfo = getReactVersionInfo();
    }

    return this.versionInfo;
  }

  /**
   * Render React element to HTML
   *
   * Automatically selects the best rendering method based on:
   * - React version (18/19 for streaming, 17 for string)
   * - Delivery mode (stream vs string)
   * - Production vs development mode
   *
   * @param pageElement - The React element to render
   * @param options - Rendering options
   * @returns HTML string and optional stream
   */
  async renderToHTML(
    pageElement: React.ReactElement,
    options: SSRRenderOptions,
  ): Promise<SSRRenderResult> {
    // Set up browser globals before rendering to prevent crashes when
    // libraries check for browser features during SSR
    setupSSRGlobals();

    let html = "";
    let stream: ReadableStream | null = null;
    // Use per-project version detection for multi-tenant support
    const versionInfo = await this.getVersionInfo();

    // Determine if we should use streaming
    // IMPORTANT: Disable streaming in compiled binaries because React's streaming SSR
    // uses Workers with blob URLs internally, which fail in deno compile binaries
    // Error: "Module not found: blob:null/..." in worker
    const useStreaming = !isCompiledBinary() &&
      (this.mode === "production" || options.wantsStream) &&
      (versionInfo.isReact18 || versionInfo.isReact19);

    if (
      isCompiledBinary() &&
      (this.mode === "production" || options.wantsStream)
    ) {
      logger.debug(
        "Streaming SSR disabled in compiled binary (using string rendering)",
        {
          reactVersion: versionInfo.version,
          reason: "Workers with blob URLs not supported in deno compile binaries",
        },
      );
    }

    if (useStreaming) {
      logger.debug("Rendering via streaming adapter", {
        reactVersion: versionInfo.version,
        delivery: options.wantsStream ? "stream" : "string",
      });

      // Use consistent identifierPrefix to ensure useId() generates matching IDs
      // between SSR and browser hydration (prevents hydration mismatch errors)
      const renderResult = await renderToStreamAdapter(pageElement, {
        identifierPrefix: "vf",
      });

      if (renderResult.stream) {
        // TRUE STREAMING: If client wants stream, return it directly WITHOUT buffering
        // This enables immediate TTFB - the HTML shell is sent before React finishes rendering
        if (options.wantsStream) {
          stream = renderResult.stream as ReadableStream;
          // Don't buffer! HTML stays empty, ETag will be skipped for streaming responses
          // This is the key optimization for fast TTFB
          logger.debug("True streaming SSR - returning stream without buffering");
        } else {
          // Client doesn't want stream - buffer it for HTML string response
          html = await streamToString(renderResult.stream);

          if (options.debugMode) {
            logger.debug("Streaming SSR completed (buffered)", {
              htmlLength: html.length,
            });
          }
        }
      } else if (renderResult.pipe) {
        // Handle Node.js renderToPipeableStream result
        if (options.wantsStream) {
          // TRUE STREAMING: Convert Node.js pipe to Web ReadableStream
          logger.debug("Converting pipeable stream to ReadableStream for true streaming");
          stream = pipeToReadableStream(renderResult.pipe);
        } else {
          logger.debug("Converting pipeable stream to string (Node.js renderToPipeableStream)");
          html = await pipeToString(renderResult.pipe);

          if (options.debugMode) {
            logger.debug("Pipeable SSR completed", { htmlLength: html.length });
          }
        }
      } else if (renderResult.html) {
        html = renderResult.html;
      } else {
        throw new VeryfrontError(
          "SSR failed - no output",
          ErrorCode.RENDER_ERROR,
        );
      }
    } else {
      // Use string rendering for React 17 or development mode
      logger.debug("Using string SSR", {
        mode: this.mode,
        reactVersion: versionInfo.version,
      });

      html = await renderToStringAdapter(pageElement);
    }

    return { html, stream };
  }

  /**
   * Get rendering strategy info for current React version
   */
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
    const useStreaming = this.mode === "production" &&
      (versionInfo.isReact18 || versionInfo.isReact19);

    return {
      method: useStreaming ? "streaming" : "string",
      reactVersion: versionInfo.version,
      features: {
        streaming: versionInfo.isReact18 || versionInfo.isReact19,
        suspense: versionInfo.isReact18 || versionInfo.isReact19,
        concurrent: versionInfo.isReact18 || versionInfo.isReact19,
      },
    };
  }

  /**
   * Check if streaming is supported and recommended
   */
  supportsStreaming(): boolean {
    const versionInfo = getReactVersionInfo();
    return versionInfo.isReact18 || versionInfo.isReact19;
  }
}

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
 * - Automatic version detection and method selection
 * - Stream/string delivery modes
 */
export class SSRRenderer {
  private readonly mode: string;
  private readonly adapter?: RuntimeAdapter;

  constructor(mode: string, adapter?: RuntimeAdapter) {
    this.mode = mode;
    this.adapter = adapter;
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
    let html = "";
    let stream: ReadableStream | null = null;
    const versionInfo = getReactVersionInfo();

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

      const renderResult = await renderToStreamAdapter(pageElement);

      if (renderResult.stream) {
        // If client wants stream, return it directly without buffering
        if (
          options.wantsStream && typeof (renderResult.stream as ReadableStream).tee === "function"
        ) {
          const [clientStream, bufferStream] = (renderResult.stream as ReadableStream).tee();
          stream = clientStream;
          html = await streamToString(bufferStream);

          if (options.debugMode) {
            logger.debug("Streaming SSR - teeing stream and buffering copy", {
              htmlLength: html.length,
            });
          }
        } else {
          // Client doesn't want stream or can't tee - buffer it
          html = await streamToString(renderResult.stream);

          if (options.debugMode) {
            logger.debug("Streaming SSR completed (buffered)", {
              htmlLength: html.length,
            });
          }
        }
      } else if (renderResult.pipe) {
        // Handle Node.js renderToPipeableStream result
        // This is the case when running in Node.js - the result has { pipe, abort }
        logger.debug(
          "Converting pipeable stream to string (Node.js renderToPipeableStream)",
        );
        html = await pipeToString(renderResult.pipe);

        if (options.debugMode) {
          logger.debug("Pipeable SSR completed", { htmlLength: html.length });
        }
      } else if (renderResult.html) {
        html = renderResult.html;
      } else {
        throw new VeryfrontError(
          "SSR failed - no output",
          ErrorCode.RENDER_ERROR,
        );
      }

      // Note: We don't do a second render pass if stream is unavailable
      // The client will receive the HTML string, which is sufficient
      // A second render would double the SSR time (300ms -> 600ms) with no benefit
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

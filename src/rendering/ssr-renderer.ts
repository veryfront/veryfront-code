/**
 * SSR Renderer
 *
 * Handles server-side rendering of React elements using both streaming and string methods.
 * Provides React 18/19 streaming support with fallback to string rendering.
 */

import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import {
  getReactVersionInfo,
  renderToStreamAdapter,
  renderToStringAdapter,
} from "@veryfront/react";
import { streamToString } from "./utils/index.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

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
    let html: string;
    let stream: ReadableStream | null = null;
    const versionInfo = getReactVersionInfo();

    // Determine if we should use streaming
    const useStreaming = (this.mode === "production" || options.wantsStream) &&
      (versionInfo.isReact18 || versionInfo.isReact19);

    if (useStreaming) {
      logger.info("Rendering via streaming adapter", {
        reactVersion: versionInfo.version,
        delivery: options.wantsStream ? "stream" : "string",
      });

      const renderResult = await renderToStreamAdapter(pageElement);

      if (renderResult.stream) {
        let streamForBuffer = renderResult.stream;

        // If client wants stream and we can tee it, do so
        if (
          options.wantsStream && typeof (renderResult.stream as ReadableStream).tee === "function"
        ) {
          const [clientStream, bufferStream] = (renderResult.stream as ReadableStream).tee();
          stream = clientStream;
          streamForBuffer = bufferStream;
        }

        // Convert stream to string for immediate use
        html = await streamToString(streamForBuffer);

        if (options.debugMode) {
          logger.debug("Streaming SSR completed", { htmlLength: html.length });
        }
      } else if (renderResult.html) {
        html = renderResult.html;
      } else {
        throw new VeryfrontError("SSR failed - no output", ErrorCode.RENDER_ERROR);
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
    const useStreaming = (this.mode === "production") &&
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

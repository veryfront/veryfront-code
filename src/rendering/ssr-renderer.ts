
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

async function pipeToString(
  pipeFn: (writable: NodeJS.WritableStream) => void,
): Promise<string> {
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

export class SSRRenderer {
  private readonly mode: string;
  private readonly adapter?: RuntimeAdapter;

  constructor(mode: string, adapter?: RuntimeAdapter) {
    this.mode = mode;
    this.adapter = adapter;
  }

  async renderToHTML(
    pageElement: React.ReactElement,
    options: SSRRenderOptions,
  ): Promise<SSRRenderResult> {
    let html = "";
    let stream: ReadableStream | null = null;
    const versionInfo = getReactVersionInfo();

    // IMPORTANT: Disable streaming in compiled binaries because React's streaming SSR
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
          html = await streamToString(renderResult.stream);

          if (options.debugMode) {
            logger.debug("Streaming SSR completed (buffered)", {
              htmlLength: html.length,
            });
          }
        }
      } else if (renderResult.pipe) {
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
    } else {
      logger.debug("Using string SSR", {
        mode: this.mode,
        reactVersion: versionInfo.version,
      });

      html = await renderToStringAdapter(pageElement);
    }

    return { html, stream };
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

  supportsStreaming(): boolean {
    const versionInfo = getReactVersionInfo();
    return versionInfo.isReact18 || versionInfo.isReact19;
  }
}

import { rendererLogger as logger, timeAsync } from "#veryfront/utils";
import type * as React from "react";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { ElementValidator } from "../element-validator/index.ts";
import type { SSRRenderer } from "../ssr-renderer.ts";
import { getContentHash } from "../utils/index.ts";
import type { HTMLGenerationContext, HTMLGenerator } from "./html.ts";
import type { RenderOptions } from "./types.ts";
import { flushHeadCollector, resetHeadCollector } from "#veryfront/react/head-collector.ts";

export interface SSROrchestratorConfig {
  mode: "development" | "production";
  debugMode: boolean;
  elementValidator: ElementValidator;
  ssrRenderer: SSRRenderer;
  htmlGenerator: HTMLGenerator;
}

export interface SSRRenderingResult {
  fullHtml: string;
  finalStream: ReadableStream | null;
  ssrHash: string;
}

export class SSROrchestrator {
  private config: SSROrchestratorConfig;

  constructor(config: SSROrchestratorConfig) {
    this.config = config;
  }

  async performSSRRendering(
    pageElement: React.ReactElement,
    generationContext: Omit<HTMLGenerationContext, "html" | "ssrHash">,
    options?: RenderOptions,
  ): Promise<SSRRenderingResult> {
    const getElementTypeName = (el: React.ReactElement | null | undefined): string => {
      if (!el?.type) return "unknown";
      if (typeof el.type === "string") return el.type;
      return (el.type as { name?: string; displayName?: string }).name ||
        (el.type as { displayName?: string }).displayName ||
        "Component";
    };
    logger.debug("[SSROrchestrator] performSSRRendering called", {
      elementType: getElementTypeName(pageElement),
      hasChildren: !!pageElement?.props?.children,
    });
    const validatedElement = this.config.elementValidator.ensureValidReactElement(
      pageElement,
      this.config.debugMode,
    );
    logger.debug("[SSROrchestrator] Element validated", {
      validatedType: getElementTypeName(validatedElement),
    });

    // Reset head collector before render
    resetHeadCollector();

    const wantsStream = options?.delivery === "stream";
    const { html, stream } = await timeAsync(
      "ssr-react-render",
      () =>
        this.config.ssrRenderer.renderToHTML(
          validatedElement,
          {
            mode: this.config.mode,
            wantsStream,
            debugMode: this.config.debugMode,
          },
        ),
      "ssr-rendering",
    );

    // Flush collected head data after render
    const collectedHead = flushHeadCollector();

    // Merge options from generationContext with the passed options parameter
    // to avoid losing props that were set in generationContext.options
    const mergedOptions = {
      ...generationContext.options,
      ...options,
      props: {
        ...generationContext.options?.props,
        ...options?.props,
      },
    };

    // If we have a stream, use TRUE STREAMING HTML generation
    // This sends HTML shell immediately without waiting for React to finish rendering
    if (stream && wantsStream) {
      // TRUE STREAMING: html is empty (not buffered), so skip content-based hash
      // Use a timestamp-based hash since we can't compute ETag from unbuffered stream
      // ETag will be skipped for streaming responses in the handler
      const ssrHash = html ? await getContentHash(html) : `stream-${Date.now()}`;

      logger.debug("[SSROrchestrator] True streaming mode - sending HTML shell immediately", {
        hasBufferedHtml: !!html,
        ssrHash,
      });

      const contextWithHash = {
        ...generationContext,
        ssrHash,
        options: mergedOptions,
        collectedHead,
      };

      const finalStream = await this.config.htmlGenerator.generateHTMLStream(
        stream,
        contextWithHash,
      );

      // fullHtml is empty for true streaming (this is intentional!)
      // The handler will skip ETag for streaming responses
      return { fullHtml: html, finalStream, ssrHash };
    }

    // Otherwise, use buffered HTML generation
    const ssrHash = await timeAsync(
      "ssr-content-hash",
      () => getContentHash(html),
      "ssr-rendering",
    );

    const fullHtml = await timeAsync(
      "ssr-html-generation",
      () =>
        this.config.htmlGenerator.generateFullHTML({
          ...generationContext,
          html,
          ssrHash,
          options: mergedOptions,
          collectedHead,
        }),
      "ssr-rendering",
    );

    const finalStream = wantsStream ? this.createStream(fullHtml) : null;

    return { fullHtml, finalStream, ssrHash };
  }

  private createStream(html: string): ReadableStream | null {
    try {
      return new Response(html).body ?? null;
    } catch (error) {
      // Failed to create ReadableStream from HTML string - this should not be silently ignored
      logger.error("Failed to create stream from HTML:", error);
      throw toError(
        createError({
          type: "render",
          message: `Unable to create response stream: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }),
      );
    }
  }
}

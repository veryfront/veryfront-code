import { rendererLogger as logger } from "@veryfront/utils";
import type * as React from "react";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type { ElementValidator } from "../element-validator/index.ts";
import type { SSRRenderer } from "../ssr-renderer.ts";
import { getContentHash } from "../utils/index.ts";
import type { HTMLGenerationContext, HTMLGenerator } from "./html.ts";
import type { RenderOptions } from "./types.ts";

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
    logger.info("[SSROrchestrator] performSSRRendering called", {
      elementType: pageElement?.type?.name || pageElement?.type?.displayName || typeof pageElement?.type,
      hasChildren: !!pageElement?.props?.children,
    });
    const validatedElement = this.config.elementValidator.ensureValidReactElement(
      pageElement,
      this.config.debugMode,
    );
    logger.info("[SSROrchestrator] Element validated", {
      validatedType: validatedElement?.type?.name || validatedElement?.type?.displayName || typeof validatedElement?.type,
    });

    const wantsStream = options?.delivery === "stream";
    const { html, stream } = await this.config.ssrRenderer.renderToHTML(
      validatedElement,
      {
        mode: this.config.mode,
        wantsStream,
        debugMode: this.config.debugMode,
      },
    );

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

    // If we have a stream, use streaming HTML generation
    if (stream && wantsStream) {
      // Compute hash from buffered HTML (if available) for better cache consistency
      const ssrHash = await getContentHash(html);

      const contextWithHash = {
        ...generationContext,
        ssrHash,
        options: mergedOptions,
      };

      const finalStream = await this.config.htmlGenerator.generateHTMLStream(
        stream,
        contextWithHash,
      );

      // Return buffered HTML alongside stream for fallback scenarios
      return { fullHtml: html, finalStream, ssrHash };
    }

    // Otherwise, use buffered HTML generation
    const ssrHash = await getContentHash(html);

    const fullHtml = await this.config.htmlGenerator.generateFullHTML({
      ...generationContext,
      html,
      ssrHash,
      options: mergedOptions,
    });

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

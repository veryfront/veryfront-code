/**
 * SSR Orchestrator - SSR-specific rendering logic
 *
 * Separated from ssr.ts to avoid circular dependency with pipeline.ts
 */

import * as React from "react";
import { rendererLogger as logger } from "@veryfront/utils";
import type { HTMLGenerationContext, HTMLGenerator } from "./html.ts";
import type { RenderOptions } from "./types.ts";
import { getContentHash } from "../utils/index.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import { ElementValidator } from "../element-validator/index.ts";
import { SSRRenderer } from "../ssr-renderer.ts";

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
    const validatedElement = this.config.elementValidator.ensureValidReactElement(
      pageElement,
      this.config.debugMode,
    );

    const wantsStream = options?.delivery === "stream";
    const { html } = await this.config.ssrRenderer.renderToHTML(validatedElement, {
      mode: this.config.mode,
      wantsStream,
      debugMode: this.config.debugMode,
    });

    const ssrHash = await getContentHash(html);

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
      throw toError(createError({
        type: "render",
        message: `Unable to create response stream: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }));
    }
  }
}

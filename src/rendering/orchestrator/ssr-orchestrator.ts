import { rendererLogger } from "#veryfront/utils";
import type * as React from "react";
import { createError, toError } from "#veryfront/errors";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { ElementValidator } from "../element-validator/index.ts";
import type { SSRRenderer } from "../ssr-renderer.ts";
import { computeHash } from "../utils/index.ts";
import type { HTMLGenerationContext, HTMLGenerator } from "./html.ts";
import type { LayoutOrchestrator } from "./layout.ts";
import type { RenderOptions } from "./types.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import {
  endRenderSession,
  hasRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { isSSRControlOutcome } from "../ssr-outcome.ts";

const logger = rendererLogger.component("ssr-orchestrator");

export interface SSROrchestratorConfig {
  mode: "development" | "production";
  debugMode: boolean;
  elementValidator: ElementValidator;
  ssrRenderer: SSRRenderer;
  htmlGenerator: HTMLGenerator;
  layoutOrchestrator?: Pick<LayoutOrchestrator, "applyLayoutsAndWrappers">;
}

export interface SSRRenderingResult {
  fullHtml: string;
  finalStream: ReadableStream | null;
  ssrHash: string;
}

function getElementTypeName(el: React.ReactElement | null | undefined): string {
  if (!el?.type) return "unknown";
  if (typeof el.type === "string") return el.type;

  const type = el.type as { name?: string; displayName?: string };
  return type.name || type.displayName || "Component";
}

function attachAllReady<T extends ReadableStream | null>(
  target: T,
  source: ReadableStream | null | undefined,
): T {
  const allReady = (source as { allReady?: unknown } | null | undefined)?.allReady;
  if (!target || !allReady || typeof (allReady as { then?: unknown }).then !== "function") {
    return target;
  }
  return Object.assign(target, { allReady });
}

export class SSROrchestrator {
  private config: SSROrchestratorConfig;

  constructor(config: SSROrchestratorConfig) {
    this.config = config;
  }

  async resolveErrorComponentPath(
    generationContext: Omit<HTMLGenerationContext, "html" | "ssrHash">,
  ): Promise<string | null> {
    const resolved = await this.config.htmlGenerator.resolveErrorComponentPath(
      { ...generationContext, html: "", ssrHash: "" } as HTMLGenerationContext,
    );
    return resolved?.path ?? null;
  }

  async performSSRRendering(
    pageElement: React.ReactElement,
    generationContext: Omit<HTMLGenerationContext, "html" | "ssrHash">,
    options?: RenderOptions,
  ): Promise<SSRRenderingResult> {
    logger.debug("performSSRRendering called", {
      elementType: getElementTypeName(pageElement),
      hasChildren: !!(pageElement.props as Record<string, unknown>)?.children,
    });

    const validatedElement = this.config.elementValidator.ensureValidReactElement(
      pageElement,
      this.config.debugMode,
    );

    logger.debug("Element validated", {
      validatedType: getElementTypeName(validatedElement),
    });

    const wantsStream = options?.delivery === "stream";

    // Use AsyncLocalStorage-based head collection for multi-tenant safety
    let renderResult: Awaited<ReturnType<SSRRenderer["renderToHTML"]>>;
    let collectedHead: Awaited<ReturnType<typeof runWithHeadCollector>>["head"];
    let errorBoundaryPath: string | undefined;

    try {
      const rendered = await runWithHeadCollector(
        (renderContext) =>
          withSpan(
            SpanNames.SSR_ORCHESTRATOR_RENDER,
            () =>
              this.config.ssrRenderer.renderToHTML(validatedElement, {
                mode: this.config.mode,
                wantsStream,
                nonce: options?.nonce,
                renderContext,
                debugMode: this.config.debugMode,
                dependencyPinningCacheKey: options?.dependencyPinningCacheKey,
                dependencyPinningDependencies: options?.dependencyPinningDependencies,
              }),
            {
              "ssr.wants_stream": wantsStream,
              "ssr.mode": this.config.mode,
            },
          ),
        { nonce: options?.nonce },
      );
      renderResult = rendered.result;
      collectedHead = rendered.head;
    } catch (renderError) {
      // A thrown notFound()/redirect() control result is NOT a render error —
      // let it propagate to the SSR error handler (→ 404 / redirect).
      if (isSSRControlOutcome(renderError)) throw renderError;

      // The page threw during SSR (React error boundaries don't catch SSR render
      // throws). Render the segment's app-router error.tsx instead, if present;
      // otherwise re-throw for the normal 500 / dev-overlay path.
      const fallback = await this.renderErrorBoundaryFallback(generationContext, renderError);
      if (!fallback) throw renderError;
      renderResult = fallback.result;
      collectedHead = fallback.head;
      errorBoundaryPath = fallback.errorPath;
    }

    const { html, stream } = renderResult;

    if (options?.renderSessionId && hasRenderSession(options.renderSessionId)) {
      endRenderSession(options.renderSessionId);
    }

    const mergedOptions = {
      ...generationContext.options,
      ...options,
      props: {
        ...generationContext.options?.props,
        ...options?.props,
      },
      // Present only on the error path: the client bundle wraps this boundary.
      ...(errorBoundaryPath ? { errorPath: errorBoundaryPath } : {}),
    };

    if (stream && wantsStream) {
      const ssrHash = html ? await computeHash(html) : `stream-${Date.now()}`;

      logger.debug("True streaming mode - sending HTML shell immediately", {
        hasBufferedHtml: !!html,
        ssrHash,
      });

      const finalStream = await this.config.htmlGenerator.generateHTMLStream(stream, {
        ...generationContext,
        ssrHash,
        options: mergedOptions,
        collectedHead,
      });

      return { fullHtml: html, finalStream: attachAllReady(finalStream, stream), ssrHash };
    }

    const ssrHash = await withSpan(SpanNames.SSR_CONTENT_HASH, () => computeHash(html), {
      "ssr.html_length": html.length,
    });

    const fullHtml = await withSpan(
      SpanNames.SSR_HTML_GENERATE,
      () =>
        this.config.htmlGenerator.generateFullHTML({
          ...generationContext,
          html,
          ssrHash,
          options: mergedOptions,
          collectedHead,
        }),
      { "ssr.hash": ssrHash },
    );

    if (errorBoundaryPath) {
      // The page threw and its app-router error.tsx rendered as the response
      // body. Signal a 500 and bypass caching (an errored page must not cache)
      // by throwing the already-built document; the SSR error handler returns it.
      const signal = new Error("app-router-error-boundary-rendered") as Error & {
        errorBoundaryHtml?: string;
        errorBoundarySsrHash?: string;
      };
      signal.errorBoundaryHtml = fullHtml;
      signal.errorBoundarySsrHash = ssrHash;
      throw signal;
    }

    return {
      fullHtml,
      finalStream: wantsStream ? this.createStream(fullHtml) : null,
      ssrHash,
    };
  }

  /**
   * Render the segment's app-router error.tsx as the page body for a caught SSR
   * render throw. Returns the rendered result + the boundary's source path (for
   * the client hydration bundle), or null when the segment has no error.tsx.
   */
  private async renderErrorBoundaryFallback(
    generationContext: Omit<HTMLGenerationContext, "html" | "ssrHash">,
    renderError: unknown,
  ): Promise<
    {
      result: Awaited<ReturnType<SSRRenderer["renderToHTML"]>>;
      head: Awaited<ReturnType<typeof runWithHeadCollector>>["head"];
      errorPath: string;
    } | null
  > {
    const err = renderError instanceof Error ? renderError : new Error(String(renderError));
    const errorInfo = await this.config.htmlGenerator.resolveErrorComponent(
      { ...generationContext, html: "", ssrHash: "" } as HTMLGenerationContext,
      err,
    );
    if (!errorInfo) return null;

    const renderOptions = generationContext.options;
    const mergedFrontmatter = {
      ...generationContext.pageInfo?.entity?.frontmatter,
      ...generationContext.pageBundle?.frontmatter,
    };
    const fallbackElement = this.config.layoutOrchestrator
      ? await this.config.layoutOrchestrator.applyLayoutsAndWrappers(
        errorInfo.element as React.ReactElement,
        generationContext.pageInfo,
        generationContext.layoutBundle,
        generationContext.nestedLayouts,
        undefined,
        renderOptions?.url,
        renderOptions?.params,
        mergedFrontmatter,
        generationContext.pageBundle?.headings,
        renderOptions?.projectSlug,
        renderOptions?.clientPageIsland,
        renderOptions?.props,
        renderOptions?.dependencyPinningCacheKey,
        renderOptions?.dependencyPinningDependencies,
        renderOptions?.dependencyPinningSource,
        renderOptions?.abortSignal,
      )
      : errorInfo.element;

    const rendered = await runWithHeadCollector(
      (renderContext) =>
        this.config.ssrRenderer.renderToHTML(fallbackElement as React.ReactElement, {
          mode: this.config.mode,
          wantsStream: false,
          nonce: renderOptions?.nonce,
          renderContext,
          debugMode: this.config.debugMode,
          dependencyPinningCacheKey: renderOptions?.dependencyPinningCacheKey,
          dependencyPinningDependencies: renderOptions?.dependencyPinningDependencies,
        }),
      { nonce: renderOptions?.nonce },
    );
    logger.debug("Rendered app-router error.tsx for a page throw", {
      errorPath: errorInfo.path,
      error: err.message,
    });
    return { result: rendered.result, head: rendered.head, errorPath: errorInfo.path };
  }

  private createStream(html: string): ReadableStream | null {
    try {
      return new Response(html).body ?? null;
    } catch (error) {
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

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
import { getWorkerPool, isSSRIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import type { WorkerResponse } from "#veryfront/security/sandbox/worker-types.ts";
import { requireActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  endRenderSession,
  hasRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";

import { isDataControlResult } from "#veryfront/data/helpers.ts";

const logger = rendererLogger.component("ssr-orchestrator");

/** True when the thrown value is (or wraps) a notFound()/redirect() control result. */
function isThrownControlResult(error: unknown): boolean {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    if (isDataControlResult(current)) return true;
    seen.add(current);
    stack.push((current as { cause?: unknown }).cause);
    const aggregated = (current as { errors?: unknown }).errors;
    if (Array.isArray(aggregated)) stack.push(...aggregated);
  }
  return false;
}

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

/**
 * Options for isolated SSR rendering through the Worker pool.
 * When provided and SSR isolation is enabled, the rendering happens
 * in a per-project Worker instead of the main process.
 */
export interface SSRIsolationOptions {
  /** Temp file path for the page component module */
  pageModulePath: string;
  /** Ordered layout module temp paths (innermost to outermost) */
  layoutModulePaths: string[];
  /** Page component props */
  pageProps: Record<string, unknown>;
  /** Layout props (one entry per layout, matching layoutModulePaths order) */
  layoutProps: Record<string, unknown>[];
  /** Project directory for worker scoping */
  projectDir: string;
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
    isolationOptions?: SSRIsolationOptions,
  ): Promise<SSRRenderingResult> {
    // Isolated SSR path: render in per-project Worker
    if (
      isSSRIsolationEnabled() &&
      isolationOptions?.pageModulePath &&
      isolationOptions?.projectDir
    ) {
      // NOTE: the app-router error.tsx catch below is scoped to the main-process
      // render path. Under SSR isolation (per-project Worker) a page throw is not
      // yet routed to error.tsx — a follow-up, isolation being off by default.
      return this.performIsolatedSSR(generationContext, options, isolationOptions);
    }

    // Default path: render in main process
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
      const rendered = await runWithHeadCollector(() =>
        withSpan(
          SpanNames.SSR_ORCHESTRATOR_RENDER,
          () =>
            this.config.ssrRenderer.renderToHTML(validatedElement, {
              mode: this.config.mode,
              wantsStream,
              debugMode: this.config.debugMode,
              dependencyPinningCacheKey: options?.dependencyPinningCacheKey,
              dependencyPinningDependencies: options?.dependencyPinningDependencies,
            }),
          {
            "ssr.wants_stream": wantsStream,
            "ssr.mode": this.config.mode,
          },
        )
      );
      renderResult = rendered.result;
      collectedHead = rendered.head;
    } catch (renderError) {
      // A thrown notFound()/redirect() control result is NOT a render error —
      // let it propagate to the SSR error handler (→ 404 / redirect).
      if (isThrownControlResult(renderError)) throw renderError;

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
      )
      : errorInfo.element;

    const rendered = await runWithHeadCollector(() =>
      this.config.ssrRenderer.renderToHTML(fallbackElement as React.ReactElement, {
        mode: this.config.mode,
        wantsStream: false,
        debugMode: this.config.debugMode,
        dependencyPinningCacheKey: renderOptions?.dependencyPinningCacheKey,
        dependencyPinningDependencies: renderOptions?.dependencyPinningDependencies,
      })
    );
    logger.debug("Rendered app-router error.tsx for a page throw", {
      errorPath: errorInfo.path,
      error: err.message,
    });
    return { result: rendered.result, head: rendered.head, errorPath: errorInfo.path };
  }

  /**
   * Perform SSR rendering in an isolated per-project Worker.
   *
   * The Worker imports user modules from their temp file paths,
   * constructs the React element tree, and renders to HTML.
   * For streaming, the Worker sends chunks via postMessage.
   */
  private async performIsolatedSSR(
    generationContext: Omit<HTMLGenerationContext, "html" | "ssrHash">,
    options: RenderOptions | undefined,
    isolation: SSRIsolationOptions,
  ): Promise<SSRRenderingResult> {
    const wantsStream = options?.delivery === "stream";
    const pool = getWorkerPool();
    const requestId = crypto.randomUUID();

    return withSpan(
      "ssr.isolated_render",
      async () => {
        const worker = pool.getOrCreateWorker(isolation.projectDir, [isolation.projectDir]);

        if (wantsStream) {
          // Streaming mode: get a ReadableStream of chunks from the Worker
          const stream = worker.executeStream({
            type: "render-ssr",
            id: requestId,
            pageModulePath: isolation.pageModulePath,
            layoutModulePaths: isolation.layoutModulePaths,
            pageProps: isolation.pageProps,
            layoutProps: isolation.layoutProps,
            delivery: "stream",
            sourceIntegrationPolicy: requireActiveSourceIntegrationPolicy(),
          });

          const ssrHash = `stream-isolated-${Date.now()}`;

          // Generate HTML stream using the framework's HTML generator
          const finalStream = await this.config.htmlGenerator.generateHTMLStream(stream, {
            ...generationContext,
            ssrHash,
            options: { ...generationContext.options, ...options },
            collectedHead: undefined,
          });

          return { fullHtml: "", finalStream, ssrHash };
        }

        // String mode: render to HTML in Worker, get result back
        const workerResponse: WorkerResponse = await worker.execute({
          type: "render-ssr",
          id: requestId,
          pageModulePath: isolation.pageModulePath,
          layoutModulePaths: isolation.layoutModulePaths,
          pageProps: isolation.pageProps,
          layoutProps: isolation.layoutProps,
          delivery: "string",
          sourceIntegrationPolicy: requireActiveSourceIntegrationPolicy(),
        });

        if (workerResponse.type === "error") {
          const err = new Error(workerResponse.error.message);
          err.name = workerResponse.error.name;
          throw err;
        }

        if (workerResponse.type !== "ssr-result") {
          throw new Error(`Unexpected worker response type: ${workerResponse.type}`);
        }

        const html = workerResponse.html;
        const ssrHash = await computeHash(html);

        const fullHtml = await this.config.htmlGenerator.generateFullHTML({
          ...generationContext,
          html,
          ssrHash,
          options: { ...generationContext.options, ...options },
          collectedHead: undefined,
        });

        return { fullHtml, finalStream: null, ssrHash };
      },
      {
        "ssr.isolated": true,
        "ssr.wants_stream": wantsStream,
        "ssr.project_dir": isolation.projectDir,
      },
    );
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

import { rendererLogger } from "#veryfront/utils";
import type * as React from "react";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { ElementValidator } from "../element-validator/index.ts";
import type { SSRRenderer } from "../ssr-renderer.ts";
import { computeHash } from "../utils/index.ts";
import type { HTMLGenerationContext, HTMLGenerator } from "./html.ts";
import type { RenderOptions } from "./types.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import { getWorkerPool, isSSRIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import type { WorkerResponse } from "#veryfront/security/sandbox/worker-types.ts";

const logger = rendererLogger.component("ssr-orchestrator");

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

/**
 * Options for isolated SSR rendering through the Worker pool.
 * When provided and SSR isolation is enabled, the rendering happens
 * in a per-project Worker instead of the main process.
 */
export interface SSRIsolationOptions {
  /** Temp file path for the page component module */
  pageModulePath: string;
  /** Ordered layout module temp paths (innermost → outermost) */
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

export class SSROrchestrator {
  private config: SSROrchestratorConfig;

  constructor(config: SSROrchestratorConfig) {
    this.config = config;
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
    const { result: renderResult, head: collectedHead } = await runWithHeadCollector(() =>
      withSpan(
        SpanNames.SSR_ORCHESTRATOR_RENDER,
        () =>
          this.config.ssrRenderer.renderToHTML(validatedElement, {
            mode: this.config.mode,
            wantsStream,
            debugMode: this.config.debugMode,
          }),
        {
          "ssr.wants_stream": wantsStream,
          "ssr.mode": this.config.mode,
        },
      )
    );

    const { html, stream } = renderResult;

    const mergedOptions = {
      ...generationContext.options,
      ...options,
      props: {
        ...generationContext.options?.props,
        ...options?.props,
      },
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

      return { fullHtml: html, finalStream, ssrHash };
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

    return {
      fullHtml,
      finalStream: wantsStream ? this.createStream(fullHtml) : null,
      ssrHash,
    };
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

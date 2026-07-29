import { rendererLogger } from "#veryfront/utils";
import type * as React from "react";
import { createError, toError } from "#veryfront/errors";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { ElementValidator } from "../element-validator/index.ts";
import type { SSRRenderer } from "../ssr-renderer.ts";
import { computeHash } from "../utils/index.ts";
import type { HTMLGenerationContext, HTMLGenerator, LinkedStylesheetArtifact } from "./html.ts";
import type { LayoutOrchestrator } from "./layout.ts";
import type { RenderOptions } from "./types.ts";
import { runWithHeadCollector } from "#veryfront/react/head-collector.ts";
import {
  getWorkerPool,
  isSSRIsolationEnabled,
  type WorkerPool,
} from "#veryfront/security/sandbox/worker-pool.ts";
import type { WorkerResponse } from "#veryfront/security/sandbox/worker-types.ts";
import { deserializeWorkerError } from "#veryfront/security/sandbox/worker-error-boundary.ts";
import {
  resolveWorkerGeneration,
  snapshotWorkerGenerationIdentity,
  type WorkerGenerationIdentity,
} from "#veryfront/security/sandbox/worker-generation.ts";
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
  stylesheet?: LinkedStylesheetArtifact;
}

/** @internal Construction seam for isolated-rendering lifecycle tests. */
export interface SSROrchestratorDependencies {
  getWorkerPool?: () => Pick<WorkerPool, "execute" | "executeStream" | "evictWorker">;
  isSSRIsolationEnabled?: () => boolean;
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
  /** Host-owned worker lifetime scope; paired with workerGenerationId. */
  workerScopeId?: string;
  /** Immutable source identity; paired with workerScopeId. */
  workerGenerationId?: string;
}

interface SnapshottedSSRIsolationOptions {
  readonly pageModulePath: string;
  readonly layoutModulePaths: string[];
  readonly pageProps: Record<string, unknown>;
  readonly layoutProps: Record<string, unknown>[];
  readonly projectDir: string;
  readonly generationIdentity?: Readonly<WorkerGenerationIdentity>;
}

function requireIsolationString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`SSR isolation ${label} must be a non-empty string`);
  }
  return value;
}

function validateStructuredRenderData(value: unknown, label: string): void {
  type ValidationFrame =
    | { readonly kind: "visit"; readonly value: unknown }
    | { readonly kind: "leave"; readonly value: object };

  const active = new WeakSet<object>();
  const stack: ValidationFrame[] = [{ kind: "visit", value }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "leave") {
      active.delete(frame.value);
      continue;
    }

    const current = frame.value;
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      continue;
    }
    if (typeof current === "number" && Number.isFinite(current)) continue;
    if (typeof current !== "object") {
      throw new TypeError(
        `SSR isolation ${label} must contain only finite JSON-compatible data`,
      );
    }
    if (active.has(current)) {
      throw new TypeError(`SSR isolation ${label} must not contain circular references`);
    }

    active.add(current);
    stack.push({ kind: "leave", value: current });
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        if (!(index in current)) {
          throw new TypeError(`SSR isolation ${label} must not contain sparse arrays`);
        }
        stack.push({ kind: "visit", value: current[index] });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`SSR isolation ${label} must contain only plain data records`);
    }
    const record = current as Record<string, unknown>;
    const keys = Object.keys(record);
    for (let index = keys.length - 1; index >= 0; index--) {
      stack.push({ kind: "visit", value: record[keys[index]!] });
    }
  }
}

function cloneStructuredRenderData(value: unknown, label: string): unknown {
  let snapshot: unknown;
  try {
    snapshot = structuredClone(value);
  } catch (cause) {
    throw new TypeError(`SSR isolation ${label} must be structured-cloneable`, { cause });
  }
  validateStructuredRenderData(snapshot, label);
  return snapshot;
}

function snapshotStringArray(value: unknown, label: string): string[] {
  const snapshot = cloneStructuredRenderData(value, label);
  if (!Array.isArray(snapshot)) {
    throw new TypeError(`SSR isolation ${label} must be an array`);
  }
  return snapshot.map((entry, index) => requireIsolationString(entry, `${label}[${index}]`));
}

function snapshotDataRecord(value: unknown, label: string): Record<string, unknown> {
  const snapshot = cloneStructuredRenderData(value, label);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError(`SSR isolation ${label} must be a data record`);
  }
  return snapshot as Record<string, unknown>;
}

function snapshotLayoutProps(value: unknown): Record<string, unknown>[] {
  const snapshot = cloneStructuredRenderData(value, "layoutProps");
  if (!Array.isArray(snapshot)) {
    throw new TypeError("SSR isolation layoutProps must be an array");
  }
  for (let index = 0; index < snapshot.length; index++) {
    const entry = snapshot[index];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`SSR isolation layoutProps[${index}] must be a data record`);
    }
  }
  return snapshot as Record<string, unknown>[];
}

/**
 * Detach an isolated-render request synchronously at the ingress boundary.
 *
 * Worker generation resolution hashes asynchronously. No caller-owned object
 * may remain reachable across that await or eligibility could be decided from
 * one source tree while a different tree is executed.
 */
function snapshotSSRIsolationOptions(
  value: SSRIsolationOptions,
): Readonly<SnapshottedSSRIsolationOptions> {
  if (value === null || typeof value !== "object") {
    throw new TypeError("SSR isolation options must be an object");
  }

  // Snapshot each field immediately after its single read. Later accessors
  // cannot mutate a previously detached field.
  const projectDir = requireIsolationString(value.projectDir, "projectDir");
  const pageModulePath = requireIsolationString(value.pageModulePath, "pageModulePath");
  const layoutModulePaths = snapshotStringArray(
    value.layoutModulePaths,
    "layoutModulePaths",
  );
  const pageProps = snapshotDataRecord(value.pageProps, "pageProps");
  const layoutProps = snapshotLayoutProps(value.layoutProps);
  if (layoutProps.length !== layoutModulePaths.length) {
    throw new TypeError(
      "SSR isolation layoutProps must have one entry per layoutModulePath",
    );
  }
  const generationIdentity = snapshotWorkerGenerationIdentity(
    value.workerScopeId,
    value.workerGenerationId,
  );

  return Object.freeze({
    projectDir,
    pageModulePath,
    layoutModulePaths,
    pageProps,
    layoutProps,
    generationIdentity,
  });
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
  private readonly config: SSROrchestratorConfig;
  private readonly resolveWorkerPool: () => Pick<
    WorkerPool,
    "execute" | "executeStream" | "evictWorker"
  >;
  private readonly isolationEnabled: () => boolean;

  constructor(
    config: SSROrchestratorConfig,
    dependencies: SSROrchestratorDependencies = {},
  ) {
    this.config = config;
    this.resolveWorkerPool = dependencies.getWorkerPool ?? getWorkerPool;
    this.isolationEnabled = dependencies.isSSRIsolationEnabled ?? isSSRIsolationEnabled;
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
    if (this.isolationEnabled() && isolationOptions !== undefined) {
      const isolation = snapshotSSRIsolationOptions(isolationOptions);
      // NOTE: the app-router error.tsx catch below is scoped to the main-process
      // render path. Under SSR isolation (per-project Worker) a page throw is not
      // yet routed to error.tsx — a follow-up, isolation being off by default.
      return this.performIsolatedSSR(generationContext, options, isolation);
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

      const generated = await this.config.htmlGenerator.generateHTMLStreamWithStylesheetArtifact(
        stream,
        {
          ...generationContext,
          ssrHash,
          options: mergedOptions,
          collectedHead,
        },
      );

      return {
        fullHtml: html,
        finalStream: attachAllReady(generated.stream, stream),
        ssrHash,
        stylesheet: generated.stylesheet,
      };
    }

    const ssrHash = await withSpan(SpanNames.SSR_CONTENT_HASH, () => computeHash(html), {
      "ssr.html_length": html.length,
    });

    const generated = await withSpan(
      SpanNames.SSR_HTML_GENERATE,
      () =>
        this.config.htmlGenerator.generateFullHTMLWithStylesheetArtifact({
          ...generationContext,
          html,
          ssrHash,
          options: mergedOptions,
          collectedHead,
        }),
      { "ssr.hash": ssrHash },
    );
    const fullHtml = generated.html;

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
      stylesheet: generated.stylesheet,
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
    let fallbackElement = errorInfo.element;
    if (this.config.layoutOrchestrator) {
      const requestIdentity = generationContext.layoutRequestIdentity;
      if (!requestIdentity) {
        throw new Error(
          "Cannot render an app-router error boundary without the preloaded layout request identity",
          { cause: renderError },
        );
      }
      fallbackElement = await this.config.layoutOrchestrator.applyLayoutsAndWrappers(
        errorInfo.element as React.ReactElement,
        generationContext.pageInfo,
        generationContext.layoutBundle,
        generationContext.nestedLayouts,
        requestIdentity,
        generationContext.layoutDataMap,
        renderOptions?.url,
        renderOptions?.params,
        mergedFrontmatter,
        generationContext.pageBundle?.headings,
        renderOptions?.clientPageIsland,
        renderOptions?.props,
      );
    }

    const rendered = await runWithHeadCollector(() =>
      this.config.ssrRenderer.renderToHTML(fallbackElement as React.ReactElement, {
        mode: this.config.mode,
        wantsStream: false,
        debugMode: this.config.debugMode,
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
    isolation: Readonly<SnapshottedSSRIsolationOptions>,
  ): Promise<SSRRenderingResult> {
    const wantsStream = options?.delivery === "stream";
    const pool = this.resolveWorkerPool();
    const requestId = crypto.randomUUID();
    const generation = await resolveWorkerGeneration(
      "ssr",
      isolation.generationIdentity,
    );

    return withSpan(
      "ssr.isolated_render",
      async () => {
        if (wantsStream) {
          // Admission and stream execution are one pool lifecycle operation, so
          // capacity eviction cannot land between acquiring and starting work.
          let stream: ReadableStream<Uint8Array>;
          try {
            stream = pool.executeStream(
              generation.workerId,
              [isolation.projectDir],
              {
                type: "render-ssr",
                id: requestId,
                pageModulePath: isolation.pageModulePath,
                layoutModulePaths: isolation.layoutModulePaths,
                pageProps: isolation.pageProps,
                layoutProps: isolation.layoutProps,
                delivery: "stream",
                sourceIntegrationPolicy: requireActiveSourceIntegrationPolicy(),
              },
            );
          } finally {
            // Retirement is deferred by WorkerPool until the active stream
            // finishes, while preventing a later request from reusing an
            // unversioned module graph.
            if (!generation.reusable) {
              pool.evictWorker(generation.workerId);
            }
          }

          const ssrHash = `stream-isolated-${Date.now()}`;

          // Generate HTML stream using the framework's HTML generator
          const generated = await this.config.htmlGenerator
            .generateHTMLStreamWithStylesheetArtifact(
              stream,
              {
                ...generationContext,
                ssrHash,
                options: { ...generationContext.options, ...options },
                collectedHead: undefined,
              },
            );

          return {
            fullHtml: "",
            finalStream: generated.stream,
            ssrHash,
            stylesheet: generated.stylesheet,
          };
        }

        // String mode: render to HTML in Worker, get result back
        let workerResponse: WorkerResponse;
        try {
          workerResponse = await pool.execute(
            generation.workerId,
            [isolation.projectDir],
            {
              type: "render-ssr",
              id: requestId,
              pageModulePath: isolation.pageModulePath,
              layoutModulePaths: isolation.layoutModulePaths,
              pageProps: isolation.pageProps,
              layoutProps: isolation.layoutProps,
              delivery: "string",
              sourceIntegrationPolicy: requireActiveSourceIntegrationPolicy(),
            },
          );
        } finally {
          if (!generation.reusable) {
            pool.evictWorker(generation.workerId);
          }
        }

        if (workerResponse.type === "error") {
          throw deserializeWorkerError(workerResponse.error);
        }

        if (workerResponse.type !== "ssr-result") {
          throw new Error(`Unexpected worker response type: ${workerResponse.type}`);
        }

        const html = workerResponse.html;
        const ssrHash = await computeHash(html);

        const generated = await this.config.htmlGenerator
          .generateFullHTMLWithStylesheetArtifact({
            ...generationContext,
            html,
            ssrHash,
            options: { ...generationContext.options, ...options },
            collectedHead: undefined,
          });

        return {
          fullHtml: generated.html,
          finalStream: null,
          ssrHash,
          stylesheet: generated.stylesheet,
        };
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

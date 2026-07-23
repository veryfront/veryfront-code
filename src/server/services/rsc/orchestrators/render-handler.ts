import type * as React from "react";
import { serverLogger } from "#veryfront/utils";
import { RSCProductionOptimizer } from "#veryfront/rendering/rsc/production-optimizer.ts";
import type { RSCRenderer } from "#veryfront/rendering/rsc/server-renderer/index.ts";
import type { RSCPayload } from "#veryfront/rendering/rsc/types.ts";
import {
  COMPONENT_ERROR,
  createError,
  createErrorResponse,
  getErrorMessage,
  PAGE_NOT_FOUND,
  RENDER_ERROR,
  toError,
  wrapUnknownError,
} from "#veryfront/errors";
import { extractParams, resolveComponentPath } from "./component-resolver.ts";
import type { RenderProps } from "./types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { loadModuleFromSource } from "#veryfront/modules/react-loader/index.ts";
import { compileContent, extractFrontmatter } from "#veryfront/transforms/mdx/compiler/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";

interface RenderHandlerModuleOptions {
  adapter?: RuntimeAdapter;
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
  reactVersion?: Promise<string>;
}

const logger = serverLogger.component("rsc");
const fs = createFileSystem();

function isContentComponent(componentPath: string): boolean {
  return /\.(?:md|mdx)$/i.test(componentPath);
}

export class RenderHandler {
  constructor(
    private projectDir: string,
    private getRenderer: () => RSCRenderer | null,
    private mode: "development" | "production" = "production",
    private appDir: string = "app",
    private moduleOptions: RenderHandlerModuleOptions = {},
  ) {}

  async handle(
    pathname: string,
    searchParams: URLSearchParams,
    request?: Request,
  ): Promise<Response> {
    try {
      const component = await this.loadComponent(pathname);
      const props = this.buildProps(pathname, searchParams);
      const payload = await this.renderPayload(component, props);
      return this.createResponse(payload, request);
    } catch (error) {
      return this.createErrorResponse(error);
    }
  }

  private async loadComponent(pathname: string): Promise<React.ComponentType<RenderProps>> {
    const componentPath = await resolveComponentPath(
      pathname,
      this.projectDir,
      this.moduleOptions.adapter?.fs,
      this.appDir,
    );
    if (!componentPath) {
      throw toError(
        createError({
          type: "render",
          message: "Component not found",
        }),
      );
    }

    const module = await this.loadComponentModule(componentPath);
    const Component = (module.default ?? module.Page ?? module) as unknown;

    if (typeof Component !== "function") {
      throw toError(
        createError({
          type: "config",
          message: "Invalid component",
        }),
      );
    }

    return Component as React.ComponentType<RenderProps>;
  }

  private async loadComponentModule(componentPath: string): Promise<Record<string, unknown>> {
    const adapter = this.moduleOptions.adapter;

    if (isContentComponent(componentPath)) {
      const source = adapter
        ? await adapter.fs.readFile(componentPath)
        : await fs.readTextFile(componentPath);
      const { body, frontmatter } = extractFrontmatter(source);
      const compiled = await compileContent(
        this.mode,
        this.projectDir,
        body,
        frontmatter,
        componentPath,
        "server",
      );

      return await mdxRenderer.loadModuleESM(
        compiled.compiledCode,
        adapter,
        this.moduleOptions.projectId ?? this.projectDir,
        this.projectDir,
        this.moduleOptions.projectSlug,
        this.moduleOptions.contentSourceId,
        await this.moduleOptions.reactVersion,
      ) as Record<string, unknown>;
    }

    if (!adapter) {
      return (await import(componentPath)) as Record<string, unknown>;
    }

    const source = await adapter.fs.readFile(componentPath);
    return await loadModuleFromSource(source, componentPath, this.projectDir, adapter, {
      projectId: this.moduleOptions.projectId ?? this.projectDir,
      projectSlug: this.moduleOptions.projectSlug,
      contentSourceId: this.moduleOptions.contentSourceId,
      dev: this.mode === "development",
      mode: this.mode === "development" ? "preview" : "production",
      reactVersion: await this.moduleOptions.reactVersion,
    });
  }

  private buildProps(pathname: string, searchParams: URLSearchParams): RenderProps {
    return {
      params: extractParams(pathname),
      searchParams: Object.fromEntries(searchParams),
    };
  }

  private async renderPayload(
    component: React.ComponentType<RenderProps>,
    props: RenderProps,
  ): Promise<RSCPayload> {
    const renderer = this.getRenderer();
    if (!renderer) {
      throw toError(
        createError({
          type: "render",
          message: "Renderer not initialized",
        }),
      );
    }

    const payload = await renderer.renderToPayload(component, props);
    if (!payload) {
      throw toError(
        createError({
          type: "render",
          message: "Failed to render RSC payload",
        }),
      );
    }

    return this.mode === "development" ? payload : RSCProductionOptimizer.optimizePayload(payload);
  }

  private createResponse(payload: RSCPayload, request?: Request): Response {
    const etag = RSCProductionOptimizer.generateETag(payload);

    if (request && this.shouldReturn304(request, etag)) {
      return new Response(null, { status: 304 });
    }

    return new Response(JSON.stringify(payload), {
      headers: this.buildHeaders(etag),
    });
  }

  private shouldReturn304(request: Request, etag: string): boolean {
    return RSCProductionOptimizer.checkETag(request.headers.get("if-none-match"), etag);
  }

  private buildHeaders(etag: string): Record<string, string> {
    const isProd = this.mode === "production";

    const headers: Record<string, string> = {
      "content-type": "application/json",
      etag,
      ...RSCProductionOptimizer.getCacheHeaders({
        isStatic: false,
        maxAge: isProd ? 60 : 0,
      }),
    };

    if (isProd) {
      headers["content-security-policy"] = RSCProductionOptimizer.generateCSP();
    }

    return headers;
  }

  private createErrorResponse(error: unknown): Response {
    logger.error("RSC render failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

    const message = getErrorMessage(error);
    let vfError;

    // Map specific error messages to appropriate error types
    if (message === "Component not found") {
      vfError = PAGE_NOT_FOUND.create({
        detail: "The requested component could not be found",
      });
    } else if (message === "Invalid component") {
      vfError = COMPONENT_ERROR.create({
        detail: "Component module must export a valid React component",
      });
    } else if (
      message === "Renderer not initialized" || message === "Failed to render RSC payload"
    ) {
      vfError = RENDER_ERROR.create({
        detail: message,
        cause: error instanceof Error ? error : undefined,
      });
    } else {
      // Wrap unknown errors in RFC 9457 format
      vfError = wrapUnknownError(error);
    }

    return createErrorResponse(vfError);
  }
}

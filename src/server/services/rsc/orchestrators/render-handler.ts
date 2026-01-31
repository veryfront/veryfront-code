import type * as React from "react";
import { serverLogger as logger } from "#veryfront/utils";
import { RSCProductionOptimizer } from "#veryfront/rendering/rsc/production-optimizer.ts";
import type { RSCRenderer } from "#veryfront/rendering/rsc/server-renderer/index.ts";
import type { RSCPayload } from "#veryfront/rendering/rsc/types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { extractParams, resolveComponentPath } from "./component-resolver.ts";
import type { RenderProps } from "./types.ts";

export class RenderHandler {
  constructor(
    private projectDir: string,
    private getRenderer: () => RSCRenderer | null,
    private isLocalDev: boolean = false,
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

  private async loadComponent(pathname: string): Promise<React.ComponentType<any>> {
    const componentPath = await resolveComponentPath(pathname, this.projectDir);
    if (!componentPath) {
      throw toError(
        createError({
          type: "render",
          message: "Component not found",
        }),
      );
    }

    const module = (await import(componentPath)) as Record<string, unknown>;
    const Component = (module.default ?? module.Page ?? module) as unknown;

    if (typeof Component !== "function") {
      throw toError(
        createError({
          type: "config",
          message: "Invalid component",
        }),
      );
    }

    return Component as React.ComponentType<any>;
  }

  private buildProps(pathname: string, searchParams: URLSearchParams): RenderProps {
    return {
      params: extractParams(pathname),
      searchParams: Object.fromEntries(searchParams),
    };
  }

  private async renderPayload(
    component: React.ComponentType<any>,
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

    return this.isLocalDev ? payload : RSCProductionOptimizer.optimizePayload(payload);
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
    const isProd = !this.isLocalDev;

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
    logger.error("[RSC] Render error:", error);

    const normalizedError = error instanceof Error ? error : new Error(String(error));

    return new Response(
      JSON.stringify({
        error: "Render error",
        message: normalizedError.message,
        stack: this.isLocalDev ? normalizedError.stack : undefined,
      }),
      {
        status: normalizedError.message === "Component not found" ? 404 : 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

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
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import {
  getProjectReact,
  getReactDOMServer,
  type ReactServerRuntime,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import { loadModuleFromSource } from "#veryfront/modules/react-loader/index.ts";
import { compileContent, extractFrontmatter } from "#veryfront/transforms/mdx/compiler/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import {
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { RSC_DEPENDENCY_PINNING_HEADER } from "#veryfront/rendering/rsc/constants.ts";

export interface RenderHandlerModuleOptions {
  adapter?: RuntimeAdapter;
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
  serverExternalPackages?: readonly string[];
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Server-trusted local-project identity for dev-only module-server fallback. */
  isLocalProject?: boolean;
  reactVersion?: (snapshot: DependencyPinningSnapshot) => Promise<string>;
  runtimeAdapter?: () => Promise<RuntimeAdapter>;
  moduleLoader?: typeof loadModuleFromSource;
}

const logger = serverLogger.component("rsc");

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
      const adapter = this.moduleOptions.adapter ??
        await (this.moduleOptions.runtimeAdapter ?? (async () => {
          const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
          return await runtime.get();
        }))();
      const requestedPinKey = request?.headers.get(RSC_DEPENDENCY_PINNING_HEADER) ?? undefined;
      const dependencySnapshot = await resolveRequestedDependencyPinningSnapshot(
        this.moduleOptions.dependencyPinningSource ?? this.projectDir,
        requestedPinKey,
      );
      if (!dependencySnapshot) {
        throw new Error(`Unknown dependency pinning snapshot: ${requestedPinKey}`);
      }
      const reactVersion = await this.moduleOptions.reactVersion?.(dependencySnapshot);
      const moduleServerOrigin = dependencySnapshot.cacheKey.startsWith("on:") && request
        ? new URL(request.url).origin
        : undefined;
      const component = await this.loadComponent(
        pathname,
        adapter,
        dependencySnapshot,
        reactVersion,
        moduleServerOrigin,
      );
      const props = this.buildProps(pathname, searchParams);
      const reactRuntime = getRuntimeModuleLoader(adapter)
        ? {
          react: await getProjectReact(reactVersion, adapter),
          server: await getReactDOMServer(reactVersion, adapter),
        }
        : undefined;
      const renderedPayload = await this.renderPayload(
        component,
        props,
        reactVersion,
        reactRuntime,
      );
      const payload = dependencySnapshot.cacheKey === "off" ? renderedPayload : {
        ...renderedPayload,
        dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      };
      return this.createResponse(payload, request);
    } catch (error) {
      return this.createErrorResponse(error);
    }
  }

  private async loadComponent(
    pathname: string,
    adapter: RuntimeAdapter,
    dependencySnapshot: DependencyPinningSnapshot,
    reactVersion?: string,
    moduleServerOrigin?: string,
  ): Promise<React.ComponentType<RenderProps>> {
    const componentPath = await resolveComponentPath(
      pathname,
      this.projectDir,
      adapter.fs,
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

    const module = await this.loadComponentModule(
      componentPath,
      adapter,
      dependencySnapshot,
      reactVersion,
      moduleServerOrigin,
    );
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

  private async loadComponentModule(
    componentPath: string,
    adapter: RuntimeAdapter,
    dependencySnapshot: DependencyPinningSnapshot,
    reactVersion?: string,
    moduleServerOrigin?: string,
  ): Promise<Record<string, unknown>> {
    const prepared = getRuntimeModuleLoader(adapter);
    if (prepared) return await prepared.importModule({ kind: "source", path: componentPath });

    if (isContentComponent(componentPath)) {
      const source = await adapter.fs.readFile(componentPath);
      const { body, frontmatter } = extractFrontmatter(source);
      const compiled = await compileContent(
        this.mode,
        this.projectDir,
        body,
        frontmatter,
        componentPath,
        "server",
      );

      return await mdxRenderer.loadModuleESM(compiled.compiledCode, {
        adapter,
        sourcePath: componentPath,
        projectId: this.moduleOptions.projectId ?? this.projectDir,
        projectDir: this.projectDir,
        projectSlug: this.moduleOptions.projectSlug,
        contentSourceId: this.moduleOptions.contentSourceId,
        mode: this.mode,
        reactVersion,
        serverExternalPackages: this.moduleOptions.serverExternalPackages,
        dependencyPinningCacheKey: dependencySnapshot.cacheKey,
        dependencyPinningDependencies: dependencySnapshot.dependencies,
        dependencyPinningSource: this.moduleOptions.dependencyPinningSource,
        moduleServerOrigin,
        isLocalProject: this.moduleOptions.isLocalProject === true,
      }) as Record<string, unknown>;
    }

    const source = await adapter.fs.readFile(componentPath);
    const moduleLoader = this.moduleOptions.moduleLoader ?? loadModuleFromSource;
    return await moduleLoader(source, componentPath, this.projectDir, adapter, {
      projectId: this.moduleOptions.projectId ?? this.projectDir,
      projectSlug: this.moduleOptions.projectSlug,
      contentSourceId: this.moduleOptions.contentSourceId,
      dev: this.mode === "development",
      mode: this.mode === "development" ? "preview" : "production",
      reactVersion,
      serverExternalPackages: this.moduleOptions.serverExternalPackages,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      dependencyPinningDependencies: dependencySnapshot.dependencies,
      dependencyPinningSource: this.moduleOptions.dependencyPinningSource,
      moduleServerOrigin,
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
    reactVersion?: string,
    reactRuntime?: ReactServerRuntime,
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

    const payload = await renderer.renderToPayload(component, props, {
      reactVersion,
      reactRuntime,
    });
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
      return new Response(null, { status: 304, headers: this.buildHeaders(etag) });
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
      vary: RSC_DEPENDENCY_PINNING_HEADER,
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
    logger.error("Render error:", error);

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

    const response = createErrorResponse(vfError);
    const varyValues = (response.headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      !varyValues.includes("*") &&
      !varyValues.some((value) =>
        value.toLowerCase() === RSC_DEPENDENCY_PINNING_HEADER.toLowerCase()
      )
    ) {
      varyValues.push(RSC_DEPENDENCY_PINNING_HEADER);
      response.headers.set("vary", varyValues.join(", "));
    }
    return response;
  }
}

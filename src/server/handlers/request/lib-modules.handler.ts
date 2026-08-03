import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { createSecureFs } from "#veryfront/security";
import { computeEtag, hasMatchingEtag } from "../utils/etag.ts";
import {
  HTTP_METHOD_NOT_ALLOWED,
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_LIB_MODULES,
} from "#veryfront/utils/constants/index.ts";
import type { DependencyPinningSnapshot } from "#veryfront/transforms/esm/package-registry.ts";
import {
  isDependencyPinningEnabled,
  isExactSemver,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import {
  readSnapshotQuery,
  resolveSnapshotForRequest,
  snapshotConflictResponse,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";

export const LIB_MODULE_PATHS = {
  "chat.js": "esm/src/chat/index.js",
  "markdown.js": "esm/src/markdown/index.js",
  "mdx.js": "esm/src/mdx/index.js",
  "workflow.js": "esm/src/workflow/react/index.js",
} as const;

const ALLOWED_MODULES = new Set(Object.keys(LIB_MODULE_PATHS));
const LIB_PREFIX = "/_veryfront/lib/";

function authoritativeVeryfrontVersion(
  snapshot: DependencyPinningSnapshot,
): string | undefined {
  const configured = snapshot.configuredVersions?.veryfront;
  const declaration = configured?.declaration ??
    snapshot.dependencies?.veryfront;
  const effective = configured?.effective ?? declaration;
  if (
    declaration === undefined ||
    effective === undefined ||
    !isExactSemver(declaration) ||
    !isExactSemver(effective)
  ) {
    return undefined;
  }
  return effective.replace(/^v/, "");
}

async function readInstalledVeryfrontVersion(
  ctx: HandlerContext,
): Promise<string | undefined> {
  const packageJsonPath = joinPath(
    joinPath(ctx.projectDir, "node_modules"),
    "veryfront/package.json",
  );
  let raw: string;
  try {
    raw = await ctx.adapter.fs.readFile(packageJsonPath);
  } catch (error) {
    if (!isCanonicalNotFoundError(error)) throw error;
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const version = (parsed as Record<string, unknown>).version;
  return typeof version === "string" && isExactSemver(version)
    ? version.replace(/^v/, "")
    : undefined;
}

export class LibModulesHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "LibModulesHandler",
    priority: PRIORITY_MEDIUM_LIB_MODULES as HandlerPriority,
    // Method-agnostic ownership is intentional: unsupported methods on this
    // internal namespace must not fall through to application routing.
    patterns: [{ pattern: /^\/_veryfront\/lib\// }],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    const requestUrl = new URL(req.url);
    const pathname = requestUrl.pathname;
    if (!pathname.startsWith(LIB_PREFIX)) return this.continue();

    if (method !== "GET" && method !== "HEAD") {
      return this.respond(
        new Response("Method not allowed", {
          status: HTTP_METHOD_NOT_ALLOWED,
          headers: {
            "Allow": "GET, HEAD",
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          },
        }),
      );
    }

    const moduleResolution = ctx.config?.client?.moduleResolution ?? "cdn";
    if (moduleResolution !== "self-hosted") {
      this.logDebug(
        "LibModulesHandler: self-hosted mode not enabled, skipping",
        { moduleResolution },
        ctx,
      );
      return this.continue();
    }

    const modulePath = pathname.slice(LIB_PREFIX.length);
    if (!ALLOWED_MODULES.has(modulePath)) {
      this.logDebug(
        `LibModulesHandler: module not allowed: ${modulePath}`,
        { allowed: Array.from(ALLOWED_MODULES) },
        ctx,
      );
      return this.respondNotFound(req, ctx, method);
    }

    if (isDependencyPinningEnabled()) {
      const source = createHandlerDependencyPinningSource(ctx);
      const resolution = await resolveSnapshotForRequest(
        source,
        readSnapshotQuery(requestUrl),
      );
      if (resolution.kind === "conflict") {
        return this.respondDependencyConflict(req, ctx);
      }

      const authoritativeVersion = authoritativeVeryfrontVersion(resolution.snapshot);
      const installedVersion = await readInstalledVeryfrontVersion(ctx);
      if (
        authoritativeVersion === undefined ||
        installedVersion === undefined ||
        installedVersion !== authoritativeVersion
      ) {
        return this.respondDependencyConflict(req, ctx);
      }
    }

    const filePath = this.resolveModulePath(modulePath, ctx.projectDir);
    if (!filePath) return this.continue();

    const secureFs = createSecureFs({
      baseDir: ctx.projectDir,
      adapter: ctx.adapter,
      context: "internal",
      validationOptions: {
        allowedDirs: ["node_modules"],
        allowAbsolute: true,
      },
    });

    let content: string;
    try {
      content = await secureFs.readFile(filePath);
    } catch (error) {
      if (!isCanonicalNotFoundError(error)) throw error;
      this.logDebug(`LibModulesHandler: module not found: ${modulePath}`, { filePath }, ctx);
      return this.respondNotFound(req, ctx, method);
    }

    const etag = computeEtag(content);

    const builder = this.createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);

    if (hasMatchingEtag(req, etag)) {
      return this.respond(
        builder.withSecurity(ctx.securityConfig ?? undefined, req).notModified(etag),
      );
    }

    const isDev = !!ctx.isLocalProject;
    const body = method === "HEAD" ? null : content;

    this.logDebug(
      `LibModulesHandler: served ${modulePath}`,
      { size: content.length, filePath },
      ctx,
    );

    return this.respond(
      builder
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache(isDev ? "no-cache" : "immutable")
        .withETag(etag)
        .withContentType("application/javascript; charset=utf-8", body, HTTP_OK),
    );
  }

  private respondNotFound(req: Request, ctx: HandlerContext, method: string): HandlerResult {
    const builder = this.createResponseBuilder(ctx);
    return this.respond(
      builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withCache("no-cache")
        .withContentType(
          "text/plain; charset=utf-8",
          method === "HEAD" ? null : "Module not found",
          HTTP_NOT_FOUND,
        ),
    );
  }

  private respondDependencyConflict(
    req: Request,
    ctx: HandlerContext,
  ): HandlerResult {
    return this.respond(
      snapshotConflictResponse(
        this.createResponseBuilder(ctx),
        req,
        ctx.securityConfig,
      ),
    );
  }

  private resolveModulePath(module: string, projectDir: string): string | null {
    const relativePath = LIB_MODULE_PATHS[module as keyof typeof LIB_MODULE_PATHS];
    if (!relativePath) return null;

    const packageDir = joinPath(joinPath(projectDir, "node_modules"), "veryfront");
    return normalizePath(joinPath(packageDir, relativePath)) ?? null;
  }
}

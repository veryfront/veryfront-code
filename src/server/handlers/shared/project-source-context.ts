import { runWithCacheBatching } from "#veryfront/cache/request-cache-batcher.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { HandlerContext } from "../types.ts";

/** The request cannot safely select its remote project source. */
export class ProjectSourceContextUnavailableError extends Error {
  constructor() {
    super("Project source context is unavailable");
    this.name = "ProjectSourceContextUnavailableError";
  }
}

interface ProjectSourceContextOptions {
  /** Override the request-derived production mode for preview-only surfaces. */
  productionMode?: boolean;
}

/**
 * Run a project-source operation without mutating a shared contextual adapter.
 * Multi-project adapters require the request credential and provide the only
 * supported scoped context boundary. Other adapters are already request-bound.
 */
export function runWithProjectSourceContext<T>(
  ctx: HandlerContext,
  fn: () => Promise<T>,
  options: ProjectSourceContextOptions = {},
): Promise<T> {
  const fs = ctx.adapter.fs;
  const isExtended = isExtendedFSAdapter(fs);

  if (ctx.projectSlug && isExtended && fs.isMultiProjectMode()) {
    if (!ctx.proxyToken) throw new ProjectSourceContextUnavailableError();
    const productionMode = options.productionMode ??
      (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
    const branch = ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null;
    const sourceOptions = {
      productionMode,
      ...(productionMode ? { releaseId: ctx.releaseId ?? null } : {}),
      branch,
      environmentName: ctx.environmentName ?? null,
    };

    return fs.runWithContext(
      ctx.projectSlug,
      ctx.proxyToken,
      fn,
      ctx.projectId,
      sourceOptions,
    );
  }

  if (ctx.isLocalProject === false && isExtended && fs.isContextualMode()) {
    throw new ProjectSourceContextUnavailableError();
  }

  return ctx.projectSlug ? runWithCacheBatching(fn) : fn();
}

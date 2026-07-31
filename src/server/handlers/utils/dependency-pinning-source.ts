import type { HandlerContext } from "../types.ts";
import {
  createDependencyPinningSource,
  type DependencyPinningSource,
  resolveDependencyWritebackTarget,
} from "#veryfront/transforms/esm/package-registry.ts";

export interface HandlerDependencyPinningIdentity {
  readonly projectId?: string;
  readonly projectSlug?: string;
  readonly contentSourceId?: string;
  readonly releaseId?: string;
  readonly branch?: string | null;
}

/**
 * Resolve the canonical project/content identity shared by document, data,
 * module, and internal asset requests.
 */
export function getHandlerDependencyPinningIdentity(
  ctx: HandlerContext,
): HandlerDependencyPinningIdentity {
  return {
    projectId: ctx.enriched?.projectId ?? ctx.projectId,
    projectSlug: ctx.enriched?.projectSlug ?? ctx.projectSlug ??
      ctx.requestContext?.slug,
    // createDependencyPinningSource owns the release -> branch fallback.
    // Passing either here as a contentSourceId changes the namespace format.
    contentSourceId: ctx.enriched?.contentSourceId,
    releaseId: ctx.enriched?.releaseId ?? ctx.releaseId,
    branch: ctx.enriched?.branch ?? ctx.requestContext?.branch ??
      ctx.parsedDomain?.branch,
  };
}

export function createHandlerDependencyPinningSource(
  ctx: HandlerContext,
): DependencyPinningSource {
  const identity = getHandlerDependencyPinningIdentity(ctx);
  const mode = ctx.resolvedEnvironment ?? ctx.requestContext?.mode;
  const dependencyWritebackTarget = resolveDependencyWritebackTarget({
    environment: mode,
    isLocalProject: ctx.isLocalProject,
    releaseId: identity.releaseId,
    branch: identity.branch,
  });

  return createDependencyPinningSource({
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    isLocalProject: ctx.isLocalProject,
    config: ctx.config,
    ...identity,
    dependencyWritebackTarget,
  });
}

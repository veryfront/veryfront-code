import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import {
  createImportMapIdentity,
  type ImportMapIdentity,
  preloadImportMap,
} from "#veryfront/modules/import-map/index.ts";
import type { HandlerContext } from "../../types.ts";

/**
 * Bind module transforms to the configuration already validated for this
 * request. Hosted requests fail closed if that configuration is missing;
 * standalone/local callers may still use the module server's ambient fallback.
 */
export async function resolveRequestModuleImportMapIdentity(
  ctx: HandlerContext,
): Promise<ImportMapIdentity | undefined> {
  const config = ctx.enriched?.config ?? ctx.config;
  if (!config) {
    if (!ctx.isLocalProject) {
      throw CACHE_INVARIANT_VIOLATION.create({
        detail: "Hosted module transform is missing validated request configuration",
        context: {
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
        },
      });
    }
    return undefined;
  }

  const contentSourceId = ctx.enriched?.contentSourceId ??
    computeContentSourceId(
      !!ctx.isLocalProject,
      ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview",
      ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null,
      ctx.releaseId,
    );
  const importMap = await preloadImportMap(
    ctx.projectDir,
    ctx.adapter,
    ctx.projectId ?? ctx.projectSlug ?? ctx.projectDir,
    {
      contentSourceId,
      config,
    },
  );

  return await createImportMapIdentity(importMap);
}

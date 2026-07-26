import type { HandlerContext } from "../../types.ts";
import { bundleBrowserModule } from "#veryfront/server/shared/browser-module-bundler.ts";
import type {
  DependencyPinningSnapshot,
  DependencyPinningSourceInput,
} from "#veryfront/transforms/esm/package-registry.ts";

export function bundleDevFile(
  absPath: string,
  ctx: HandlerContext,
  dependencySnapshot?: DependencyPinningSnapshot,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
): Promise<string> {
  return bundleBrowserModule(absPath, {
    adapter: ctx.adapter,
    projectDir: ctx.projectDir,
    config: ctx.config,
    projectId: ctx.projectId,
    projectSlug: ctx.projectSlug,
    moduleServerOrigin,
    dependencyPinningCacheKey: dependencySnapshot?.cacheKey,
    dependencyPinningDependencies: dependencySnapshot?.dependencies,
    dependencyPinningSource,
  });
}

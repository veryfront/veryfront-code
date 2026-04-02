import type { HandlerContext } from "../../types.ts";
import { bundleBrowserModule } from "#veryfront/server/shared/browser-module-bundler.ts";

export function bundleDevFile(absPath: string, ctx: HandlerContext): Promise<string> {
  return bundleBrowserModule(absPath, {
    adapter: ctx.adapter,
    projectDir: ctx.projectDir,
    config: ctx.config,
    projectSlug: ctx.projectSlug,
  });
}

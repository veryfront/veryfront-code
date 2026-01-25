import type { FSAdapter, FSAdapterConfig } from "./veryfront/types.ts";
import { createError, toError } from "../../../errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ReloadNotifier } from "../../../server/reload-notifier.ts";
import {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
} from "../../../modules/react-loader/ssr-module-loader/cache/index.ts";
import {
  clearRouterDetectionCache,
  clearRouterDetectionCacheForProject,
} from "../../../rendering/router-detection.ts";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "../../../transforms/mdx/esm-module-loader/cache/index.ts";
import {
  clearSnippetCache,
  clearSnippetCacheForProject,
} from "../../../rendering/snippet-renderer.ts";
import { clearRendererCacheForProject, clearRendererCaches } from "../../../rendering/renderer.ts";
import { invalidateProjectCSS } from "../../../html/styles-builder/tailwind-compiler.ts";
import { clearDomainCache } from "../../../server/utils/domain-lookup.ts";

export function createFSAdapter(config: FSAdapterConfig): Promise<FSAdapter> {
  const type = config.type ?? "local";

  return withSpan(
    "platform.fs.createAdapter",
    async () => {
      if (type === "local") {
        throw toError(
          createError({
            type: "config",
            message: `FSAdapter type "local" should not use this factory. ` +
              `Use RuntimeAdapter.fs directly for local filesystem access. ` +
              `If you're seeing this error, check your veryfront.config.ts fs configuration.`,
          }),
        );
      }

      if (type === "veryfront-api") {
        const configWithCallbacks: FSAdapterConfig = {
          ...config,
          invalidationCallbacks: {
            ...config.invalidationCallbacks,
            clearSSRModuleCache,
            clearRouterDetectionCache,
            clearModulePathCache,
            invalidateModulePaths,
            clearSnippetCache,
            clearRendererCache: clearRendererCaches,
            clearSSRModuleCacheForProject,
            clearRouterDetectionCacheForProject,
            clearSnippetCacheForProject,
            clearRendererCacheForProject,
            clearProjectCSSCache: invalidateProjectCSS,
            clearDomainCache,
            triggerReload: (changedPaths, project) =>
              ReloadNotifier.triggerReload(changedPaths, project),
          },
        };

        if (config.veryfront?.proxyMode) {
          const { MultiProjectFSAdapter } = await import("./veryfront/multi-project-adapter.ts");
          const adapter = new MultiProjectFSAdapter(configWithCallbacks);
          await adapter.initialize?.();
          return adapter;
        }

        const { VeryfrontFSAdapter } = await import("./veryfront/index.ts");
        const adapter = new VeryfrontFSAdapter(configWithCallbacks);
        await adapter.initialize?.();
        return adapter;
      }

      if (type === "github") {
        if (!config.github) {
          throw toError(
            createError({
              type: "config",
              message: "GitHub adapter requires github configuration. " +
                "Provide github.owner, github.repo, and github.token (or GITHUB_TOKEN env var).",
            }),
          );
        }

        const { GitHubFSAdapter } = await import("./github/index.ts");
        const adapter = new GitHubFSAdapter(config);
        await adapter.initialize?.();
        return adapter;
      }

      throw toError(
        createError({
          type: "config",
          message: `FSAdapter type "${type}" is not implemented. ` +
            `Supported types: "local" (default, uses RuntimeAdapter.fs), "veryfront-api", "github".`,
        }),
      );
    },
    { "fs.adapter.type": type, "fs.adapter.proxyMode": config.veryfront?.proxyMode ?? false },
  );
}

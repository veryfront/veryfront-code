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

export function createFSAdapter(config: FSAdapterConfig): Promise<FSAdapter> {
  const type = config.type || "local";

  return withSpan("platform.fs.createAdapter", async () => {
    // Local filesystem uses the native runtime adapter directly.
    // This factory should not be called for "local" type - the caller
    // should use RuntimeAdapter.fs directly instead (see fs-integration.ts).
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
      // Inject invalidationCallbacks to wire up cache clearing and HMR notifications
      // When FSAdapter receives poke from API:
      // 1. Clear all server-side caches (SSR modules, router detection, renderer cache, etc.)
      // 2. Trigger browser reload via ReloadNotifier → HMRHandler → WebSocket
      const configWithCallbacks: FSAdapterConfig = {
        ...config,
        invalidationCallbacks: {
          ...config.invalidationCallbacks,
          // Global clear functions (deprecated - kept for compatibility)
          clearSSRModuleCache,
          clearRouterDetectionCache,
          clearModulePathCache,
          invalidateModulePaths,
          clearSnippetCache,
          clearRendererCache: clearRendererCaches,
          // Per-project clear functions (preferred for multi-tenant)
          clearSSRModuleCacheForProject,
          clearRouterDetectionCacheForProject,
          clearSnippetCacheForProject,
          clearRendererCacheForProject,
          triggerReload: (changedPaths, project) =>
            ReloadNotifier.triggerReload(changedPaths, project?.projectSlug),
        },
      };

      // Check if proxy mode is enabled (multi-project per-request handling)
      if (config.veryfront?.proxyMode) {
        const { MultiProjectFSAdapter } = await import("./veryfront/multi-project-adapter.ts");
        const adapter = new MultiProjectFSAdapter(configWithCallbacks);
        await adapter.initialize?.();
        return adapter;
      }

      // Single-project mode (direct API access)
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
  }, { "fs.adapter.type": type, "fs.adapter.proxyMode": config.veryfront?.proxyMode ?? false });
}

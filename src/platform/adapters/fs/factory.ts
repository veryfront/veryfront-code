import type { FSAdapter, FSAdapterConfig } from "./veryfront/types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { ReloadNotifier } from "../../../server/reload-notifier.ts";

export async function createFSAdapter(config: FSAdapterConfig): Promise<FSAdapter> {
  const type = config.type || "local";

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
    // Inject invalidationCallbacks to wire up HMR notifications
    // When FSAdapter receives poke from API, it calls triggerReload
    // which notifies HMRHandler to broadcast to connected browsers
    const configWithCallbacks: FSAdapterConfig = {
      ...config,
      invalidationCallbacks: {
        ...config.invalidationCallbacks,
        triggerReload: (changedPaths) => ReloadNotifier.triggerReload(changedPaths),
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
}

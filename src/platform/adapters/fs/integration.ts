import type { RuntimeAdapter } from "../base.ts";
import type { FSAdapter, FSAdapterConfig } from "./veryfront/types.ts";
import { createFSAdapter } from "./factory.ts";
import { wrapFSAdapter } from "./wrapper.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = baseLogger.component("fs-integration");

/**
 * Minimal config interface for FS integration.
 * Defined locally to keep adapters module isolated from core/config.
 */
interface FSIntegrationConfig {
  fs?: FSAdapterConfig;
}

function isLocalFS(config: FSIntegrationConfig): boolean {
  return !config.fs?.type || config.fs.type === "local";
}

/**
 * Override `fs` without a Proxy. SecureFs rejects Proxy adapters because their
 * traps can run arbitrary code. Inheriting from the adapter keeps its methods,
 * accessors and identity live, while `fs` is the one own data property SecureFs
 * requires.
 */
export function createEnhancedAdapter(
  adapter: RuntimeAdapter,
  fs: RuntimeAdapter["fs"],
): RuntimeAdapter {
  const enhanced = Object.create(adapter) as RuntimeAdapter;
  Object.defineProperty(enhanced, "fs", {
    value: fs,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  return enhanced;
}

export function enhanceAdapterWithFS(
  adapter: RuntimeAdapter,
  config: FSIntegrationConfig,
  projectDir?: string,
): Promise<RuntimeAdapter> {
  if (isLocalFS(config)) {
    logger.debug("Using local filesystem (default)");
    return Promise.resolve(adapter);
  }

  const fsType = config.fs?.type ?? "unknown";

  return withSpan(
    "platform.fs.enhanceAdapterWithFS",
    async () => {
      logger.debug("Initializing FSAdapter", {
        type: fsType,
        projectSlug: config.fs?.veryfront?.projectSlug,
      });

      const fsAdapterConfig: FSAdapterConfig = {
        ...config.fs,
        projectDir,
      };

      // An explicitly selected remote filesystem is an authority boundary.
      // Propagate every initialization failure so callers never continue with
      // the host-local adapter and serve files from the wrong source.
      const fsAdapter = await createFSAdapter(fsAdapterConfig);
      const wrappedFS = wrapFSAdapter(fsAdapter);

      const enhancedAdapter = createEnhancedAdapter(adapter, wrappedFS);

      logger.debug("FSAdapter initialized successfully", {
        type: fsType,
      });

      return enhancedAdapter;
    },
    { "fs.adapter.type": fsType },
  );
}

export function createFSAdapterFromConfig(
  config: FSIntegrationConfig,
): Promise<FSAdapter | null> {
  if (isLocalFS(config)) return Promise.resolve(null);

  const fsType = config.fs?.type ?? "unknown";

  return withSpan(
    "platform.fs.createFSAdapterFromConfig",
    () => createFSAdapter(config.fs as FSAdapterConfig),
    { "fs.adapter.type": fsType },
  );
}

export function isFSAdapterConfigured(config: FSIntegrationConfig): boolean {
  return !!config.fs?.type && config.fs.type !== "local";
}

export function getFSAdapterType(config: FSIntegrationConfig): string {
  return config.fs?.type ?? "local";
}

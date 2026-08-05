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
 * traps can run arbitrary code, so copy the adapter's members onto a real
 * object with methods bound back to the original instance.
 */
export function createEnhancedAdapter(
  adapter: RuntimeAdapter,
  fs: RuntimeAdapter["fs"],
): RuntimeAdapter {
  const enhanced: Record<PropertyKey, unknown> = {};
  const chain: object[] = [];
  for (
    let current: object | null = adapter;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current)
  ) {
    chain.push(current);
  }

  // Base first so subclass overrides win.
  for (const source of chain.reverse()) {
    for (const key of Reflect.ownKeys(source)) {
      if (key === "constructor" || key === "fs") continue;
      const value = Reflect.get(adapter, key);
      enhanced[key] = typeof value === "function" ? value.bind(adapter) : value;
    }
  }

  Object.defineProperty(enhanced, "fs", {
    value: fs,
    writable: false,
    enumerable: true,
    configurable: false,
  });
  return enhanced as unknown as RuntimeAdapter;
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

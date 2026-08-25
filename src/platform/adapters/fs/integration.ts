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
 * Materialize an adapter that serves `wrappedFS` as its filesystem.
 *
 * This deliberately builds a plain object rather than wrapping the adapter in a
 * Proxy. Security-sensitive consumers refuse a Proxy adapter outright, because a
 * Proxy can intercept the reads they rely on, so a Proxy here made every hosted
 * project using a remote filesystem fail its render with
 * "SecureFs runtime adapter cannot be a Proxy".
 *
 * A Proxy was also quietly wrong for those consumers even where it was allowed:
 * they resolve the filesystem through `getOwnPropertyDescriptor`, and a Proxy
 * with only a `get` trap forwards that to the target, handing back the *host*
 * filesystem instead of the remote one.
 *
 * Adapters are class instances whose methods close over instance state, so
 * functions stay bound to the original adapter, exactly as the previous `get`
 * trap did. Prototype methods are captured by walking the chain; the runtime
 * adapters carry no accessors, so materializing eagerly evaluates nothing that
 * a property read would not have.
 */
function materializeAdapterWithFS(
  adapter: RuntimeAdapter,
  wrappedFS: RuntimeAdapter["fs"],
): RuntimeAdapter {
  const enhanced = {} as RuntimeAdapter & Record<string | symbol, unknown>;
  const seen = new Set<string | symbol>();

  let current: object | null = adapter;
  while (current !== null && current !== Object.prototype) {
    for (const key of Reflect.ownKeys(current)) {
      if (key === "constructor" || key === "fs" || seen.has(key)) continue;
      seen.add(key);
      const value = Reflect.get(adapter, key) as unknown;
      enhanced[key] = typeof value === "function" ? value.bind(adapter) : value;
    }
    current = Object.getPrototypeOf(current);
  }

  enhanced.fs = wrappedFS;
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

      const enhancedAdapter = materializeAdapterWithFS(adapter, wrappedFS);

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

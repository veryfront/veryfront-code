import type { RuntimeAdapter } from "../base.ts";
import type { FSAdapter, FSAdapterConfig } from "./veryfront/types.ts";
import { createFSAdapter } from "./factory.ts";
import { wrapFSAdapter } from "./wrapper.ts";
import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";

const logger = baseLogger.component("fs-integration");

/**
 * Minimal config interface for FS integration.
 * Defined locally to keep adapters module isolated from core/config.
 */
interface FSIntegrationConfig {
  fs?: FSAdapterConfig;
}

interface InspectedFSConfig {
  readonly fs: FSAdapterConfig | null;
  readonly type: string;
}

function invalidConfig(detail: string): never {
  throw CONFIG_INVALID.create({ detail });
}

function assertReadableObject(value: unknown, label: string): asserts value is object {
  if (typeof value !== "object" || value === null) {
    invalidConfig(`${label} must be an object`);
  }
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    invalidConfig(`${label} is not readable`);
  }
  if (isArray) invalidConfig(`${label} must be an object`);
}

function readProperty(value: object, property: PropertyKey, label: string): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    invalidConfig(`${label} is not readable`);
  }
}

function inspectFSConfig(input: unknown): InspectedFSConfig {
  assertReadableObject(input, "Filesystem integration configuration");
  const fs = readProperty(input, "fs", "Filesystem integration configuration");
  if (fs === undefined || fs === null) return { fs: null, type: "local" };
  assertReadableObject(fs, "Filesystem adapter configuration");
  const type = readProperty(fs, "type", "Filesystem adapter configuration") ?? "local";
  if (typeof type !== "string") invalidConfig("Filesystem adapter type must be a string");
  return { fs: fs as FSAdapterConfig, type };
}

function deriveFSConfig(
  inspected: InspectedFSConfig,
  projectDirOverride?: { readonly value: string | undefined },
): FSAdapterConfig {
  if (!inspected.fs) return { type: "local" };
  const derived = Object.create(inspected.fs) as FSAdapterConfig;
  Object.defineProperty(derived, "type", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: inspected.type,
  });
  if (projectDirOverride) {
    Object.defineProperty(derived, "projectDir", {
      configurable: false,
      enumerable: true,
      writable: false,
      value: projectDirOverride.value,
    });
  }
  return Object.freeze(derived);
}

function telemetryType(
  type: string,
): "local" | "veryfront-api" | "github" | "memory" | "unsupported" {
  if (type === "local" || type === "veryfront-api" || type === "github" || type === "memory") {
    return type;
  }
  return "unsupported";
}

export async function enhanceAdapterWithFS(
  adapter: RuntimeAdapter,
  config: FSIntegrationConfig,
  projectDir?: string,
): Promise<RuntimeAdapter> {
  const inspected = inspectFSConfig(config);
  if (inspected.type === "local") {
    logger.debug("Using local filesystem (default)");
    return adapter;
  }

  const fsType = telemetryType(inspected.type);

  return await withSpan(
    "platform.fs.enhanceAdapterWithFS",
    async () => {
      logger.debug("Initializing FSAdapter", { type: fsType });

      const fsAdapter = await createFSAdapter(
        deriveFSConfig(inspected, { value: projectDir }),
      );
      const wrappedFS = wrapFSAdapter(fsAdapter);

      const enhancedAdapter: RuntimeAdapter = new Proxy(adapter, {
        get(target, prop, receiver) {
          if (prop === "fs") return wrappedFS;

          const value = Reflect.get(target, prop, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      logger.debug("FSAdapter initialized successfully", {
        type: fsType,
      });

      return enhancedAdapter;
    },
    { "fs.adapter.type": fsType },
  );
}

export async function createFSAdapterFromConfig(
  config: FSIntegrationConfig,
): Promise<FSAdapter | null> {
  const inspected = inspectFSConfig(config);
  if (inspected.type === "local") return null;

  const fsType = telemetryType(inspected.type);

  return await withSpan(
    "platform.fs.createFSAdapterFromConfig",
    () => createFSAdapter(deriveFSConfig(inspected)),
    { "fs.adapter.type": fsType },
  );
}

export function isFSAdapterConfigured(config: FSIntegrationConfig): boolean {
  const inspected = inspectFSConfig(config);
  return inspected.fs !== null && inspected.type !== "local";
}

export function getFSAdapterType(config: FSIntegrationConfig): string {
  return inspectFSConfig(config).type;
}

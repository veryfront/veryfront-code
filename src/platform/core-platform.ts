import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry/general.ts";
import { detectRuntimeEnvironment } from "./compat/runtime.ts";

export type Platform = "deno" | "node" | "bun" | "cloudflare-workers" | "unknown";

export interface PlatformCapabilities {
  readonly canRunMCPServer: boolean;
  /** Explicit deployment limit, or null when the platform does not define one. */
  readonly maxAgentSteps: number | null;
  /** Explicit deployment CPU limit in milliseconds, or null when unknown. */
  readonly cpuTimeLimit: number | null;
  /** Explicit deployment memory limit in megabytes, or null when unknown. */
  readonly memoryLimit: number | null;
  readonly hasFileSystem: boolean;
  readonly supportsLongRunning: boolean;
  readonly streamingRecommended: boolean;
  readonly displayName: string;
}

export type PlatformCapabilityName = {
  [Key in keyof PlatformCapabilities]: PlatformCapabilities[Key] extends boolean ? Key : never;
}[keyof PlatformCapabilities];

export type PlatformCapabilityOverrides = Partial<
  Omit<PlatformCapabilities, "displayName">
>;

export interface CompatibilityConfig {
  maxSteps?: number;
  streaming?: boolean;
  requiresFileSystem?: boolean;
  requiresMCP?: boolean;
}

const BOOLEAN_CAPABILITY_NAMES = new Set<PlatformCapabilityName>([
  "canRunMCPServer",
  "hasFileSystem",
  "supportsLongRunning",
  "streamingRecommended",
]);
const OVERRIDE_NAMES = new Set<keyof PlatformCapabilityOverrides>([
  "canRunMCPServer",
  "maxAgentSteps",
  "cpuTimeLimit",
  "memoryLimit",
  "hasFileSystem",
  "supportsLongRunning",
  "streamingRecommended",
]);
const COMPATIBILITY_CONFIG_NAMES = new Set<keyof CompatibilityConfig>([
  "maxSteps",
  "streaming",
  "requiresFileSystem",
  "requiresMCP",
]);

function freezeCapabilities(
  capabilities: PlatformCapabilities,
): Readonly<PlatformCapabilities> {
  return Object.freeze(capabilities);
}

const UNKNOWN_PLATFORM_CAPABILITIES = freezeCapabilities({
  canRunMCPServer: false,
  maxAgentSteps: null,
  cpuTimeLimit: null,
  memoryLimit: null,
  hasFileSystem: false,
  supportsLongRunning: false,
  streamingRecommended: true,
  displayName: "Unknown Platform",
});

const PLATFORM_CAPABILITIES: ReadonlyMap<Platform, Readonly<PlatformCapabilities>> = new Map([
  [
    "deno",
    freezeCapabilities({
      canRunMCPServer: true,
      maxAgentSteps: null,
      cpuTimeLimit: null,
      memoryLimit: null,
      hasFileSystem: true,
      supportsLongRunning: true,
      streamingRecommended: false,
      displayName: "Deno",
    }),
  ],
  [
    "node",
    freezeCapabilities({
      canRunMCPServer: true,
      maxAgentSteps: null,
      cpuTimeLimit: null,
      memoryLimit: null,
      hasFileSystem: true,
      supportsLongRunning: true,
      streamingRecommended: false,
      displayName: "Node.js",
    }),
  ],
  [
    "bun",
    freezeCapabilities({
      canRunMCPServer: true,
      maxAgentSteps: null,
      cpuTimeLimit: null,
      memoryLimit: null,
      hasFileSystem: true,
      supportsLongRunning: true,
      streamingRecommended: false,
      displayName: "Bun",
    }),
  ],
  [
    "cloudflare-workers",
    freezeCapabilities({
      canRunMCPServer: false,
      maxAgentSteps: null,
      cpuTimeLimit: null,
      memoryLimit: null,
      hasFileSystem: false,
      supportsLongRunning: false,
      streamingRecommended: true,
      displayName: "Cloudflare Workers",
    }),
  ],
  ["unknown", UNKNOWN_PLATFORM_CAPABILITIES],
]);

export function detectPlatform(): Platform {
  const runtime = detectRuntimeEnvironment();
  return runtime === "cloudflare" ? "cloudflare-workers" : runtime;
}

function validateOptionalLimit(
  name: "maxAgentSteps" | "cpuTimeLimit" | "memoryLimit",
  value: number | null | undefined,
): void {
  if (value === undefined || value === null) return;
  if (
    !Number.isFinite(value) || value <= 0 || (name === "maxAgentSteps" && !Number.isInteger(value))
  ) {
    throw INVALID_ARGUMENT.create({
      message: `Platform ${name} must be a positive ${
        name === "maxAgentSteps" ? "integer" : "number"
      } or null`,
    });
  }
}

function applyCapabilityOverrides(
  baseline: Readonly<PlatformCapabilities>,
  overrides: PlatformCapabilityOverrides,
): Readonly<PlatformCapabilities> {
  const snapshot = snapshotCapabilityOverrides(overrides);
  validateOptionalLimit("maxAgentSteps", snapshot.maxAgentSteps);
  validateOptionalLimit("cpuTimeLimit", snapshot.cpuTimeLimit);
  validateOptionalLimit("memoryLimit", snapshot.memoryLimit);

  for (
    const key of [
      "canRunMCPServer",
      "hasFileSystem",
      "supportsLongRunning",
      "streamingRecommended",
    ] as const
  ) {
    if (snapshot[key] !== undefined && typeof snapshot[key] !== "boolean") {
      throw INVALID_ARGUMENT.create({ message: `Platform ${key} must be a boolean` });
    }
  }

  return freezeCapabilities({ ...baseline, ...snapshot });
}

function snapshotCapabilityOverrides(overrides: unknown): PlatformCapabilityOverrides {
  if (typeof overrides !== "object" || overrides === null) {
    throw INVALID_ARGUMENT.create({ message: "Platform capability overrides must be an object" });
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(overrides);
  } catch {
    throw INVALID_ARGUMENT.create({ message: "Platform capability overrides are not readable" });
  }

  const snapshot: PlatformCapabilityOverrides = {};
  for (const key of keys) {
    if (typeof key !== "string" || !OVERRIDE_NAMES.has(key as keyof PlatformCapabilityOverrides)) {
      throw INVALID_ARGUMENT.create({ message: "Platform capability override is not supported" });
    }

    let value: unknown;
    try {
      value = Reflect.get(overrides, key);
    } catch {
      throw INVALID_ARGUMENT.create({ message: `Platform ${key} override is not readable` });
    }
    if (value === undefined) continue;

    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return snapshot;
}

function snapshotCompatibilityConfig(config: unknown): CompatibilityConfig {
  if (typeof config !== "object" || config === null) {
    throw INVALID_ARGUMENT.create({
      message: "Platform compatibility configuration must be an object",
    });
  }
  let configIsArray: boolean;
  try {
    configIsArray = Array.isArray(config);
  } catch {
    throw INVALID_ARGUMENT.create({
      message: "Platform compatibility configuration is not readable",
    });
  }
  if (configIsArray) {
    throw INVALID_ARGUMENT.create({
      message: "Platform compatibility configuration must be an object",
    });
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(config);
  } catch {
    throw INVALID_ARGUMENT.create({
      message: "Platform compatibility configuration is not readable",
    });
  }

  const snapshot: CompatibilityConfig = {};
  for (const key of keys) {
    if (
      typeof key !== "string" || !COMPATIBILITY_CONFIG_NAMES.has(key as keyof CompatibilityConfig)
    ) {
      throw INVALID_ARGUMENT.create({ message: "Platform compatibility option is not supported" });
    }

    let value: unknown;
    try {
      value = Reflect.get(config, key);
    } catch {
      throw INVALID_ARGUMENT.create({ message: `Platform compatibility ${key} is not readable` });
    }
    if (value === undefined) continue;

    if (key === "maxSteps") {
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        throw INVALID_ARGUMENT.create({
          message: "Platform compatibility maxSteps must be a positive integer",
        });
      }
    } else if (typeof value !== "boolean") {
      throw INVALID_ARGUMENT.create({ message: `Platform compatibility ${key} must be a boolean` });
    }

    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return snapshot;
}

export function getPlatformCapabilities(
  platform: Platform = detectPlatform(),
  overrides?: PlatformCapabilityOverrides,
): Readonly<PlatformCapabilities> {
  const baseline = PLATFORM_CAPABILITIES.get(platform) ?? UNKNOWN_PLATFORM_CAPABILITIES;
  return overrides === undefined ? baseline : applyCapabilityOverrides(baseline, overrides);
}

export function supportsCapability(
  capability: PlatformCapabilityName,
  platform: Platform = detectPlatform(),
  overrides?: PlatformCapabilityOverrides,
): boolean {
  if (!BOOLEAN_CAPABILITY_NAMES.has(capability)) {
    throw INVALID_ARGUMENT.create({ message: "Platform capability name is not supported" });
  }
  return getPlatformCapabilities(platform, overrides)[capability];
}

export function getPlatformWarnings(
  platform: Platform = detectPlatform(),
  overrides?: PlatformCapabilityOverrides,
): string[] {
  const capabilities = getPlatformCapabilities(platform, overrides);
  const warnings: string[] = [];

  if (!capabilities.canRunMCPServer) {
    warnings.push(
      `MCP server cannot run on ${capabilities.displayName}. Deploy the MCP server to a different platform.`,
    );
  }

  if (capabilities.maxAgentSteps !== null) {
    warnings.push(
      `${capabilities.displayName} limits agent steps to ${capabilities.maxAgentSteps}.`,
    );
  }

  if (capabilities.cpuTimeLimit !== null) {
    warnings.push(
      `${capabilities.displayName} limits CPU time to ${capabilities.cpuTimeLimit} milliseconds.`,
    );
  }

  if (capabilities.memoryLimit !== null) {
    warnings.push(
      `${capabilities.displayName} limits memory to ${capabilities.memoryLimit} megabytes.`,
    );
  }

  if (!capabilities.hasFileSystem) {
    warnings.push(`${capabilities.displayName} has no configured file system access.`);
  }

  return warnings;
}

export function validatePlatformCompatibility(
  config: CompatibilityConfig,
  platform: Platform = detectPlatform(),
  overrides?: PlatformCapabilityOverrides,
): {
  compatible: boolean;
  errors: string[];
  warnings: string[];
} {
  const snapshot = snapshotCompatibilityConfig(config);
  const capabilities = getPlatformCapabilities(platform, overrides);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (
    snapshot.maxSteps !== undefined &&
    capabilities.maxAgentSteps !== null &&
    snapshot.maxSteps > capabilities.maxAgentSteps
  ) {
    errors.push(
      `Agent maxSteps (${snapshot.maxSteps}) exceeds platform limit (${capabilities.maxAgentSteps})`,
    );
  }

  if (snapshot.requiresFileSystem && !capabilities.hasFileSystem) {
    errors.push(
      `Agent requires a file system, but ${capabilities.displayName} does not provide one`,
    );
  }

  if (snapshot.requiresMCP && !capabilities.canRunMCPServer) {
    errors.push(`Agent requires an MCP server, but ${capabilities.displayName} cannot run one`);
  }

  if (snapshot.streaming === false && capabilities.streamingRecommended) {
    warnings.push(`Streaming is recommended on ${capabilities.displayName}`);
  }

  return { compatible: errors.length === 0, errors, warnings };
}

export type Platform = "deno" | "node" | "bun" | "cloudflare-workers" | "unknown";

export interface PlatformCapabilities {
  readonly canRunMCPServer: boolean;
  /**
   * Fixed CPU ceiling in milliseconds, or `null` when it varies by deployment
   * plan/configuration or cannot be detected at runtime.
   */
  readonly cpuTimeLimit: number | null;
  /** Fixed isolate/process memory ceiling in MiB, when one is invariant. */
  readonly memoryLimit: number | null;
  readonly hasFileSystem: boolean;
  /** Whether an HTTP response may remain active while its client is connected. */
  readonly supportsLongRunning: boolean;
  readonly streamingRecommended: boolean;
  readonly displayName: string;
}

export type BooleanPlatformCapability = {
  [Key in keyof PlatformCapabilities]: PlatformCapabilities[Key] extends boolean ? Key : never;
}[keyof PlatformCapabilities];

type RuntimeGlobal = typeof globalThis & {
  Deno?: { version?: { deno?: string } };
  Bun?: { version?: string };
  caches?: unknown;
  navigator?: { userAgent?: string };
  process?: { versions?: { node?: string } };
};

function runtimeGlobal(): RuntimeGlobal {
  return globalThis as RuntimeGlobal;
}

export function detectPlatform(): Platform {
  const global = runtimeGlobal();

  if (global.Deno?.version?.deno) return "deno";

  if (global.Bun?.version) return "bun";

  if (
    global.caches !== undefined &&
    global.navigator?.userAgent === "Cloudflare-Workers"
  ) {
    return "cloudflare-workers";
  }

  if (global.process?.versions?.node) return "node";

  return "unknown";
}

/**
 * Invariant per-isolate memory limit for Cloudflare Workers.
 * @see https://developers.cloudflare.com/workers/platform/limits/
 */
const CF_WORKERS_MEMORY_LIMIT_MB = 128;

const PLATFORM_CAPABILITIES: Readonly<Record<Platform, PlatformCapabilities>> = Object.freeze({
  deno: Object.freeze({
    canRunMCPServer: true,
    cpuTimeLimit: null,
    memoryLimit: null,
    hasFileSystem: true,
    supportsLongRunning: true,
    streamingRecommended: false,
    displayName: "Deno",
  }),
  node: Object.freeze({
    canRunMCPServer: true,
    cpuTimeLimit: null,
    memoryLimit: null,
    hasFileSystem: true,
    supportsLongRunning: true,
    streamingRecommended: false,
    displayName: "Node.js",
  }),
  bun: Object.freeze({
    canRunMCPServer: true,
    cpuTimeLimit: null,
    memoryLimit: null,
    hasFileSystem: true,
    supportsLongRunning: true,
    streamingRecommended: false,
    displayName: "Bun",
  }),
  "cloudflare-workers": Object.freeze({
    canRunMCPServer: false,
    cpuTimeLimit: null,
    memoryLimit: CF_WORKERS_MEMORY_LIMIT_MB,
    hasFileSystem: false,
    supportsLongRunning: true,
    streamingRecommended: true,
    displayName: "Cloudflare Workers",
  }),
  unknown: Object.freeze({
    canRunMCPServer: false,
    cpuTimeLimit: null,
    memoryLimit: null,
    hasFileSystem: false,
    supportsLongRunning: false,
    streamingRecommended: true,
    displayName: "Unknown Platform",
  }),
});

export function getPlatformCapabilities(platform?: Platform): PlatformCapabilities {
  return PLATFORM_CAPABILITIES[platform ?? detectPlatform()] ?? PLATFORM_CAPABILITIES.unknown;
}

export function supportsCapability(
  capability: BooleanPlatformCapability,
  platform: Platform = detectPlatform(),
): boolean {
  return getPlatformCapabilities(platform)[capability];
}

export function getPlatformWarnings(platform: Platform = detectPlatform()): string[] {
  const capabilities = getPlatformCapabilities(platform);
  const warnings: string[] = [];

  if (!capabilities.canRunMCPServer) {
    warnings.push(
      `MCP server cannot run on ${capabilities.displayName}. Deploy MCP server to a different platform.`,
    );
  }

  if (!capabilities.hasFileSystem) {
    warnings.push(
      `${capabilities.displayName} has no native file system. Provide an explicit storage-backed adapter for file-based tools.`,
    );
  }

  return warnings;
}

export interface CompatibilityConfig {
  readonly maxSteps?: number;
  readonly streaming?: boolean;
  readonly requiresFileSystem?: boolean;
  readonly requiresMCP?: boolean;
}

export function validatePlatformCompatibility(
  config: CompatibilityConfig,
  platform?: Platform,
): {
  compatible: boolean;
  errors: string[];
  warnings: string[];
} {
  const capabilities = getPlatformCapabilities(platform);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.maxSteps !== undefined) {
    if (!Number.isSafeInteger(config.maxSteps) || config.maxSteps <= 0) {
      errors.push("Agent maxSteps must be a positive safe integer");
    }
  }

  if (config.requiresFileSystem && !capabilities.hasFileSystem) {
    errors.push(
      `Agent requires a native file system but ${capabilities.displayName} doesn't provide one`,
    );
  }

  if (config.requiresMCP && !capabilities.canRunMCPServer) {
    errors.push(`Agent requires MCP server but ${capabilities.displayName} cannot run it`);
  }

  if (!config.streaming && capabilities.streamingRecommended) {
    warnings.push(
      `Streaming is recommended on ${capabilities.displayName} for better user experience`,
    );
  }

  return { compatible: errors.length === 0, errors, warnings };
}

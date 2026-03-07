export type Platform = "deno" | "node" | "bun" | "cloudflare-workers" | "unknown";

interface PlatformCapabilities {
  canRunMCPServer: boolean;
  maxAgentSteps: number;
  cpuTimeLimit: number | null;
  memoryLimit: number | null;
  hasFileSystem: boolean;
  supportsLongRunning: boolean;
  streamingRecommended: boolean;
  displayName: string;
}

export function detectPlatform(): Platform {
  // @ts-ignore - Deno global may not exist
  if (typeof Deno !== "undefined" && Deno.version?.deno) return "deno";

  // @ts-ignore - Bun global may not exist
  if (typeof Bun !== "undefined" && Bun.version) return "bun";

  // @ts-ignore - caches global specific to CF Workers
  if (
    typeof caches !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  ) {
    return "cloudflare-workers";
  }

  const globalProcess = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (globalProcess?.versions?.node) return "node";

  return "unknown";
}

/** CPU time limit for Cloudflare Workers (30 seconds) */
const CF_WORKERS_CPU_TIME_LIMIT_MS = 30_000;
/** Memory limit for Cloudflare Workers (128 MB) */
const CF_WORKERS_MEMORY_LIMIT_MB = 128;
/** Max agent steps for Cloudflare Workers */
const CF_WORKERS_MAX_AGENT_STEPS = 3;

/** CPU time limit for unknown platforms (60 seconds) */
const UNKNOWN_PLATFORM_CPU_TIME_LIMIT_MS = 60_000;
/** Memory limit for unknown platforms (512 MB) */
const UNKNOWN_PLATFORM_MEMORY_LIMIT_MB = 512;
/** Max agent steps for unknown platforms */
const UNKNOWN_PLATFORM_MAX_AGENT_STEPS = 5;

/** Minimum agent steps threshold for generating a warning */
const MIN_AGENT_STEPS_WARNING_THRESHOLD = 10;

/** CPU time limit below which a platform warning is emitted (60 seconds) */
const CPU_TIME_WARNING_THRESHOLD_MS = 60_000;

const PLATFORM_CAPABILITIES: Record<Platform, PlatformCapabilities> = {
  deno: {
    canRunMCPServer: true,
    maxAgentSteps: Infinity,
    cpuTimeLimit: null,
    memoryLimit: null,
    hasFileSystem: true,
    supportsLongRunning: true,
    streamingRecommended: false,
    displayName: "Deno",
  },
  node: {
    canRunMCPServer: true,
    maxAgentSteps: Infinity,
    cpuTimeLimit: null,
    memoryLimit: null,
    hasFileSystem: true,
    supportsLongRunning: true,
    streamingRecommended: false,
    displayName: "Node.js",
  },
  bun: {
    canRunMCPServer: true,
    maxAgentSteps: Infinity,
    cpuTimeLimit: null,
    memoryLimit: null,
    hasFileSystem: true,
    supportsLongRunning: true,
    streamingRecommended: false,
    displayName: "Bun",
  },
  "cloudflare-workers": {
    canRunMCPServer: false,
    maxAgentSteps: CF_WORKERS_MAX_AGENT_STEPS,
    cpuTimeLimit: CF_WORKERS_CPU_TIME_LIMIT_MS,
    memoryLimit: CF_WORKERS_MEMORY_LIMIT_MB,
    hasFileSystem: false,
    supportsLongRunning: false,
    streamingRecommended: true,
    displayName: "Cloudflare Workers",
  },
  unknown: {
    canRunMCPServer: false,
    maxAgentSteps: UNKNOWN_PLATFORM_MAX_AGENT_STEPS,
    cpuTimeLimit: UNKNOWN_PLATFORM_CPU_TIME_LIMIT_MS,
    memoryLimit: UNKNOWN_PLATFORM_MEMORY_LIMIT_MB,
    hasFileSystem: false,
    supportsLongRunning: false,
    streamingRecommended: true,
    displayName: "Unknown Platform",
  },
};

export function getPlatformCapabilities(platform?: Platform): PlatformCapabilities {
  return PLATFORM_CAPABILITIES[platform ?? detectPlatform()] ?? PLATFORM_CAPABILITIES.unknown;
}

export function supportsCapability(capability: keyof PlatformCapabilities): boolean {
  const value = getPlatformCapabilities()[capability];

  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;

  return false;
}

export function getPlatformWarnings(): string[] {
  const capabilities = getPlatformCapabilities();
  const warnings: string[] = [];

  if (!capabilities.canRunMCPServer) {
    warnings.push(
      `MCP server cannot run on ${capabilities.displayName}. Deploy MCP server to a different platform.`,
    );
  }

  if (capabilities.maxAgentSteps < MIN_AGENT_STEPS_WARNING_THRESHOLD) {
    warnings.push(
      `${capabilities.displayName} has limited agent steps (${capabilities.maxAgentSteps}). Use simple agents only.`,
    );
  }

  if (
    capabilities.cpuTimeLimit !== null &&
    capabilities.cpuTimeLimit < CPU_TIME_WARNING_THRESHOLD_MS
  ) {
    warnings.push(
      `${capabilities.displayName} has CPU time limit of ${capabilities.cpuTimeLimit}ms. Enable streaming for better UX.`,
    );
  }

  if (!capabilities.hasFileSystem) {
    warnings.push(`${capabilities.displayName} has no file system access. Avoid file-based tools.`);
  }

  return warnings;
}

interface CompatibilityConfig {
  maxSteps?: number;
  streaming?: boolean;
  requiresFileSystem?: boolean;
  requiresMCP?: boolean;
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

  if (
    config.maxSteps &&
    capabilities.maxAgentSteps !== Infinity &&
    config.maxSteps > capabilities.maxAgentSteps
  ) {
    errors.push(
      `Agent maxSteps (${config.maxSteps}) exceeds platform limit (${capabilities.maxAgentSteps})`,
    );
  }

  if (config.requiresFileSystem && !capabilities.hasFileSystem) {
    errors.push(`Agent requires file system but ${capabilities.displayName} doesn't support it`);
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

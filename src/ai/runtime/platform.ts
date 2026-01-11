export type Platform = "deno" | "node" | "bun" | "cloudflare-workers" | "unknown";

export interface PlatformCapabilities {
  canRunMCPServer: boolean;
  maxAgentSteps: number;
  cpuTimeLimit: number | null;
  memoryLimit: number | null;
  hasFileSystem: boolean;
  supportsLongRunning: boolean;
  streamingRecommended: boolean;
  displayName: string;
}

/** Global interface for Node.js process in platform detection */
interface GlobalWithNodeProcess {
  process?: {
    versions?: {
      node?: string;
    };
  };
}

export function detectPlatform(): Platform {
  // Check for Deno
  // @ts-ignore - Deno global may not exist
  if (typeof Deno !== "undefined" && Deno.version?.deno) {
    return "deno";
  }

  // Check for Bun
  // @ts-ignore - Bun global may not exist
  if (typeof Bun !== "undefined" && Bun.version) {
    return "bun";
  }

  // Check for Cloudflare Workers
  // @ts-ignore - caches global specific to CF Workers
  if (
    typeof caches !== "undefined" && typeof navigator !== "undefined" &&
    navigator.userAgent === "Cloudflare-Workers"
  ) {
    return "cloudflare-workers";
  }

  // Check for Node.js
  const globalProcess = (globalThis as unknown as GlobalWithNodeProcess).process;
  if (
    typeof globalProcess !== "undefined" &&
    globalProcess.versions?.node
  ) {
    return "node";
  }

  return "unknown";
}

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
    maxAgentSteps: 3,
    cpuTimeLimit: 30000,
    memoryLimit: 128,
    hasFileSystem: false,
    supportsLongRunning: false,
    streamingRecommended: true,
    displayName: "Cloudflare Workers",
  },
  unknown: {
    canRunMCPServer: false,
    maxAgentSteps: 5,
    cpuTimeLimit: 60000,
    memoryLimit: 512,
    hasFileSystem: false,
    supportsLongRunning: false,
    streamingRecommended: true,
    displayName: "Unknown Platform",
  },
} as const;

export function getPlatformCapabilities(platform?: Platform): PlatformCapabilities {
  const detectedPlatform = platform || detectPlatform();
  return PLATFORM_CAPABILITIES[detectedPlatform] ?? PLATFORM_CAPABILITIES.unknown;
}

export function supportsCapability(capability: keyof PlatformCapabilities): boolean {
  const value = getPlatformCapabilities()[capability];
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  return false;
}

export function getPlatformWarnings(): string[] {
  const platform = detectPlatform();
  const capabilities = getPlatformCapabilities(platform);
  const warnings: string[] = [];

  if (!capabilities.canRunMCPServer) {
    warnings.push(
      `MCP server cannot run on ${capabilities.displayName}. Deploy MCP server to a different platform.`,
    );
  }

  if (capabilities.maxAgentSteps < 10) {
    warnings.push(
      `${capabilities.displayName} has limited agent steps (${capabilities.maxAgentSteps}). Use simple agents only.`,
    );
  }

  if (capabilities.cpuTimeLimit !== null && capabilities.cpuTimeLimit < 60000) {
    warnings.push(
      `${capabilities.displayName} has CPU time limit of ${capabilities.cpuTimeLimit}ms. Enable streaming for better UX.`,
    );
  }

  if (!capabilities.hasFileSystem) {
    warnings.push(
      `${capabilities.displayName} has no file system access. Avoid file-based tools.`,
    );
  }

  return warnings;
}

export interface CompatibilityConfig {
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

  // Check max steps (skip check if platform has no limit)
  if (
    config.maxSteps &&
    capabilities.maxAgentSteps !== Infinity &&
    config.maxSteps > capabilities.maxAgentSteps
  ) {
    errors.push(
      `Agent maxSteps (${config.maxSteps}) exceeds platform limit (${capabilities.maxAgentSteps})`,
    );
  }

  // Check file system requirement
  if (config.requiresFileSystem && !capabilities.hasFileSystem) {
    errors.push(
      `Agent requires file system but ${capabilities.displayName} doesn't support it`,
    );
  }

  // Check MCP requirement
  if (config.requiresMCP && !capabilities.canRunMCPServer) {
    errors.push(
      `Agent requires MCP server but ${capabilities.displayName} cannot run it`,
    );
  }

  // Check streaming recommendation
  if (!config.streaming && capabilities.streamingRecommended) {
    warnings.push(
      `Streaming is recommended on ${capabilities.displayName} for better user experience`,
    );
  }

  return {
    compatible: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Platform Detection and Runtime Abstractions
 *
 * Detects the current JavaScript runtime and provides platform-specific
 * capabilities and constraints.
 *
 * Supported platforms:
 * - Deno
 * - Node.js
 * - Bun
 * - Cloudflare Workers
 */

export type Platform = "deno" | "node" | "bun" | "cloudflare-workers" | "unknown";

export interface PlatformCapabilities {
  /** Can run MCP server (requires TCP server support) */
  canRunMCPServer: boolean;

  /** Maximum agent steps before timeout risk */
  maxAgentSteps: number;

  /** CPU time limit in milliseconds */
  cpuTimeLimit: number | null;

  /** Memory limit in MB */
  memoryLimit: number | null;

  /** Supports file system access */
  hasFileSystem: boolean;

  /** Supports long-running tasks */
  supportsLongRunning: boolean;

  /** Recommended for streaming */
  streamingRecommended: boolean;

  /** Platform display name */
  displayName: string;
}

/**
 * Detects the current JavaScript runtime platform
 */
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
  const globalProcess = (globalThis as any).process;
  if (
    typeof globalProcess !== "undefined" &&
    globalProcess.versions?.node
  ) {
    return "node";
  }

  return "unknown";
}

/**
 * Gets platform capabilities for the current or specified platform
 */
export function getPlatformCapabilities(platform?: Platform): PlatformCapabilities {
  const detectedPlatform = platform || detectPlatform();

  switch (detectedPlatform) {
    case "deno":
      return {
        canRunMCPServer: true,
        maxAgentSteps: Infinity,
        cpuTimeLimit: null, // No hard limit
        memoryLimit: null, // System dependent
        hasFileSystem: true,
        supportsLongRunning: true,
        streamingRecommended: false,
        displayName: "Deno",
      };

    case "node":
      return {
        canRunMCPServer: true,
        maxAgentSteps: Infinity,
        cpuTimeLimit: null,
        memoryLimit: null,
        hasFileSystem: true,
        supportsLongRunning: true,
        streamingRecommended: false,
        displayName: "Node.js",
      };

    case "bun":
      return {
        canRunMCPServer: true,
        maxAgentSteps: Infinity,
        cpuTimeLimit: null,
        memoryLimit: null,
        hasFileSystem: true,
        supportsLongRunning: true,
        streamingRecommended: false,
        displayName: "Bun",
      };

    case "cloudflare-workers":
      return {
        canRunMCPServer: false, // CF Workers cannot run TCP servers
        maxAgentSteps: 3, // Conservative limit for 30s CPU time
        cpuTimeLimit: 30000, // 30 seconds
        memoryLimit: 128, // 128 MB
        hasFileSystem: false,
        supportsLongRunning: false,
        streamingRecommended: true, // Required for good UX
        displayName: "Cloudflare Workers",
      };

    default:
      return {
        canRunMCPServer: false,
        maxAgentSteps: 5,
        cpuTimeLimit: 60000,
        memoryLimit: 512,
        hasFileSystem: false,
        supportsLongRunning: false,
        streamingRecommended: true,
        displayName: "Unknown Platform",
      };
  }
}

/**
 * Checks if the current platform supports a specific capability
 */
export function supportsCapability(capability: keyof PlatformCapabilities): boolean {
  const capabilities = getPlatformCapabilities();
  const value = capabilities[capability];

  // Handle boolean capabilities
  if (typeof value === "boolean") {
    return value;
  }

  // Handle numeric capabilities (non-zero means supported)
  if (typeof value === "number") {
    return value > 0;
  }

  return false;
}

/**
 * Gets a warning message if the current platform has constraints
 */
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

  // Check max steps
  if (config.maxSteps && config.maxSteps > capabilities.maxAgentSteps) {
    if (capabilities.maxAgentSteps === Infinity) {
      // No limit, all good
    } else {
      errors.push(
        `Agent maxSteps (${config.maxSteps}) exceeds platform limit (${capabilities.maxAgentSteps})`,
      );
    }
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

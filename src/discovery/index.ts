/**
 * @module
 * Discovery Module
 *
 * Automatic discovery and registration of tools, agents, resources,
 * prompts, and workflows from the project directory.
 *
 * This is a framework-level capability — servers call discoverAll()
 * during startup and on HMR file changes. The CLI provides configuration
 * but does not orchestrate discovery directly.
 */

// Re-export types
export type {
  DiscoveryConfig,
  DiscoveryHandler,
  DiscoveryResult,
  FileDiscoveryContext,
} from "./types.ts";

// Re-export main discovery function
export { discoverAll } from "./discovery-engine.ts";

// Re-export utilities
export { clearTrackedAgents, filenameToId, filePathToPattern } from "./discovery-utils.ts";

// Re-export transpiler utilities
export { clearTranspileCache } from "./transpiler.ts";

// Re-export config validation (pure logic — no ANSI colors)
export { validateAIConfig, type ValidationResult } from "./config-validator.ts";

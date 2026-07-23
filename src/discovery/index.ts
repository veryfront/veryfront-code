/**
 * Automatic discovery and registration of tools, agents, resources,
 * prompts, and workflows from the project directory.
 *
 * This is a framework-level capability. Servers call discoverAll()
 * during startup and on HMR file changes. The CLI provides configuration
 * but does not orchestrate discovery directly.
 *
 * @module discovery
 */

// Re-export types
export type {
  DiscoveryConfig,
  DiscoveryError,
  DiscoveryHandler,
  DiscoveryResult,
  FileDiscoveryContext,
} from "./types.ts";

// Re-export main discovery function
export { discoverAll } from "./discovery-engine.ts";
export {
  createProjectDiscoveryConfig,
  DEFAULT_PROJECT_DISCOVERY_DIRS,
} from "./project-discovery-config.ts";
export type {
  ProjectDiscoveryConfig,
  ProjectDiscoveryConfigInput,
} from "./project-discovery-config.ts";

// Re-export utilities
export { clearTrackedAgents, filenameToId, filePathToPattern } from "./discovery-utils.ts";

// Re-export transpiler utilities
export { clearTranspileCache } from "./transpiler.ts";

// Re-export provider config validation (pure logic, no ANSI colors)
export { validateProviderConfig, type ValidationResult } from "./provider-config-validator.ts";

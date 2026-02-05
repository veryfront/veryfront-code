/**
 * Discovery Module
 *
 * Automatic discovery and registration of tools, agents, resources,
 * prompts, and workflows from the project directory.
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

// Re-export agent index generation
export { generateAgentIndex } from "./agent-index.ts";

// Re-export utilities
export { clearTrackedAgents, filenameToId, filePathToPattern } from "./discovery-utils.ts";

// Re-export transpiler utilities
export { clearTranspileCache } from "./transpiler.ts";

/**
 * Sync module for Veryfront CLI
 *
 * Provides project discovery and ignore patterns for sync operations.
 * The actual pull/push commands are in src/cli/commands/pull.ts and push.ts.
 */

export {
  fetchRemoteProjects,
  getCurrentUser,
  isAuthenticated,
  type ProjectDiscoveryResult,
  type RemoteProject,
} from "./project-discovery.js";

export {
  createDefaultIgnoreChecker,
  createIgnoreChecker,
  type IgnoreChecker,
  loadIgnorePatterns,
} from "./ignore.js";

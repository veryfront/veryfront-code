/**
 * Sync module for Veryfront CLI
 *
 * Provides project discovery and ignore patterns for sync operations.
 * The actual pull/push commands are in cli/commands/pull.ts and push.ts.
 */

export {
  fetchRemoteProjects,
  getCurrentUser,
  isAuthenticated,
  type ProjectDiscoveryResult,
  type RemoteProject,
} from "./project-discovery.ts";

export {
  createDefaultIgnoreChecker,
  createIgnoreChecker,
  type IgnoreChecker,
  type IgnoreCheckerOptions,
  loadIgnoreChecker,
  loadIgnorePatterns,
} from "./ignore.ts";

export {
  type GitIgnoreContext,
  IGNORED_PROJECT_DIRECTORY_WARNING,
  IGNORED_PROJECT_DIRECTORY_WARNING_CODE,
  loadGitIgnoreContext,
} from "./git-ignore.ts";

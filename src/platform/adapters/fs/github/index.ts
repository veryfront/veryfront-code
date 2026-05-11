/**
 * Fs - Github
 *
 * @module platform/adapters/fs/github
 */

export { GitHubFSAdapter } from "./adapter.ts";
export { GitHubApiClient } from "./github-api-client.ts";
export { GitHubStatOperations } from "./stat-operations.ts";
export { GitHubReadOperations } from "./read-operations.ts";
export { GitHubDirectoryOperations } from "./directory-operations.ts";

export { createGitHubConfig } from "./types.ts";
export type {
  DirectoryEntry,
  FileIndexEntry,
  FileInfo,
  GitHubBlobResponse,
  GitHubConfig,
  GitHubContentItem,
  GitHubContentsResponse,
  GitHubTreeEntry,
  GitHubTreeResponse,
  ResolvedGitHubConfig,
} from "./types.ts";

export {
  getGitHubBlobResponseSchema,
  getGitHubContentItemSchema,
  getGitHubContentsResponseSchema,
  getGitHubTreeEntrySchema,
  getGitHubTreeResponseSchema,
  GITHUB_API_ENDPOINTS,
} from "./schemas/index.ts";

export { GitHubFSAdapter } from "./adapter.ts";
export { GitHubAPIClient } from "./github-api-client.ts";
export { GitHubStatOperations } from "./stat-operations.ts";
export { GitHubReadOperations } from "./read-operations.ts";
export { GitHubDirectoryOperations } from "./directory-operations.ts";

export type {
  DirectoryEntry,
  FileIndexEntry,
  FileInfo,
  GitHubBlobResponse,
  GitHubConfig,
  GitHubContentItem,
  GitHubTreeEntry,
  GitHubTreeResponse,
  ResolvedGitHubConfig,
} from "./types.ts";

export { createGitHubConfig } from "./types.ts";

export { GitHubFSAdapter } from "./adapter.ts";
export { GitHubAPIClient } from "./github-api-client.ts";
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
  GITHUB_API_ENDPOINTS,
  GitHubBlobResponseSchema,
  GitHubContentItemSchema,
  GitHubContentsResponseSchema,
  GitHubTreeEntrySchema,
  GitHubTreeResponseSchema,
} from "./schemas/index.ts";

/**
 * GitHub API Schemas
 *
 * Zod schemas for runtime validation of GitHub API responses.
 * This file serves as documentation for all GitHub API endpoints used.
 *
 * @see https://docs.github.com/en/rest
 */

import { z } from "zod";

// =============================================================================
// Base Schemas
// =============================================================================

/**
 * GitHub tree entry from Git Trees API
 * @see https://docs.github.com/en/rest/git/trees#get-a-tree
 */
export const GitHubTreeEntrySchema = z.object({
  path: z.string(),
  mode: z.string().optional(), // Not used in our code
  type: z.enum(["blob", "tree", "commit"]),
  sha: z.string(),
  size: z.number().optional(),
});

/**
 * GitHub content item from Contents API
 * @see https://docs.github.com/en/rest/repos/contents#get-repository-content
 */
export const GitHubContentItemSchema = z.object({
  type: z.enum(["file", "dir", "symlink", "submodule"]),
  name: z.string(),
  path: z.string(),
  sha: z.string(),
  size: z.number(),
  content: z.string().optional(),
  encoding: z.literal("base64").optional(),
  download_url: z.string().nullable().optional(),
});

// =============================================================================
// API Response Schemas
// =============================================================================

/**
 * GET /repos/{owner}/{repo}/git/trees/{tree_sha}
 * Get a tree (with ?recursive=1 for full tree)
 *
 * @see https://docs.github.com/en/rest/git/trees#get-a-tree
 */
export const GitHubTreeResponseSchema = z.object({
  sha: z.string(),
  url: z.string().optional(), // Not used in our code
  tree: z.array(GitHubTreeEntrySchema),
  truncated: z.boolean(),
});

/**
 * GET /repos/{owner}/{repo}/contents/{path}
 * Get repository content (file or directory)
 *
 * Returns single item for files, array for directories
 * @see https://docs.github.com/en/rest/repos/contents#get-repository-content
 */
export const GitHubContentsResponseSchema = z.union([
  GitHubContentItemSchema,
  z.array(GitHubContentItemSchema),
]);

/**
 * GET /repos/{owner}/{repo}/git/blobs/{file_sha}
 * Get a blob (for large files >1MB)
 *
 * @see https://docs.github.com/en/rest/git/blobs#get-a-blob
 */
export const GitHubBlobResponseSchema = z.object({
  sha: z.string(),
  size: z.number(),
  content: z.string(),
  encoding: z.enum(["base64", "utf-8"]),
});

// =============================================================================
// Type Exports (inferred from schemas)
// =============================================================================

export type GitHubTreeEntry = z.infer<typeof GitHubTreeEntrySchema>;
export type GitHubContentItem = z.infer<typeof GitHubContentItemSchema>;
export type GitHubTreeResponse = z.infer<typeof GitHubTreeResponseSchema>;
export type GitHubContentsResponse = z.infer<typeof GitHubContentsResponseSchema>;
export type GitHubBlobResponse = z.infer<typeof GitHubBlobResponseSchema>;

// =============================================================================
// Endpoint Registry (for documentation/tooling)
// =============================================================================

export const GITHUB_API_ENDPOINTS = {
  getTree: {
    method: "GET" as const,
    path: "/repos/{owner}/{repo}/git/trees/{tree_sha}",
    description: "Get a tree. Use ?recursive=1 for full repository tree.",
    queryParams: ["recursive"],
    responseSchema: GitHubTreeResponseSchema,
    docs: "https://docs.github.com/en/rest/git/trees#get-a-tree",
  },
  getContents: {
    method: "GET" as const,
    path: "/repos/{owner}/{repo}/contents/{path}",
    description: "Get repository content. Returns file content or directory listing.",
    queryParams: ["ref"],
    responseSchema: GitHubContentsResponseSchema,
    docs: "https://docs.github.com/en/rest/repos/contents#get-repository-content",
  },
  getBlob: {
    method: "GET" as const,
    path: "/repos/{owner}/{repo}/git/blobs/{file_sha}",
    description: "Get a blob by SHA. Used for large files (>1MB).",
    responseSchema: GitHubBlobResponseSchema,
    docs: "https://docs.github.com/en/rest/git/blobs#get-a-blob",
  },
} as const;

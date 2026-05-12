/** @see https://docs.github.com/en/rest */

import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

export const getGitHubTreeEntrySchema = defineSchema((v) =>
  v.object({
    path: v.string(),
    mode: v.string().optional(),
    type: v.enum(["blob", "tree", "commit"] as const),
    sha: v.string(),
    size: v.number().optional(),
  })
);

export const getGitHubContentItemSchema = defineSchema((v) =>
  v.object({
    type: v.enum(["file", "dir", "symlink", "submodule"] as const),
    name: v.string(),
    path: v.string(),
    sha: v.string(),
    size: v.number(),
    content: v.string().optional(),
    encoding: v.literal("base64").optional(),
    download_url: v.string().nullable().optional(),
  })
);

export const getGitHubTreeResponseSchema = defineSchema((v) =>
  v.object({
    sha: v.string(),
    url: v.string().optional(),
    tree: v.array(getGitHubTreeEntrySchema()),
    truncated: v.boolean(),
  })
);

export const getGitHubContentsResponseSchema = defineSchema((v) =>
  v.union([
    getGitHubContentItemSchema(),
    v.array(getGitHubContentItemSchema()),
  ])
);

export const getGitHubBlobResponseSchema = defineSchema((v) =>
  v.object({
    sha: v.string(),
    size: v.number(),
    content: v.string(),
    encoding: v.enum(["base64", "utf-8"] as const),
  })
);

export type GitHubTreeEntry = InferSchema<ReturnType<typeof getGitHubTreeEntrySchema>>;
export type GitHubContentItem = InferSchema<ReturnType<typeof getGitHubContentItemSchema>>;
export type GitHubTreeResponse = InferSchema<ReturnType<typeof getGitHubTreeResponseSchema>>;
export type GitHubContentsResponse = InferSchema<
  ReturnType<typeof getGitHubContentsResponseSchema>
>;
export type GitHubBlobResponse = InferSchema<ReturnType<typeof getGitHubBlobResponseSchema>>;

export const GITHUB_API_ENDPOINTS = {
  getTree: {
    method: "GET",
    path: "/repos/{owner}/{repo}/git/trees/{tree_sha}",
    description: "Get a tree. Use ?recursive=1 for full repository tree.",
    queryParams: ["recursive"],
    // schema getter — call to materialize the underlying Schema<T>
    responseSchema: getGitHubTreeResponseSchema,
    docs: "https://docs.github.com/en/rest/git/trees#get-a-tree",
  },
  getContents: {
    method: "GET",
    path: "/repos/{owner}/{repo}/contents/{path}",
    description: "Get repository content. Returns file content or directory listing.",
    queryParams: ["ref"],
    // schema getter — call to materialize the underlying Schema<T>
    responseSchema: getGitHubContentsResponseSchema,
    docs: "https://docs.github.com/en/rest/repos/contents#get-repository-content",
  },
  getBlob: {
    method: "GET",
    path: "/repos/{owner}/{repo}/git/blobs/{file_sha}",
    description: "Get a blob by SHA. Used for large files (>1MB).",
    // schema getter — call to materialize the underlying Schema<T>
    responseSchema: getGitHubBlobResponseSchema,
    docs: "https://docs.github.com/en/rest/git/blobs#get-a-blob",
  },
} as const;

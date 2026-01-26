/**
 * GitHub API Schemas
 *
 * Zod schemas for runtime validation of GitHub API responses.
 * This file serves as documentation for all GitHub API endpoints used.
 *
 * @see https://docs.github.com/en/rest
 */
import { z } from "zod";
export const GitHubTreeEntrySchema = z.object({
    path: z.string(),
    mode: z.string().optional(),
    type: z.enum(["blob", "tree", "commit"]),
    sha: z.string(),
    size: z.number().optional(),
});
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
export const GitHubTreeResponseSchema = z.object({
    sha: z.string(),
    url: z.string().optional(),
    tree: z.array(GitHubTreeEntrySchema),
    truncated: z.boolean(),
});
export const GitHubContentsResponseSchema = z.union([
    GitHubContentItemSchema,
    z.array(GitHubContentItemSchema),
]);
export const GitHubBlobResponseSchema = z.object({
    sha: z.string(),
    size: z.number(),
    content: z.string(),
    encoding: z.enum(["base64", "utf-8"]),
});
export const GITHUB_API_ENDPOINTS = {
    getTree: {
        method: "GET",
        path: "/repos/{owner}/{repo}/git/trees/{tree_sha}",
        description: "Get a tree. Use ?recursive=1 for full repository tree.",
        queryParams: ["recursive"],
        responseSchema: GitHubTreeResponseSchema,
        docs: "https://docs.github.com/en/rest/git/trees#get-a-tree",
    },
    getContents: {
        method: "GET",
        path: "/repos/{owner}/{repo}/contents/{path}",
        description: "Get repository content. Returns file content or directory listing.",
        queryParams: ["ref"],
        responseSchema: GitHubContentsResponseSchema,
        docs: "https://docs.github.com/en/rest/repos/contents#get-repository-content",
    },
    getBlob: {
        method: "GET",
        path: "/repos/{owner}/{repo}/git/blobs/{file_sha}",
        description: "Get a blob by SHA. Used for large files (>1MB).",
        responseSchema: GitHubBlobResponseSchema,
        docs: "https://docs.github.com/en/rest/git/blobs#get-a-blob",
    },
};

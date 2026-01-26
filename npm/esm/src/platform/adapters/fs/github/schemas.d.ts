/**
 * GitHub API Schemas
 *
 * Zod schemas for runtime validation of GitHub API responses.
 * This file serves as documentation for all GitHub API endpoints used.
 *
 * @see https://docs.github.com/en/rest
 */
import { z } from "zod";
export declare const GitHubTreeEntrySchema: z.ZodObject<{
    path: z.ZodString;
    mode: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<["blob", "tree", "commit"]>;
    sha: z.ZodString;
    size: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "blob" | "tree" | "commit";
    path: string;
    sha: string;
    size?: number | undefined;
    mode?: string | undefined;
}, {
    type: "blob" | "tree" | "commit";
    path: string;
    sha: string;
    size?: number | undefined;
    mode?: string | undefined;
}>;
export declare const GitHubContentItemSchema: z.ZodObject<{
    type: z.ZodEnum<["file", "dir", "symlink", "submodule"]>;
    name: z.ZodString;
    path: z.ZodString;
    sha: z.ZodString;
    size: z.ZodNumber;
    content: z.ZodOptional<z.ZodString>;
    encoding: z.ZodOptional<z.ZodLiteral<"base64">>;
    download_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "file" | "dir" | "symlink" | "submodule";
    path: string;
    name: string;
    size: number;
    sha: string;
    encoding?: "base64" | undefined;
    content?: string | undefined;
    download_url?: string | null | undefined;
}, {
    type: "file" | "dir" | "symlink" | "submodule";
    path: string;
    name: string;
    size: number;
    sha: string;
    encoding?: "base64" | undefined;
    content?: string | undefined;
    download_url?: string | null | undefined;
}>;
export declare const GitHubTreeResponseSchema: z.ZodObject<{
    sha: z.ZodString;
    url: z.ZodOptional<z.ZodString>;
    tree: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        mode: z.ZodOptional<z.ZodString>;
        type: z.ZodEnum<["blob", "tree", "commit"]>;
        sha: z.ZodString;
        size: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "blob" | "tree" | "commit";
        path: string;
        sha: string;
        size?: number | undefined;
        mode?: string | undefined;
    }, {
        type: "blob" | "tree" | "commit";
        path: string;
        sha: string;
        size?: number | undefined;
        mode?: string | undefined;
    }>, "many">;
    truncated: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    tree: {
        type: "blob" | "tree" | "commit";
        path: string;
        sha: string;
        size?: number | undefined;
        mode?: string | undefined;
    }[];
    sha: string;
    truncated: boolean;
    url?: string | undefined;
}, {
    tree: {
        type: "blob" | "tree" | "commit";
        path: string;
        sha: string;
        size?: number | undefined;
        mode?: string | undefined;
    }[];
    sha: string;
    truncated: boolean;
    url?: string | undefined;
}>;
export declare const GitHubContentsResponseSchema: z.ZodUnion<[z.ZodObject<{
    type: z.ZodEnum<["file", "dir", "symlink", "submodule"]>;
    name: z.ZodString;
    path: z.ZodString;
    sha: z.ZodString;
    size: z.ZodNumber;
    content: z.ZodOptional<z.ZodString>;
    encoding: z.ZodOptional<z.ZodLiteral<"base64">>;
    download_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "file" | "dir" | "symlink" | "submodule";
    path: string;
    name: string;
    size: number;
    sha: string;
    encoding?: "base64" | undefined;
    content?: string | undefined;
    download_url?: string | null | undefined;
}, {
    type: "file" | "dir" | "symlink" | "submodule";
    path: string;
    name: string;
    size: number;
    sha: string;
    encoding?: "base64" | undefined;
    content?: string | undefined;
    download_url?: string | null | undefined;
}>, z.ZodArray<z.ZodObject<{
    type: z.ZodEnum<["file", "dir", "symlink", "submodule"]>;
    name: z.ZodString;
    path: z.ZodString;
    sha: z.ZodString;
    size: z.ZodNumber;
    content: z.ZodOptional<z.ZodString>;
    encoding: z.ZodOptional<z.ZodLiteral<"base64">>;
    download_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    type: "file" | "dir" | "symlink" | "submodule";
    path: string;
    name: string;
    size: number;
    sha: string;
    encoding?: "base64" | undefined;
    content?: string | undefined;
    download_url?: string | null | undefined;
}, {
    type: "file" | "dir" | "symlink" | "submodule";
    path: string;
    name: string;
    size: number;
    sha: string;
    encoding?: "base64" | undefined;
    content?: string | undefined;
    download_url?: string | null | undefined;
}>, "many">]>;
export declare const GitHubBlobResponseSchema: z.ZodObject<{
    sha: z.ZodString;
    size: z.ZodNumber;
    content: z.ZodString;
    encoding: z.ZodEnum<["base64", "utf-8"]>;
}, "strip", z.ZodTypeAny, {
    encoding: "base64" | "utf-8";
    size: number;
    content: string;
    sha: string;
}, {
    encoding: "base64" | "utf-8";
    size: number;
    content: string;
    sha: string;
}>;
export type GitHubTreeEntry = z.infer<typeof GitHubTreeEntrySchema>;
export type GitHubContentItem = z.infer<typeof GitHubContentItemSchema>;
export type GitHubTreeResponse = z.infer<typeof GitHubTreeResponseSchema>;
export type GitHubContentsResponse = z.infer<typeof GitHubContentsResponseSchema>;
export type GitHubBlobResponse = z.infer<typeof GitHubBlobResponseSchema>;
export declare const GITHUB_API_ENDPOINTS: {
    readonly getTree: {
        readonly method: "GET";
        readonly path: "/repos/{owner}/{repo}/git/trees/{tree_sha}";
        readonly description: "Get a tree. Use ?recursive=1 for full repository tree.";
        readonly queryParams: readonly ["recursive"];
        readonly responseSchema: z.ZodObject<{
            sha: z.ZodString;
            url: z.ZodOptional<z.ZodString>;
            tree: z.ZodArray<z.ZodObject<{
                path: z.ZodString;
                mode: z.ZodOptional<z.ZodString>;
                type: z.ZodEnum<["blob", "tree", "commit"]>;
                sha: z.ZodString;
                size: z.ZodOptional<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                type: "blob" | "tree" | "commit";
                path: string;
                sha: string;
                size?: number | undefined;
                mode?: string | undefined;
            }, {
                type: "blob" | "tree" | "commit";
                path: string;
                sha: string;
                size?: number | undefined;
                mode?: string | undefined;
            }>, "many">;
            truncated: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            tree: {
                type: "blob" | "tree" | "commit";
                path: string;
                sha: string;
                size?: number | undefined;
                mode?: string | undefined;
            }[];
            sha: string;
            truncated: boolean;
            url?: string | undefined;
        }, {
            tree: {
                type: "blob" | "tree" | "commit";
                path: string;
                sha: string;
                size?: number | undefined;
                mode?: string | undefined;
            }[];
            sha: string;
            truncated: boolean;
            url?: string | undefined;
        }>;
        readonly docs: "https://docs.github.com/en/rest/git/trees#get-a-tree";
    };
    readonly getContents: {
        readonly method: "GET";
        readonly path: "/repos/{owner}/{repo}/contents/{path}";
        readonly description: "Get repository content. Returns file content or directory listing.";
        readonly queryParams: readonly ["ref"];
        readonly responseSchema: z.ZodUnion<[z.ZodObject<{
            type: z.ZodEnum<["file", "dir", "symlink", "submodule"]>;
            name: z.ZodString;
            path: z.ZodString;
            sha: z.ZodString;
            size: z.ZodNumber;
            content: z.ZodOptional<z.ZodString>;
            encoding: z.ZodOptional<z.ZodLiteral<"base64">>;
            download_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            type: "file" | "dir" | "symlink" | "submodule";
            path: string;
            name: string;
            size: number;
            sha: string;
            encoding?: "base64" | undefined;
            content?: string | undefined;
            download_url?: string | null | undefined;
        }, {
            type: "file" | "dir" | "symlink" | "submodule";
            path: string;
            name: string;
            size: number;
            sha: string;
            encoding?: "base64" | undefined;
            content?: string | undefined;
            download_url?: string | null | undefined;
        }>, z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<["file", "dir", "symlink", "submodule"]>;
            name: z.ZodString;
            path: z.ZodString;
            sha: z.ZodString;
            size: z.ZodNumber;
            content: z.ZodOptional<z.ZodString>;
            encoding: z.ZodOptional<z.ZodLiteral<"base64">>;
            download_url: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            type: "file" | "dir" | "symlink" | "submodule";
            path: string;
            name: string;
            size: number;
            sha: string;
            encoding?: "base64" | undefined;
            content?: string | undefined;
            download_url?: string | null | undefined;
        }, {
            type: "file" | "dir" | "symlink" | "submodule";
            path: string;
            name: string;
            size: number;
            sha: string;
            encoding?: "base64" | undefined;
            content?: string | undefined;
            download_url?: string | null | undefined;
        }>, "many">]>;
        readonly docs: "https://docs.github.com/en/rest/repos/contents#get-repository-content";
    };
    readonly getBlob: {
        readonly method: "GET";
        readonly path: "/repos/{owner}/{repo}/git/blobs/{file_sha}";
        readonly description: "Get a blob by SHA. Used for large files (>1MB).";
        readonly responseSchema: z.ZodObject<{
            sha: z.ZodString;
            size: z.ZodNumber;
            content: z.ZodString;
            encoding: z.ZodEnum<["base64", "utf-8"]>;
        }, "strip", z.ZodTypeAny, {
            encoding: "base64" | "utf-8";
            size: number;
            content: string;
            sha: string;
        }, {
            encoding: "base64" | "utf-8";
            size: number;
            content: string;
            sha: string;
        }>;
        readonly docs: "https://docs.github.com/en/rest/git/blobs#get-a-blob";
    };
};
//# sourceMappingURL=schemas.d.ts.map
import { z } from "zod";
const FileTypeEnum = z.enum(["page", "function", "component", "file"]);
const LinkValueSchema = z.union([
    z.string(),
    z.object({
        href: z.string(),
        method: z.string().optional(),
    }),
]);
const LinksSchema = z
    .object({
    self: LinkValueSchema.optional(),
    content: LinkValueSchema.optional(),
    project: LinkValueSchema.optional(),
    files: LinkValueSchema.optional(),
})
    .passthrough();
const BaseFileFields = {
    path: z.string(),
    type: FileTypeEnum,
    size: z.number(),
    updated_at: z.string(),
    _links: LinksSchema.optional(),
};
const VersionedFileFields = {
    id: z.string(),
    version_id: z.string(),
};
const ReleaseMetaFields = {
    release_id: z.string(),
    release_version: z.string().nullable(),
};
const EnvironmentMetaFields = {
    environment_id: z.string(),
    environment_name: z.string(),
    ...ReleaseMetaFields,
};
export const ProjectSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string(),
    description: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    provider: z.string().nullish(),
    provider_id: z.string().nullish(),
    layout: z.string().nullish(),
    layout_id: z.string().nullish(),
    config: z.union([z.string(), z.record(z.unknown())]).optional(),
});
export const ProjectFileSchema = z.object({
    id: z.string().optional(),
    version_id: z.string().optional(),
    path: z.string(),
    content: z.string().optional(),
    size: z.number(),
    type: FileTypeEnum,
    updated_at: z.string(),
});
/**
 * PageInfo for paginated responses.
 * Follows Zalando RESTful API Guidelines #248 with cursor-based pagination.
 * @see https://opensource.zalando.com/restful-api-guidelines/#248
 */
export const PageInfoSchema = z.object({
    self: z.string().nullable(),
    first: z.literal(null),
    next: z.string().nullable(),
    prev: z.string().nullable(),
});
export const EnvironmentSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
});
export const BranchFileListItemSchema = z.object({
    id: z.string().optional(),
    version_id: z.string().optional(),
    content: z.string(),
    ...BaseFileFields,
});
export const ListBranchFilesResponseSchema = z.object({
    data: z.array(BranchFileListItemSchema),
    page_info: PageInfoSchema,
    _links: LinksSchema.optional(),
});
export const BranchFileDetailSchema = z.object({
    id: z.string().optional(),
    version_id: z.string().optional(),
    content: z.string(),
    ...BaseFileFields,
});
export const EnvironmentFileListItemSchema = z.object({
    ...VersionedFileFields,
    content: z.string(),
    ...BaseFileFields,
});
export const ListEnvironmentFilesResponseSchema = z.object({
    data: z.array(EnvironmentFileListItemSchema),
    page_info: PageInfoSchema,
    ...EnvironmentMetaFields,
    _links: LinksSchema.optional(),
});
export const EnvironmentFileDetailSchema = z.object({
    ...VersionedFileFields,
    content: z.string(),
    ...BaseFileFields,
    ...EnvironmentMetaFields,
});
export const ReleaseFileListItemSchema = z.object({
    ...VersionedFileFields,
    content: z.string(),
    ...BaseFileFields,
});
export const ListReleaseFilesResponseSchema = z.object({
    data: z.array(ReleaseFileListItemSchema),
    page_info: PageInfoSchema,
    ...ReleaseMetaFields,
    _links: LinksSchema.optional(),
});
export const ReleaseFileDetailSchema = z.object({
    ...VersionedFileFields,
    content: z.string(),
    ...BaseFileFields,
    ...ReleaseMetaFields,
});
export const ListProjectsResponseSchema = z.object({
    data: z.array(ProjectSchema),
});
export const LookupDomainResponseSchema = z.object({
    project_id: z.string().uuid(),
    project_slug: z.string(),
    project_name: z.string(),
    environment: EnvironmentSchema.nullable(),
    release_id: z.string().uuid().nullable(),
});
export const API_ENDPOINTS = {
    listProjects: {
        method: "GET",
        path: "/projects",
        description: "List all accessible projects",
    },
    getProject: {
        method: "GET",
        path: "/projects/{projectRef}",
        description: "Get project by UUID or slug",
    },
    listBranchFiles: {
        method: "GET",
        path: "/projects/{projectRef}/branches/{branchName}/files",
        description: "List files in a branch (draft/working copy)",
    },
    getBranchFile: {
        method: "GET",
        path: "/projects/{projectRef}/branches/{branchName}/files/{pathOrId}",
        description: "Get file from a branch by path or UUID",
    },
    listEnvironmentFiles: {
        method: "GET",
        path: "/projects/{projectRef}/environments/{environmentName}/files",
        description: "List files from an environment (deployed release)",
    },
    getEnvironmentFile: {
        method: "GET",
        path: "/projects/{projectRef}/environments/{environmentName}/files/{pathOrId}",
        description: "Get file from an environment by path or UUID",
    },
    listReleaseFiles: {
        method: "GET",
        path: "/projects/{projectRef}/releases/{version}/files",
        description: "List files from a specific release",
    },
    getReleaseFile: {
        method: "GET",
        path: "/projects/{projectRef}/releases/{version}/files/{pathOrId}",
        description: "Get file from a release by path or UUID",
    },
    lookupDomain: {
        method: "GET",
        path: "/projects/{domain}",
        description: "Look up project by custom domain (resolved via project_reference)",
    },
};

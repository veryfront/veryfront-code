/**
 * Veryfront API Schemas
 *
 * Zod schemas for runtime validation of API responses.
 *
 * API uses flexible identifiers:
 * - projectReference: UUID or slug (auto-detected)
 * - environmentName: string like "production", "preview", "staging"
 * - branchName: string like "main"
 * - version: "latest" or specific version string
 * - pathOrId: file path (e.g., "pages/index.tsx") or file UUID
 */

import { z } from "zod";

// =============================================================================
// Shared Primitives
// =============================================================================

const FileTypeEnum = z.enum(["page", "function", "component", "file"]);

// Links can be either a string URL or an object with href/method
const LinkValueSchema = z.union([
  z.string(),
  z.object({
    href: z.string(),
    method: z.string().optional(),
  }),
]);

const LinksSchema = z.object({
  self: LinkValueSchema.optional(),
  content: LinkValueSchema.optional(),
  project: LinkValueSchema.optional(),
  files: LinkValueSchema.optional(),
}).passthrough();

// Base fields shared by all file schemas
const BaseFileFields = {
  path: z.string(),
  type: FileTypeEnum,
  size: z.number(),
  updated_at: z.string().optional(),
  _links: LinksSchema.optional(),
};

// =============================================================================
// Base Schemas
// =============================================================================

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  provider: z.string().optional(),
  provider_id: z.string().optional(),
  layout: z.string().optional(),
  layout_id: z.string().optional(),
  config: z.union([z.string(), z.record(z.unknown())]).optional(),
});

export const ProjectFileSchema = z.object({
  id: z.string().optional(),
  version_id: z.string().optional(),
  path: z.string(),
  content: z.string().optional(),
  size: z.number(),
  type: FileTypeEnum,
  updated_at: z.string().optional(),
});

export const PageInfoSchema = z.object({
  has_next_page: z.boolean().optional().default(false),
  end_cursor: z.string().nullable().optional().default(null),
  has_previous_page: z.boolean().optional(),
  start_cursor: z.string().nullable().optional(),
});

export const EnvironmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

// =============================================================================
// Branch Files
// GET /projects/{projectRef}/branches/{branchName}/files[/{pathOrId}]
// =============================================================================

export const BranchFileListItemSchema = z.object({
  id: z.string().optional(),
  content: z.string().optional(),
  ...BaseFileFields,
});

export const ListBranchFilesResponseSchema = z.object({
  data: z.array(BranchFileListItemSchema),
  page_info: PageInfoSchema.optional(),
  _links: LinksSchema.optional(),
});

export const BranchFileDetailSchema = z.object({
  id: z.string().optional(),
  content: z.string(),
  ...BaseFileFields,
});

// =============================================================================
// Environment Files
// GET /projects/{projectRef}/environments/{environmentName}/files[/{pathOrId}]
// =============================================================================

// Shared fields for environment/release responses
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

export const EnvironmentFileListItemSchema = z.object({
  ...VersionedFileFields,
  content: z.string().optional(),
  ...BaseFileFields,
});

export const ListEnvironmentFilesResponseSchema = z.object({
  data: z.array(EnvironmentFileListItemSchema),
  page_info: PageInfoSchema.optional(),
  ...EnvironmentMetaFields,
  _links: LinksSchema.optional(),
});

export const EnvironmentFileDetailSchema = z.object({
  ...VersionedFileFields,
  content: z.string(),
  ...BaseFileFields,
  ...EnvironmentMetaFields,
});

// =============================================================================
// Release Files
// GET /projects/{projectRef}/releases/{version}/files[/{pathOrId}]
// =============================================================================

export const ReleaseFileListItemSchema = z.object({
  ...VersionedFileFields,
  content: z.string().optional(),
  ...BaseFileFields,
});

export const ListReleaseFilesResponseSchema = z.object({
  data: z.array(ReleaseFileListItemSchema),
  page_info: PageInfoSchema.optional(),
  ...ReleaseMetaFields,
  _links: LinksSchema.optional(),
});

export const ReleaseFileDetailSchema = z.object({
  ...VersionedFileFields,
  content: z.string(),
  ...BaseFileFields,
  ...ReleaseMetaFields,
});

// =============================================================================
// Projects
// =============================================================================

export const ListProjectsResponseSchema = z.object({
  data: z.array(ProjectSchema),
});

// =============================================================================
// Domain Lookup
// GET /lookup/domain/{domain}
// =============================================================================

export const LookupDomainResponseSchema = z.object({
  project_id: z.string().uuid(),
  project_slug: z.string(),
  project_name: z.string(),
  environment: EnvironmentSchema.nullable(),
  release_id: z.string().uuid().nullable(),
});

// =============================================================================
// Type Exports
// =============================================================================

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;

export type BranchFileListItem = z.infer<typeof BranchFileListItemSchema>;
export type ListBranchFilesResponse = z.infer<typeof ListBranchFilesResponseSchema>;
export type BranchFileDetail = z.infer<typeof BranchFileDetailSchema>;

export type EnvironmentFileListItem = z.infer<typeof EnvironmentFileListItemSchema>;
export type ListEnvironmentFilesResponse = z.infer<typeof ListEnvironmentFilesResponseSchema>;
export type EnvironmentFileDetail = z.infer<typeof EnvironmentFileDetailSchema>;

export type ReleaseFileListItem = z.infer<typeof ReleaseFileListItemSchema>;
export type ListReleaseFilesResponse = z.infer<typeof ListReleaseFilesResponseSchema>;
export type ReleaseFileDetail = z.infer<typeof ReleaseFileDetailSchema>;

export type LookupDomainResponse = z.infer<typeof LookupDomainResponseSchema>;

// =============================================================================
// Endpoint Registry
// =============================================================================

export const API_ENDPOINTS = {
  listProjects: {
    method: "GET" as const,
    path: "/projects",
    description: "List all accessible projects",
  },
  getProject: {
    method: "GET" as const,
    path: "/projects/{projectRef}",
    description: "Get project by UUID or slug",
  },
  listBranchFiles: {
    method: "GET" as const,
    path: "/projects/{projectRef}/branches/{branchName}/files",
    description: "List files in a branch (draft/working copy)",
  },
  getBranchFile: {
    method: "GET" as const,
    path: "/projects/{projectRef}/branches/{branchName}/files/{pathOrId}",
    description: "Get file from a branch by path or UUID",
  },
  listEnvironmentFiles: {
    method: "GET" as const,
    path: "/projects/{projectRef}/environments/{environmentName}/files",
    description: "List files from an environment (deployed release)",
  },
  getEnvironmentFile: {
    method: "GET" as const,
    path: "/projects/{projectRef}/environments/{environmentName}/files/{pathOrId}",
    description: "Get file from an environment by path or UUID",
  },
  listReleaseFiles: {
    method: "GET" as const,
    path: "/projects/{projectRef}/releases/{version}/files",
    description: "List files from a specific release",
  },
  getReleaseFile: {
    method: "GET" as const,
    path: "/projects/{projectRef}/releases/{version}/files/{pathOrId}",
    description: "Get file from a release by path or UUID",
  },
  lookupDomain: {
    method: "GET" as const,
    path: "/lookup/domain/{domain}",
    description: "Look up project by custom domain",
  },
} as const;

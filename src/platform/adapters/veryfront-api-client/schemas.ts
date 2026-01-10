/**
 * Veryfront API Schemas
 *
 * Zod schemas for runtime validation of API responses.
 * This file serves as documentation for all API endpoints.
 */

import { z } from "zod";

// =============================================================================
// Base Schemas
// =============================================================================

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  provider: z.string().optional(),
  layout: z.string().optional(),
  config: z.string().optional(),
});

export const ProjectFileSchema = z.object({
  id: z.string().optional(), // Entity UUID - available when fetched from veryfront-api
  path: z.string(),
  size: z.number(),
  type: z.string(),
  mimeType: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  hasMore: z.boolean(),
});

export const PageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable(),
});

export const EnvironmentSchema = z.object({
  id: z.string(),
  name: z.string(),
});

// =============================================================================
// API Endpoints
// =============================================================================

/**
 * GET /projects
 * List all projects accessible to the authenticated user.
 */
export const ListProjectsResponseSchema = z.object({
  data: z.array(ProjectSchema),
});

/**
 * GET /projects/:id
 * Get a single project by ID.
 */
export const GetProjectResponseSchema = ProjectSchema;

/**
 * GET /projects/:id/files
 * List files in a project (draft/working copy).
 *
 * Query params:
 * - limit: number (default 100)
 * - cursor: string (pagination)
 * - branch: string (git branch)
 * - pattern: string (search pattern)
 * - sortBy: "updatedAt" | "path"
 * - sortOrder: "asc" | "desc"
 */
export const ListFilesResponseSchema = z.object({
  data: z.array(ProjectFileSchema),
  pageInfo: PageInfoSchema.optional(),
  pagination: PaginationSchema.optional(),
});

/**
 * GET /projects/:id/files/:path
 * Get file content from draft/working copy.
 *
 * Query params:
 * - branch: string (git branch)
 */
export const GetFileContentResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
});

/**
 * GET /projects/:id/published/files
 * List published files from a release (production).
 *
 * Query params:
 * - releaseId: string (specific release, defaults to latest)
 */
export const ListPublishedFilesResponseSchema = z.object({
  data: z.array(ProjectFileSchema),
  releaseId: z.string(),
});

/**
 * GET /projects/:id/published/files/:path
 * Get published file content from a release.
 *
 * Query params:
 * - releaseId: string (specific release, defaults to latest)
 */
export const GetPublishedFileContentResponseSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
  versionId: z.string(),
  releaseId: z.string(),
});

/**
 * GET /lookup/domain/:domain
 * Look up project info by custom domain.
 * Used for JIT rendering of custom domain production sites.
 */
export const LookupDomainResponseSchema = z.object({
  projectId: z.string(),
  projectSlug: z.string(),
  projectName: z.string(),
  environment: EnvironmentSchema.nullable(),
  releaseId: z.string().nullable(),
});

/**
 * GET /projects/:slug/components/:entityId
 * Get component/entity info by UUID.
 * Used to resolve layout/provider UUIDs to file paths.
 */
export const GetComponentResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  importPath: z.string(),
  body: z.string().optional(),
});

// =============================================================================
// Type Exports (inferred from schemas)
// =============================================================================

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;

export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>;
export type GetProjectResponse = z.infer<typeof GetProjectResponseSchema>;
export type ListFilesResponse = z.infer<typeof ListFilesResponseSchema>;
export type GetFileContentResponse = z.infer<typeof GetFileContentResponseSchema>;
export type ListPublishedFilesResponse = z.infer<typeof ListPublishedFilesResponseSchema>;
export type GetPublishedFileContentResponse = z.infer<typeof GetPublishedFileContentResponseSchema>;
export type LookupDomainResponse = z.infer<typeof LookupDomainResponseSchema>;
export type GetComponentResponse = z.infer<typeof GetComponentResponseSchema>;

// =============================================================================
// Endpoint Registry (for documentation/tooling)
// =============================================================================

export const API_ENDPOINTS = {
  listProjects: {
    method: "GET" as const,
    path: "/projects",
    description: "List all projects accessible to the authenticated user",
    responseSchema: ListProjectsResponseSchema,
  },
  getProject: {
    method: "GET" as const,
    path: "/projects/:id",
    description: "Get a single project by ID",
    responseSchema: GetProjectResponseSchema,
  },
  listFiles: {
    method: "GET" as const,
    path: "/projects/:id/files",
    description: "List files in a project (draft/working copy)",
    queryParams: ["limit", "cursor", "branch", "pattern", "sortBy", "sortOrder"],
    responseSchema: ListFilesResponseSchema,
  },
  getFileContent: {
    method: "GET" as const,
    path: "/projects/:id/files/:path",
    description: "Get file content from draft/working copy",
    queryParams: ["branch"],
    responseSchema: GetFileContentResponseSchema,
  },
  listPublishedFiles: {
    method: "GET" as const,
    path: "/projects/:id/published/files",
    description: "List published files from a release (production)",
    queryParams: ["releaseId"],
    responseSchema: ListPublishedFilesResponseSchema,
  },
  getPublishedFileContent: {
    method: "GET" as const,
    path: "/projects/:id/published/files/:path",
    description: "Get published file content from a release",
    queryParams: ["releaseId"],
    responseSchema: GetPublishedFileContentResponseSchema,
  },
  lookupDomain: {
    method: "GET" as const,
    path: "/lookup/domain/:domain",
    description: "Look up project info by custom domain",
    responseSchema: LookupDomainResponseSchema,
  },
  getComponent: {
    method: "GET" as const,
    path: "/projects/:slug/components/:entityId",
    description: "Get component/entity info by UUID",
    responseSchema: GetComponentResponseSchema,
  },
} as const;

import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "veryfront/extensions/schema";

// ---------------------------------------------------------------------------
// Shape-fragment helpers
//
// These take a `SchemaValidator` and return either a `Schema<T>` or a plain
// shape object whose values are `Schema<T>` instances. They exist because the
// SchemaValidator contract is only available inside a `defineSchema` factory
// — fragments cannot be materialized at module scope.
// ---------------------------------------------------------------------------

const fileTypeEnum = (v: SchemaValidator) =>
  v.enum(["page", "function", "component", "file"] as const);

const linkValueSchema = (v: SchemaValidator) =>
  v.union([
    v.string(),
    v.object({
      href: v.string(),
      method: v.string().optional(),
    }),
  ]);

const linksSchema = (v: SchemaValidator) =>
  v
    .object({
      self: linkValueSchema(v).optional(),
      content: linkValueSchema(v).optional(),
      project: linkValueSchema(v).optional(),
      files: linkValueSchema(v).optional(),
    })
    .passthrough();

const baseFileFields = (v: SchemaValidator) => ({
  path: v.string(),
  type: fileTypeEnum(v),
  size: v.number(),
  updated_at: v.string(),
  _links: linksSchema(v).optional(),
});

const versionedFileFields = (v: SchemaValidator) => ({
  id: v.string(),
  version_id: v.string(),
});

const releaseMetaFields = (v: SchemaValidator) => ({
  release_id: v.string(),
  release_version: v.string().nullable(),
});

const environmentMetaFields = (v: SchemaValidator) => ({
  environment_id: v.string(),
  environment_name: v.string(),
  ...releaseMetaFields(v),
});

const branchFileFields = (v: SchemaValidator) => ({
  id: v.string().optional(),
  version_id: v.string().optional(),
  content: v.string(),
  ...baseFileFields(v),
});

const versionedFileWithContentFields = (v: SchemaValidator) => ({
  ...versionedFileFields(v),
  content: v.string(),
  ...baseFileFields(v),
});

// ---------------------------------------------------------------------------
// Exported schema getters
// ---------------------------------------------------------------------------

export const getProjectSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string(),
    slug: v.string(),
    description: v.string().optional(),
    created_at: v.string().optional(),
    updated_at: v.string().optional(),
    provider: v.string().nullish(),
    provider_id: v.string().nullish(),
    layout: v.string().nullish(),
    layout_id: v.string().nullish(),
    config: v.union([v.string(), v.record(v.string(), v.unknown())]).optional(),
  })
);

export const getProjectFileSchema = defineSchema((v) =>
  v.object({
    id: v.string().optional(),
    version_id: v.string().optional(),
    path: v.string(),
    content: v.string().optional(),
    size: v.number(),
    type: fileTypeEnum(v),
    updated_at: v.string(),
  })
);

/**
 * PageInfo for paginated responses.
 * Follows Zalando RESTful API Guidelines #248 with cursor-based pagination.
 * @see https://opensource.zalando.com/restful-api-guidelines/#248
 */
export const getPageInfoSchema = defineSchema((v) =>
  v.object({
    self: v.string().nullable(),
    first: v.literal(null),
    next: v.string().nullable(),
    prev: v.string().nullable(),
  })
);

export const getEnvironmentSchema = defineSchema((v) =>
  v.object({
    id: v.string().uuid(),
    name: v.string(),
  })
);

export const getBranchFileListItemSchema = defineSchema((v) => v.object(branchFileFields(v)));

export const getListBranchFilesResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getBranchFileListItemSchema()),
    page_info: getPageInfoSchema(),
    _links: linksSchema(v).optional(),
  })
);

export const getBranchFileDetailSchema = defineSchema((v) => v.object(branchFileFields(v)));

export const getEnvironmentFileListItemSchema = defineSchema((v) =>
  v.object(versionedFileWithContentFields(v))
);

export const getListEnvironmentFilesResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getEnvironmentFileListItemSchema()),
    page_info: getPageInfoSchema(),
    ...environmentMetaFields(v),
    _links: linksSchema(v).optional(),
  })
);

export const getEnvironmentFileDetailSchema = defineSchema((v) =>
  v.object({
    ...versionedFileWithContentFields(v),
    ...environmentMetaFields(v),
  })
);

export const getReleaseFileListItemSchema = defineSchema((v) =>
  v.object(versionedFileWithContentFields(v))
);

export const getListReleaseFilesResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getReleaseFileListItemSchema()),
    page_info: getPageInfoSchema(),
    ...releaseMetaFields(v),
    _links: linksSchema(v).optional(),
  })
);

export const getReleaseFileDetailSchema = defineSchema((v) =>
  v.object({
    ...versionedFileWithContentFields(v),
    ...releaseMetaFields(v),
  })
);

export const getListProjectsResponseSchema = defineSchema((v) =>
  v.object({
    data: v.array(getProjectSchema()),
  })
);

export const getLookupDomainResponseSchema = defineSchema((v) =>
  v.object({
    project_id: v.string().uuid(),
    project_slug: v.string(),
    project_name: v.string(),
    environment: getEnvironmentSchema().nullable(),
    release_id: v.string().uuid().nullable(),
  })
);

export const getStyleArtifactResolveResponseSchema = defineSchema((v) =>
  v.object({
    status: v.enum(["ready", "missing", "building", "failed"] as const),
    artifact_hash: v.string().optional(),
    asset_path: v.string().optional(),
    etag: v.string().optional(),
    content_type: v.string().optional(),
    build_run_id: v.string().optional(),
    failure_reason: v.string().optional(),
    updated_at: v.string().optional(),
  })
);

export const getReleaseAssetManifestBuildResponseSchema = defineSchema((v) =>
  v.object({
    id: v.string(),
    manifest_version: v.number(),
    state: v.enum(
      [
        "queued",
        "building",
        "partial",
        "ready",
        "failed",
        "superseded",
      ] as const,
    ),
  })
);

export const getReleaseAssetUploadResponseSchema = defineSchema((v) =>
  v.object({
    stored: v.boolean(),
    existed: v.boolean(),
  })
);

export const getReleaseAssetManifestStateResponseSchema = defineSchema((v) =>
  v.object({
    state: v.enum(
      [
        "queued",
        "building",
        "partial",
        "ready",
        "failed",
        "superseded",
      ] as const,
    ),
    manifest_version: v.number().optional(),
  })
);

export const getReleaseAssetManifestResponseSchema = defineSchema((v) =>
  v.object({
    state: v.enum(
      [
        "queued",
        "building",
        "partial",
        "ready",
        "failed",
        "superseded",
      ] as const,
    ),
    manifest_version: v.number(),
    manifest: v.union([v.record(v.string(), v.unknown()), v.null()]),
  })
);

/**
 * Project schema extended with the `environments` array — used by the
 * domain-lookup endpoint which returns a project plus its environments.
 *
 * Lifted out of `operations.ts` so the inline `extend()` no longer needs to
 * import the SchemaValidator at the callsite.
 */
export const getProjectWithEnvironmentsSchema = defineSchema((v) =>
  getProjectSchema().extend({
    environments: v
      .array(
        v.object({
          id: v.string().uuid(),
          name: v.string(),
          domains: v.array(v.string()).optional(),
          active_release_id: v.string().uuid().nullable().optional(),
        }),
      )
      .optional(),
  })
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Project = InferSchema<ReturnType<typeof getProjectSchema>>;
export type ProjectFile = InferSchema<ReturnType<typeof getProjectFileSchema>>;
export type PageInfo = InferSchema<ReturnType<typeof getPageInfoSchema>>;
export type Environment = InferSchema<ReturnType<typeof getEnvironmentSchema>>;

export type BranchFileListItem = InferSchema<ReturnType<typeof getBranchFileListItemSchema>>;
export type ListBranchFilesResponse = InferSchema<
  ReturnType<typeof getListBranchFilesResponseSchema>
>;
export type BranchFileDetail = InferSchema<ReturnType<typeof getBranchFileDetailSchema>>;

export type EnvironmentFileListItem = InferSchema<
  ReturnType<typeof getEnvironmentFileListItemSchema>
>;
export type ListEnvironmentFilesResponse = InferSchema<
  ReturnType<typeof getListEnvironmentFilesResponseSchema>
>;
export type EnvironmentFileDetail = InferSchema<ReturnType<typeof getEnvironmentFileDetailSchema>>;

export type ReleaseFileListItem = InferSchema<ReturnType<typeof getReleaseFileListItemSchema>>;
export type ListReleaseFilesResponse = InferSchema<
  ReturnType<typeof getListReleaseFilesResponseSchema>
>;
export type ReleaseFileDetail = InferSchema<ReturnType<typeof getReleaseFileDetailSchema>>;

export type LookupDomainResponse = InferSchema<ReturnType<typeof getLookupDomainResponseSchema>>;
export type StyleArtifactResolveResponse = InferSchema<
  ReturnType<typeof getStyleArtifactResolveResponseSchema>
>;

export type ReleaseAssetManifestBuildResponse = InferSchema<
  ReturnType<typeof getReleaseAssetManifestBuildResponseSchema>
>;
export type ReleaseAssetUploadResponse = InferSchema<
  ReturnType<typeof getReleaseAssetUploadResponseSchema>
>;
export type ReleaseAssetManifestStateResponse = InferSchema<
  ReturnType<typeof getReleaseAssetManifestStateResponseSchema>
>;
export type ReleaseAssetManifestApiResponse = InferSchema<
  ReturnType<typeof getReleaseAssetManifestResponseSchema>
>;

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
    path: "/projects/{projectRef}/files?branch={branchRef}",
    description: "List files for a branch ref or name (omit branch for main branch)",
  },
  getBranchFile: {
    method: "GET" as const,
    path: "/projects/{projectRef}/files/{pathOrId}?branch={branchRef}",
    description: "Get file from a branch ref or name by path or UUID",
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
    path: "/projects/{domain}",
    description: "Look up project by custom domain (resolved via project_reference)",
  },
  resolveStyleArtifact: {
    method: "GET" as const,
    path: "/projects/{projectRef}/style-artifacts/current",
    description:
      "Resolve metadata for the latest ready style artifact for a branch, environment, or release selector",
  },
  ensureStyleArtifactBuild: {
    method: "POST" as const,
    path: "/projects/{projectRef}/style-artifacts/current/builds",
    description:
      "Ensure a background style artifact build exists for a branch, environment, or release selector",
  },
} as const;

/**
 * Adapters - Veryfront Api Client
 *
 * @module platform/adapters/veryfront-api-client
 */

export {
  type FileContext,
  type GetDependencyHistoryInput,
  VeryfrontApiClient,
  type VeryfrontApiDependencies,
} from "./client.ts";
export type {
  DependencyMetadataHistory,
  DependencyMetadataHistoryEntry,
} from "../dependency-metadata-history.ts";
export {
  type DependencyResolution,
  type DependencySkipReason,
  type EnsureStyleArtifactBuildInput,
  type FileDetail,
  type FileListResult,
  type ListFilesOptions,
  type ProjectStyleArtifactResolution,
  type ResolveDependenciesInput,
  type ResolveStyleArtifactInput,
  type StyleArtifactSelector,
  type UpsertStyleArtifactInput,
  VeryfrontAPIOperations,
} from "./operations.ts";
export { type RequestOptions, requestWithRetry, type RetryConfig } from "./retry-handler.ts";
export {
  API_CLIENT_ERROR,
  type Environment,
  type LookupDomainResponse,
  type PageInfo,
  type Project,
  type ProjectFile,
  type VeryfrontAPIConfig,
  VeryfrontError,
} from "./types.ts";
export {
  API_ENDPOINTS,
  getBranchFileDetailSchema,
  getBranchFileListItemSchema,
  getEnvironmentFileDetailSchema,
  getEnvironmentFileListItemSchema,
  getEnvironmentSchema,
  getListBranchFilesResponseSchema,
  getListEnvironmentFilesResponseSchema,
  getListProjectsResponseSchema,
  getListReleaseFilesResponseSchema,
  getLookupDomainResponseSchema,
  getPageInfoSchema,
  getProjectFileSchema,
  getProjectSchema,
  getProjectWithEnvironmentsSchema,
  getReleaseFileDetailSchema,
  getReleaseFileListItemSchema,
  getStyleArtifactResolveResponseSchema,
  type StyleArtifactResolveResponse,
} from "./schemas/index.ts";

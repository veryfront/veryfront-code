import { logger } from "@veryfront/utils";
import { requestWithRetry, type RetryConfig } from "./retry-handler.ts";
import { VeryfrontAPIError } from "./types.ts";
import {
  BranchFileDetailSchema,
  EnvironmentFileDetailSchema,
  ListBranchFilesResponseSchema,
  ListEnvironmentFilesResponseSchema,
  ListProjectsResponseSchema,
  ListReleaseFilesResponseSchema,
  type LookupDomainResponse,
  LookupDomainResponseSchema,
  type Project,
  type ProjectFile,
  ProjectSchema,
  ReleaseFileDetailSchema,
} from "./schemas.ts";

/**
 * Token provider function - can return static token or dynamic per-request token.
 */
export type TokenProvider = () => string;

/**
 * Options for listing files.
 */
export interface ListFilesOptions {
  cursor?: string;
  limit?: number;
  pattern?: string;
  sortBy?: "path" | "updatedAt";
  sortOrder?: "asc" | "desc";
}

/**
 * Result of listing files with pagination info.
 */
export interface FileListResult {
  files: ProjectFile[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
    hasPreviousPage?: boolean;
    startCursor?: string | null;
  };
  releaseId?: string;
  releaseVersion?: string | null;
  environmentId?: string;
  environmentName?: string;
}

/**
 * File detail with content.
 */
export interface FileDetail {
  path: string;
  content: string;
  id?: string;
  versionId?: string;
  type?: string;
  size?: number;
  releaseId?: string;
  releaseVersion?: string | null;
}

// =============================================================================
// Internal Helpers
// =============================================================================

function buildListParams(options: ListFilesOptions): URLSearchParams {
  const { cursor, limit = 100, pattern, sortBy = "updatedAt", sortOrder = "desc" } = options;
  const params = new URLSearchParams({ limit: String(limit), sortBy, sortOrder });
  if (cursor) params.set("cursor", cursor);
  if (pattern) params.set("pattern", pattern);
  return params;
}

export class VeryfrontAPIOperations {
  private tokenProvider: TokenProvider;

  constructor(
    private apiBaseUrl: string,
    tokenOrProvider: string | TokenProvider,
    private retryConfig: RetryConfig,
    private projectId?: string,
  ) {
    this.tokenProvider = typeof tokenOrProvider === "string"
      ? () => tokenOrProvider
      : tokenOrProvider;
  }

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  getToken(): string {
    return this.tokenProvider();
  }

  setProjectId(projectId: string): void {
    this.projectId = projectId;
  }

  getProjectId(): string {
    if (!this.projectId) {
      throw new VeryfrontAPIError(
        "Veryfront API client not initialized. Call initialize() with a project ID first.",
      );
    }
    return this.projectId;
  }

  // =============================================================================
  // Project Operations
  // =============================================================================

  async listProjects(): Promise<Project[]> {
    const raw = await this.request("/projects");
    const response = ListProjectsResponseSchema.parse(raw);
    return response.data;
  }

  async getProject(projectRef: string): Promise<Project> {
    const raw = await this.request(`/projects/${encodeURIComponent(projectRef)}`);
    return ProjectSchema.parse(raw);
  }

  // =============================================================================
  // Branch Files (draft/working copy for Studio editing)
  // Endpoint: /projects/{projectRef}/branches/{branchName}/files[/{pathOrId}]
  // =============================================================================

  /**
   * List files from a branch (draft/working copy).
   */
  async listBranchFiles(
    projectRef: string,
    branchName = "main",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = buildListParams(options);
    const url = `/projects/${encodeURIComponent(projectRef)}/branches/${
      encodeURIComponent(branchName)
    }/files?${params}`;
    logger.debug("[API] listBranchFiles", { projectRef, branchName, pattern: options.pattern });

    const raw = await this.request(url);
    const response = ListBranchFilesResponseSchema.parse(raw);

    return {
      files: response.data.map((f) => ({
        id: f.id,
        path: f.path,
        content: f.content,
        type: f.type,
        size: f.size,
        updatedAt: f.updatedAt,
      })),
      pageInfo: response.pageInfo,
    };
  }

  /**
   * List all files from a branch using pagination.
   */
  async listAllBranchFiles(
    projectRef: string,
    branchName = "main",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ): Promise<ProjectFile[]> {
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.listBranchFiles(projectRef, branchName, {
        ...options,
        cursor,
        limit: 10000,
      });
      allFiles.push(...result.files);
      cursor = result.pageInfo.hasNextPage ? (result.pageInfo.endCursor ?? undefined) : undefined;
    } while (cursor);

    return allFiles;
  }

  /**
   * Get a file from a branch by path or UUID.
   */
  async getBranchFile(
    projectRef: string,
    branchName: string,
    pathOrId: string,
  ): Promise<FileDetail> {
    const url = `/projects/${encodeURIComponent(projectRef)}/branches/${
      encodeURIComponent(branchName)
    }/files/${encodeURIComponent(pathOrId)}`;
    logger.debug("[API] getBranchFile", { projectRef, branchName, pathOrId });

    const raw = await this.request(url);
    const response = BranchFileDetailSchema.parse(raw);

    return {
      path: response.path,
      content: response.content,
      id: response.id,
      type: response.type,
      size: response.size,
    };
  }

  // =============================================================================
  // Environment Files (deployed content - production, preview, staging)
  // Endpoint: /projects/{projectRef}/environments/{environmentName}/files[/{pathOrId}]
  // =============================================================================

  /**
   * List files from an environment (deployed release).
   */
  async listEnvironmentFiles(
    projectRef: string,
    environmentName = "production",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = buildListParams(options);
    const url = `/projects/${encodeURIComponent(projectRef)}/environments/${
      encodeURIComponent(environmentName)
    }/files?${params}`;
    logger.debug("[API] listEnvironmentFiles", {
      projectRef,
      environmentName,
      pattern: options.pattern,
    });

    const raw = await this.request(url);
    const response = ListEnvironmentFilesResponseSchema.parse(raw);

    return {
      files: response.data.map((f) => ({
        id: f.id,
        versionId: f.versionId,
        path: f.path,
        content: f.content,
        type: f.type,
        size: f.size,
        updatedAt: f.updatedAt,
      })),
      pageInfo: response.pageInfo,
      releaseId: response.releaseId,
      releaseVersion: response.releaseVersion,
      environmentId: response.environmentId,
      environmentName: response.environmentName,
    };
  }

  /**
   * List all files from an environment using pagination.
   */
  async listAllEnvironmentFiles(
    projectRef: string,
    environmentName = "production",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ): Promise<ProjectFile[]> {
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.listEnvironmentFiles(projectRef, environmentName, {
        ...options,
        cursor,
        limit: 10000,
      });
      allFiles.push(...result.files);
      cursor = result.pageInfo.hasNextPage ? (result.pageInfo.endCursor ?? undefined) : undefined;
    } while (cursor);

    logger.debug("[API] listAllEnvironmentFiles", {
      projectRef,
      environmentName,
      totalFiles: allFiles.length,
    });

    return allFiles;
  }

  /**
   * Get a file from an environment by path or UUID.
   */
  async getEnvironmentFile(
    projectRef: string,
    environmentName: string,
    pathOrId: string,
  ): Promise<FileDetail> {
    const url = `/projects/${encodeURIComponent(projectRef)}/environments/${
      encodeURIComponent(environmentName)
    }/files/${encodeURIComponent(pathOrId)}`;
    logger.debug("[API] getEnvironmentFile", { projectRef, environmentName, pathOrId });

    const raw = await this.request(url);
    const response = EnvironmentFileDetailSchema.parse(raw);

    return {
      path: response.path,
      content: response.content,
      id: response.id,
      versionId: response.versionId,
      releaseId: response.releaseId,
      releaseVersion: response.releaseVersion,
    };
  }

  // =============================================================================
  // Release Files (specific version for rollbacks/comparisons)
  // Endpoint: /projects/{projectRef}/releases/{version}/files[/{pathOrId}]
  // =============================================================================

  /**
   * List files from a specific release.
   */
  async listReleaseFiles(
    projectRef: string,
    version = "latest",
    options: ListFilesOptions = {},
  ): Promise<FileListResult> {
    const params = buildListParams(options);
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/files?${params}`;
    logger.debug("[API] listReleaseFiles", { projectRef, version, pattern: options.pattern });

    const raw = await this.request(url);
    const response = ListReleaseFilesResponseSchema.parse(raw);

    return {
      files: response.data.map((f) => ({
        id: f.id,
        versionId: f.versionId,
        path: f.path,
        content: f.content,
        type: f.type,
        size: f.size,
        updatedAt: f.updatedAt,
      })),
      pageInfo: response.pageInfo,
      releaseId: response.releaseId,
      releaseVersion: response.releaseVersion,
    };
  }

  /**
   * List all files from a release using pagination.
   */
  async listAllReleaseFiles(
    projectRef: string,
    version = "latest",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ): Promise<ProjectFile[]> {
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    do {
      const result = await this.listReleaseFiles(projectRef, version, {
        ...options,
        cursor,
        limit: 10000,
      });
      allFiles.push(...result.files);
      cursor = result.pageInfo.hasNextPage ? (result.pageInfo.endCursor ?? undefined) : undefined;
    } while (cursor);

    return allFiles;
  }

  /**
   * Get a file from a release by path or UUID.
   */
  async getReleaseFile(
    projectRef: string,
    version: string,
    pathOrId: string,
  ): Promise<FileDetail> {
    const url = `/projects/${encodeURIComponent(projectRef)}/releases/${
      encodeURIComponent(version)
    }/files/${encodeURIComponent(pathOrId)}`;
    logger.debug("[API] getReleaseFile", { projectRef, version, pathOrId });

    const raw = await this.request(url);
    const response = ReleaseFileDetailSchema.parse(raw);

    return {
      path: response.path,
      content: response.content,
      id: response.id,
      versionId: response.versionId,
      releaseId: response.releaseId,
      releaseVersion: response.releaseVersion,
    };
  }

  // =============================================================================
  // Domain Lookup
  // =============================================================================

  /**
   * Look up project info by custom domain.
   * Returns project details and environment info for routing.
   */
  async lookupProjectByDomain(domain: string): Promise<LookupDomainResponse | null> {
    const url = `/lookup/domain/${encodeURIComponent(domain)}`;
    logger.debug("[API] lookupProjectByDomain", { domain });

    try {
      const raw = await this.request(url);
      const response = LookupDomainResponseSchema.parse(raw);

      logger.debug("[API] Domain lookup result", {
        domain,
        projectSlug: response.projectSlug,
        environment: response.environment?.name,
      });

      return response;
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        logger.debug("[API] No project found for domain", { domain });
        return null;
      }
      throw error;
    }
  }

  // =============================================================================
  // Internal
  // =============================================================================

  private async request(endpoint: string): Promise<unknown> {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const token = this.tokenProvider();
    return await requestWithRetry(url, token, this.retryConfig);
  }
}

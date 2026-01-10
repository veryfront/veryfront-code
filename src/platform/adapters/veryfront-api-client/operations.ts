import { logger } from "@veryfront/utils";
import { requestWithRetry, type RetryConfig } from "./retry-handler.ts";
import {
  type ListFilesResponse,
  type ListProjectsResponse,
  type Project,
  type ProjectFile,
  VeryfrontAPIError,
} from "./types.ts";

/**
 * Token provider function - can return static token or dynamic per-request token.
 */
export type TokenProvider = () => string;

export class VeryfrontAPIOperations {
  private tokenProvider: TokenProvider;

  constructor(
    private apiBaseUrl: string,
    tokenOrProvider: string | TokenProvider,
    private retryConfig: RetryConfig,
    private projectId?: string,
  ) {
    // Support both static token string and dynamic token provider
    this.tokenProvider = typeof tokenOrProvider === "string"
      ? () => tokenOrProvider
      : tokenOrProvider;
  }

  /**
   * Update the token provider for dynamic token resolution.
   * Used when proxy provides per-request tokens via headers.
   */
  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  /**
   * Get the current token.
   */
  getToken(): string {
    return this.tokenProvider();
  }

  setProjectId(projectId: string): void {
    this.projectId = projectId;
  }

  getProjectId(): string {
    if (!this.projectId) {
      const errorMsg =
        "Veryfront API client not initialized. Call initialize() with a project ID first.";
      logger.error("[Veryfront API]", errorMsg);
      throw new VeryfrontAPIError(errorMsg);
    }
    return this.projectId;
  }

  async listProjects(): Promise<Project[]> {
    const response = await this.request<ListProjectsResponse>("/projects");
    return response.data;
  }

  async getProject(projectId: string): Promise<Project> {
    return await this.request<Project>(`/projects/${projectId}`);
  }

  async listFiles(
    projectId?: string,
    cursor?: string,
    limit = 100,
    branch?: string | null,
  ): Promise<ListFilesResponse> {
    const id = projectId || this.getProjectId();
    const params = new URLSearchParams({
      limit: String(limit),
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }
    if (branch) {
      params.set("branch", branch);
    }
    const url = `/projects/${id}/files?${params}`;
    logger.debug("[VeryfrontAPIClient] Listing files", {
      url,
      projectId: id,
      limit,
      cursor,
      branch,
    });

    // veryfront-api returns pageInfo, we need to map it to pagination
    const response = await this.request<{
      data: ProjectFile[];
      pageInfo?: { hasNextPage: boolean; nextCursor: string | null };
      pagination?: { cursor?: string; hasMore: boolean };
    }>(url);

    // Map pageInfo to pagination format if needed
    const pagination = response.pagination || (response.pageInfo
      ? {
        cursor: response.pageInfo.nextCursor || undefined,
        hasMore: response.pageInfo.hasNextPage,
      }
      : undefined);

    logger.debug("[VeryfrontAPIClient] Files listed", {
      count: response.data?.length || 0,
      hasMore: pagination?.hasMore,
    });

    return { data: response.data, pagination };
  }

  async listAllFiles(projectId?: string, branch?: string | null): Promise<ProjectFile[]> {
    const id = projectId || this.getProjectId();
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    // Use high limit (10000) to minimize API calls for large projects
    do {
      const response = await this.listFiles(id, cursor, 10000, branch);
      allFiles.push(...response.data);
      cursor = response.pagination?.hasMore ? response.pagination.cursor : undefined;
    } while (cursor);

    return allFiles;
  }

  async searchFiles(
    pattern: string,
    projectId?: string,
    branch?: string | null,
  ): Promise<ProjectFile[]> {
    const id = projectId || this.getProjectId();
    const params = new URLSearchParams({
      pattern,
      limit: "100",
    });
    if (branch) {
      params.set("branch", branch);
    }
    const url = `/projects/${id}/files?${params}`;
    logger.debug("[VeryfrontAPIClient] Searching files", { url, pattern, projectId: id, branch });

    const response = await this.request<{
      data: ProjectFile[];
      pageInfo?: { hasNextPage: boolean; nextCursor: string | null };
    }>(url);

    logger.debug("[VeryfrontAPIClient] Files search complete", {
      pattern,
      count: response.data?.length || 0,
    });

    return response.data || [];
  }

  async getFileContent(path: string, projectId?: string, branch?: string | null): Promise<string> {
    const id = projectId || this.getProjectId();
    const encodedPath = encodeURIComponent(path);

    // Build URL with optional branch query param
    let url = `/projects/${id}/files/${encodedPath}`;
    if (branch) {
      url += `?branch=${encodeURIComponent(branch)}`;
    }

    // veryfront-api returns { path, content, size } as JSON
    // We need to extract the content field
    const response = await this.request<{ path: string; content: string; size: number } | string>(
      url,
    );

    // Handle both JSON response and raw text response
    if (typeof response === "string") {
      return response;
    }
    return response.content;
  }

  async getFileMetadata(path: string, projectId?: string): Promise<ProjectFile | null> {
    const id = projectId || this.getProjectId();

    const files = await this.listAllFiles(id);
    return files.find((f) => f.path === path) || null;
  }

  async fileExists(path: string, projectId?: string): Promise<boolean> {
    const metadata = await this.getFileMetadata(path, projectId);
    return metadata !== null;
  }

  /**
   * List all published files from a release.
   * Used for production rendering (JIT mode).
   */
  async listPublishedFiles(
    projectId?: string,
    releaseId?: string,
  ): Promise<ProjectFile[]> {
    const id = projectId || this.getProjectId();

    let url = `/projects/${id}/published/files`;
    if (releaseId) {
      url += `?releaseId=${encodeURIComponent(releaseId)}`;
    }

    logger.debug("[VeryfrontAPIClient] Listing published files", { url, projectId: id, releaseId });

    const response = await this.request<{
      data: ProjectFile[];
      releaseId: string;
    }>(url);

    return response.data || [];
  }

  /**
   * Get published file content from a release.
   * Used for production rendering (JIT mode).
   */
  async getPublishedFileContent(
    path: string,
    projectId?: string,
    releaseId?: string,
  ): Promise<string> {
    const id = projectId || this.getProjectId();
    const encodedPath = encodeURIComponent(path);

    let url = `/projects/${id}/published/files/${encodedPath}`;
    if (releaseId) {
      url += `?releaseId=${encodeURIComponent(releaseId)}`;
    }

    logger.debug("[VeryfrontAPIClient] Getting published file content", { url, path, releaseId });

    const response = await this.request<{
      path: string;
      content: string;
      size: number;
      versionId: string;
      releaseId: string;
    }>(url);

    return response.content;
  }

  /**
   * Look up project info by custom domain.
   * Used for JIT rendering of custom domain production sites.
   */
  async lookupProjectByDomain(domain: string): Promise<
    {
      projectId: string;
      projectSlug: string;
      projectName: string;
      environment: { id: string; name: string } | null;
      releaseId: string | null;
    } | null
  > {
    const encodedDomain = encodeURIComponent(domain);
    const url = `/lookup/domain/${encodedDomain}`;

    logger.debug("[VeryfrontAPIClient] Looking up project by domain", { domain });

    try {
      const response = await this.request<{
        projectId: string;
        projectSlug: string;
        projectName: string;
        environment: { id: string; name: string } | null;
        releaseId: string | null;
      }>(url);

      logger.debug("[VeryfrontAPIClient] Domain lookup result", {
        domain,
        projectSlug: response.projectSlug,
        environment: response.environment?.name,
      });

      return response;
    } catch (error) {
      // 404 means no project found for domain
      if (error instanceof Error && error.message.includes("404")) {
        logger.debug("[VeryfrontAPIClient] No project found for domain", { domain });
        return null;
      }
      throw error;
    }
  }

  /**
   * Get component/entity info by UUID.
   * Used to resolve layout/provider UUIDs to file paths.
   * Note: This endpoint uses project slug, not project ID.
   */
  async getComponentByEntityId(
    entityId: string,
    projectSlug: string,
  ): Promise<{ id: string; path: string; importPath: string; body?: string } | null> {
    const url = `/projects/${projectSlug}/components/${entityId}`;

    logger.info("[VeryfrontAPIClient] Getting component by entity ID", {
      entityId,
      projectSlug,
      url,
    });

    try {
      const response = await this.request<{
        id: string;
        slug: string;
        name: string;
        importPath: string;
        body?: string;
      }>(url);
      logger.info("[VeryfrontAPIClient] Component found", {
        entityId,
        importPath: response.importPath,
        slug: response.slug,
        hasBody: !!response.body,
      });
      // Map importPath to path for consistency with existing code
      return {
        id: response.id,
        path: response.importPath,
        importPath: response.importPath,
        body: response.body,
      };
    } catch (error) {
      // 404 means component not found
      if (error instanceof Error && error.message.includes("404")) {
        logger.debug("[VeryfrontAPIClient] Component not found", { entityId, projectSlug });
        return null;
      }
      throw error;
    }
  }

  private async request<T>(
    endpoint: string,
    options: { returnText?: boolean } = {},
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const token = this.tokenProvider();
    return await requestWithRetry<T>(url, token, this.retryConfig, options);
  }
}

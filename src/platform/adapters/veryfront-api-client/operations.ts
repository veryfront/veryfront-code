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
    logger.debug("[VeryfrontAPIClient] Listing files", { url, projectId: id, limit, cursor, branch });

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

    do {
      const response = await this.listFiles(id, cursor, 100, branch);
      allFiles.push(...response.data);
      cursor = response.pagination?.hasMore ? response.pagination.cursor : undefined;
    } while (cursor);

    return allFiles;
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
    const response = await this.request<{ path: string; content: string; size: number } | string>(url);

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

  private async request<T>(
    endpoint: string,
    options: { returnText?: boolean } = {},
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const token = this.tokenProvider();
    return await requestWithRetry<T>(url, token, this.retryConfig, options);
  }
}

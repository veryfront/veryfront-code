import { logger } from "@veryfront/utils";
import { requestWithRetry, type RetryConfig } from "./retry-handler.ts";
import {
  type ListFilesResponse,
  type ListProjectsResponse,
  type Project,
  type ProjectFile,
  VeryfrontAPIError,
} from "./types.ts";

export class VeryfrontAPIOperations {
  constructor(
    private apiBaseUrl: string,
    private apiToken: string,
    private retryConfig: RetryConfig,
    private projectId?: string,
  ) {}

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
    const response = await this.request<ListProjectsResponse>("/api/projects");
    return response.data;
  }

  async getProject(projectId: string): Promise<Project> {
    return await this.request<Project>(`/api/projects/${projectId}`);
  }

  async listFiles(projectId?: string, cursor?: string, limit = 100): Promise<ListFilesResponse> {
    const id = projectId || this.getProjectId();
    const params = new URLSearchParams({
      limit: String(limit),
      sortBy: "updatedAt",
      sortOrder: "desc",
    });
    if (cursor) {
      params.set("cursor", cursor);
    }
    const url = `/api/projects/${id}/files?${params}`;
    logger.debug("[VeryfrontAPIClient] Listing files", { url, projectId: id, limit, cursor });
    const response = await this.request<ListFilesResponse>(url);
    logger.debug("[VeryfrontAPIClient] Files listed", {
      count: response.data?.length || 0,
      hasMore: response.pageInfo?.hasNextPage,
    });
    return response;
  }

  async listAllFiles(projectId?: string): Promise<ProjectFile[]> {
    const id = projectId || this.getProjectId();
    const allFiles: ProjectFile[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.listFiles(id, cursor);
      allFiles.push(...response.data);
      cursor = response.pageInfo?.hasNextPage ? (response.pageInfo.nextCursor ?? undefined) : undefined;
    } while (cursor);

    logger.debug("[VeryfrontAPIClient] Listed all files", { total: allFiles.length });
    return allFiles;
  }

  async getFileContent(path: string, projectId?: string): Promise<string> {
    const id = projectId || this.getProjectId();
    const encodedPath = encodeURIComponent(path);
    // API returns JSON with {path, content} structure
    const response = await this.request<{ path: string; content: string }>(
      `/api/projects/${id}/files/${encodedPath}`,
    );
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
    return await requestWithRetry<T>(url, this.apiToken, this.retryConfig, options);
  }
}

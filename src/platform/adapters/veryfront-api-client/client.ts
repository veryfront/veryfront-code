import { logger } from "@veryfront/utils";
import { VeryfrontAPIOperations } from "./operations.ts";
import { type VeryfrontAPIConfig, VeryfrontAPIError } from "./types.ts";

export class VeryfrontAPIClient {
  private config: Required<VeryfrontAPIConfig>;
  private operations: VeryfrontAPIOperations;

  constructor(config: VeryfrontAPIConfig) {
    const retryConfig = {
      maxRetries: config.retry?.maxRetries ?? 3,
      initialDelay: config.retry?.initialDelay ?? 1000,
      maxDelay: config.retry?.maxDelay ?? 10000,
    };

    this.config = {
      ...config,
      retry: retryConfig,
    };

    this.operations = new VeryfrontAPIOperations(
      this.config.apiBaseUrl,
      this.config.apiToken,
      retryConfig,
    );
  }

  async initialize(): Promise<void> {
    logger.info("[VeryfrontAPIClient] Initializing...", { slug: this.config.projectSlug });

    const projects = await this.operations.listProjects();
    const project = projects.find((p) => p.slug === this.config.projectSlug);

    if (!project) {
      throw new VeryfrontAPIError(
        `Project not found with slug: ${this.config.projectSlug}`,
        404,
        { slug: this.config.projectSlug, availableProjects: projects.map((p) => p.slug) },
      );
    }

    this.operations.setProjectId(project.id);
    logger.info("[VeryfrontAPIClient] Initialized", {
      projectId: project.id,
      projectName: project.name,
    });
  }

  getProjectId(): string {
    return this.operations.getProjectId();
  }

  async listProjects() {
    return await this.operations.listProjects();
  }

  async getProject(projectId: string) {
    return await this.operations.getProject(projectId);
  }

  async listFiles(projectId?: string, cursor?: string, limit = 100) {
    return await this.operations.listFiles(projectId, cursor, limit);
  }

  async listAllFiles(projectId?: string) {
    return await this.operations.listAllFiles(projectId);
  }

  async getFileContent(path: string, projectId?: string) {
    return await this.operations.getFileContent(path, projectId);
  }

  async getFileMetadata(path: string, projectId?: string) {
    return await this.operations.getFileMetadata(path, projectId);
  }

  async fileExists(path: string, projectId?: string) {
    return await this.operations.fileExists(path, projectId);
  }
}

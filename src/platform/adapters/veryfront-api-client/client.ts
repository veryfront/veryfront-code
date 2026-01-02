import { logger } from "@veryfront/utils";
import { type TokenProvider, VeryfrontAPIOperations } from "./operations.ts";
import { type VeryfrontAPIConfig, VeryfrontAPIError } from "./types.ts";

export class VeryfrontAPIClient {
  private config: VeryfrontAPIConfig & {
    retry: Required<NonNullable<VeryfrontAPIConfig["retry"]>>;
  };
  private operations: VeryfrontAPIOperations;
  private requestToken?: string;
  private requestProjectSlug?: string;
  private initialized = false;
  private initializingPromise?: Promise<void>;

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

    // Create token provider that supports both static config token and per-request token
    const tokenProvider: TokenProvider = () => {
      // Priority: per-request token > config token
      if (this.requestToken) {
        return this.requestToken;
      }
      if (this.config.apiToken) {
        return this.config.apiToken;
      }
      throw new VeryfrontAPIError("No API token available", 401);
    };

    this.operations = new VeryfrontAPIOperations(
      this.config.apiBaseUrl,
      tokenProvider,
      retryConfig,
    );
  }

  /**
   * Check if running in proxy mode (per-request tokens/slugs).
   */
  isProxyMode(): boolean {
    return this.config.proxyMode === true;
  }

  /**
   * Set a per-request token from proxy headers.
   * This token takes priority over the config token.
   */
  setRequestToken(token: string): void {
    this.requestToken = token;
  }

  /**
   * Clear the per-request token, reverting to config token.
   */
  clearRequestToken(): void {
    this.requestToken = undefined;
  }

  /**
   * Set a per-request project slug from proxy headers.
   * Used in proxy mode for multi-project handling.
   */
  setProjectSlug(slug: string): void {
    this.requestProjectSlug = slug;
  }

  /**
   * Get the current project slug (per-request or config).
   */
  getProjectSlug(): string | undefined {
    return this.requestProjectSlug || this.config.projectSlug;
  }

  /**
   * Clear the per-request project slug.
   */
  clearProjectSlug(): void {
    this.requestProjectSlug = undefined;
  }

  /**
   * Get the current token being used.
   */
  getToken(): string {
    return this.operations.getToken();
  }

  /**
   * Check if the client is initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  async initialize(): Promise<void> {
    // Handle concurrent initialization requests
    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    if (this.initialized) {
      return;
    }

    this.initializingPromise = this.doInitialize();
    try {
      await this.initializingPromise;
    } finally {
      this.initializingPromise = undefined;
    }
  }

  private async doInitialize(): Promise<void> {
    const slug = this.getProjectSlug();
    if (!slug) {
      throw new VeryfrontAPIError("No project slug available for initialization", 400);
    }

    logger.info("[VeryfrontAPIClient] Initializing...", { slug });

    const projects = await this.operations.listProjects();
    const project = projects.find((p) => p.slug === slug);

    if (!project) {
      throw new VeryfrontAPIError(
        `Project not found with slug: ${slug}`,
        404,
        { slug, availableProjects: projects.map((p) => p.slug) },
      );
    }

    this.operations.setProjectId(project.id);
    this.initialized = true;
    logger.info("[VeryfrontAPIClient] Initialized", {
      projectId: project.id,
      projectName: project.name,
    });
  }

  /**
   * Reset initialization state (for proxy mode project switching).
   */
  reset(): void {
    this.initialized = false;
    this.initializingPromise = undefined;
    this.operations.setProjectId("");
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

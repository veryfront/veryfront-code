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
  private requestBranch?: string | null;
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
   * Set a per-request branch from URL parsing.
   * When set, file content will be fetched from this branch instead of main.
   */
  setRequestBranch(branch: string | null): void {
    this.requestBranch = branch;
  }

  /**
   * Get the current per-request branch.
   */
  getRequestBranch(): string | null | undefined {
    return this.requestBranch;
  }

  /**
   * Clear the per-request branch, reverting to main branch.
   */
  clearRequestBranch(): void {
    this.requestBranch = undefined;
  }

  /**
   * Resolve the effective branch - uses provided branch if defined, falls back to request branch.
   */
  private resolveBranch(branch?: string | null): string | null | undefined {
    return branch !== undefined ? branch : this.requestBranch;
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

    // If projectId is already known (e.g., from domain lookup), use it directly
    if (this.config.projectId) {
      logger.info("[VeryfrontAPIClient] Initializing with known projectId", {
        slug,
        projectId: this.config.projectId,
      });
      this.operations.setProjectId(this.config.projectId);
      this.initialized = true;
      return;
    }

    // Otherwise, look up project by slug via listProjects
    logger.debug("[VeryfrontAPIClient] Initializing via listProjects", { slug });

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
    return this.operations.listProjects();
  }

  async getProject(projectId: string) {
    return this.operations.getProject(projectId);
  }

  async listFiles(projectId?: string, cursor?: string, limit = 100, branch?: string | null) {
    return this.operations.listFiles(projectId, cursor, limit, this.resolveBranch(branch));
  }

  async listAllFiles(projectId?: string, branch?: string | null) {
    return this.operations.listAllFiles(projectId, this.resolveBranch(branch));
  }

  async searchFiles(pattern: string, projectId?: string, branch?: string | null) {
    return this.operations.searchFiles(pattern, projectId, this.resolveBranch(branch));
  }

  async getFileContent(path: string, projectId?: string, branch?: string | null) {
    return this.operations.getFileContent(path, projectId, this.resolveBranch(branch));
  }

  async getFileMetadata(path: string, projectId?: string) {
    return this.operations.getFileMetadata(path, projectId);
  }

  async fileExists(path: string, projectId?: string) {
    return this.operations.fileExists(path, projectId);
  }

  async listPublishedFiles(projectId?: string, releaseId?: string) {
    return this.operations.listPublishedFiles(projectId, releaseId);
  }

  async getPublishedFileContent(path: string, projectId?: string, releaseId?: string) {
    return this.operations.getPublishedFileContent(path, projectId, releaseId);
  }

  async lookupProjectByDomain(domain: string) {
    return this.operations.lookupProjectByDomain(domain);
  }

  async getComponentByEntityId(entityId: string, projectSlug?: string) {
    const slug = projectSlug || this.getProjectSlug();
    if (!slug) {
      throw new VeryfrontAPIError("No project slug available for component lookup", 400);
    }
    return this.operations.getComponentByEntityId(entityId, slug);
  }
}

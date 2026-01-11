import { logger } from "@veryfront/utils";
import {
  type FileDetail,
  type FileListResult,
  type ListFilesOptions,
  type TokenProvider,
  VeryfrontAPIOperations,
} from "./operations.ts";
import { type VeryfrontAPIConfig, VeryfrontAPIError } from "./types.ts";

/**
 * File context for API operations.
 * - branch: Draft/working copy from a specific branch
 * - environment: Deployed content from an environment (production, preview, staging)
 * - release: Specific release version
 */
export type FileContext =
  | { type: "branch"; name: string }
  | { type: "environment"; name: string }
  | { type: "release"; version: string };

export class VeryfrontAPIClient {
  private config: VeryfrontAPIConfig & {
    retry: Required<NonNullable<VeryfrontAPIConfig["retry"]>>;
  };
  private operations: VeryfrontAPIOperations;
  private requestToken?: string;
  private requestProjectSlug?: string;
  private requestContext?: FileContext;
  private requestBranch?: string | null;
  private initialized = false;
  private initializingPromise?: Promise<void>;

  constructor(config: VeryfrontAPIConfig) {
    const retryConfig = {
      maxRetries: config.retry?.maxRetries ?? 3,
      initialDelay: config.retry?.initialDelay ?? 1000,
      maxDelay: config.retry?.maxDelay ?? 10000,
    };

    this.config = { ...config, retry: retryConfig };

    const tokenProvider: TokenProvider = () => {
      if (this.requestToken) return this.requestToken;
      if (this.config.apiToken) return this.config.apiToken;
      throw new VeryfrontAPIError("No API token available", 401);
    };

    this.operations = new VeryfrontAPIOperations(
      this.config.apiBaseUrl,
      tokenProvider,
      retryConfig,
    );
  }

  // =============================================================================
  // Configuration
  // =============================================================================

  isProxyMode(): boolean {
    return this.config.proxyMode === true;
  }

  setRequestToken(token: string): void {
    this.requestToken = token;
  }

  clearRequestToken(): void {
    this.requestToken = undefined;
  }

  setProjectSlug(slug: string): void {
    this.requestProjectSlug = slug;
  }

  getProjectSlug(): string | undefined {
    return this.requestProjectSlug || this.config.projectSlug;
  }

  clearProjectSlug(): void {
    this.requestProjectSlug = undefined;
  }

  setContext(context: FileContext): void {
    this.requestContext = context;
  }

  getContext(): FileContext {
    return this.requestContext ?? { type: "branch", name: "main" };
  }

  clearContext(): void {
    this.requestContext = undefined;
  }

  getToken(): string {
    return this.operations.getToken();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // Branch-related setters for backward compatibility with adapter
  setRequestBranch(branch: string | null): void {
    this.requestBranch = branch;
    if (branch) {
      this.setContext({ type: "branch", name: branch });
    } else {
      this.clearContext();
    }
  }

  getRequestBranch(): string | null | undefined {
    return this.requestBranch;
  }

  clearRequestBranch(): void {
    this.requestBranch = undefined;
    this.clearContext();
  }

  // =============================================================================
  // Initialization
  // =============================================================================

  async initialize(): Promise<void> {
    if (this.initializingPromise) return this.initializingPromise;
    if (this.initialized) return;

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

    if (this.config.projectId) {
      logger.info("[VeryfrontAPIClient] Initializing with known projectId", {
        slug,
        projectId: this.config.projectId,
      });
      this.operations.setProjectId(this.config.projectId);
      this.initialized = true;
      return;
    }

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

  reset(): void {
    this.initialized = false;
    this.initializingPromise = undefined;
    this.operations.setProjectId("");
  }

  getProjectId(): string {
    return this.operations.getProjectId();
  }

  // =============================================================================
  // Project Operations
  // =============================================================================

  listProjects() {
    return this.operations.listProjects();
  }

  getProject(projectRef?: string) {
    return this.operations.getProject(projectRef ?? this.getProjectSlug()!);
  }

  // =============================================================================
  // File Operations (context-aware)
  // =============================================================================

  listFiles(options: ListFilesOptions = {}): Promise<FileListResult> {
    const projectRef = this.getProjectSlug()!;
    const context = this.getContext();

    switch (context.type) {
      case "branch":
        return this.operations.listBranchFiles(projectRef, context.name, options);
      case "environment":
        return this.operations.listEnvironmentFiles(projectRef, context.name, options);
      case "release":
        return this.operations.listReleaseFiles(projectRef, context.version, options);
    }
  }

  listAllFiles(options: Omit<ListFilesOptions, "cursor"> = {}) {
    const projectRef = this.getProjectSlug()!;
    const context = this.getContext();

    switch (context.type) {
      case "branch":
        return this.operations.listAllBranchFiles(projectRef, context.name, options);
      case "environment":
        return this.operations.listAllEnvironmentFiles(projectRef, context.name, options);
      case "release":
        return this.operations.listAllReleaseFiles(projectRef, context.version, options);
    }
  }

  getFile(pathOrId: string): Promise<FileDetail> {
    const projectRef = this.getProjectSlug()!;
    const context = this.getContext();

    switch (context.type) {
      case "branch":
        return this.operations.getBranchFile(projectRef, context.name, pathOrId);
      case "environment":
        return this.operations.getEnvironmentFile(projectRef, context.name, pathOrId);
      case "release":
        return this.operations.getReleaseFile(projectRef, context.version, pathOrId);
    }
  }

  async getFileContent(pathOrId: string): Promise<string> {
    const file = await this.getFile(pathOrId);
    return file.content;
  }

  // =============================================================================
  // Branch-specific Operations
  // =============================================================================

  listBranchFiles(branchName = "main", options: ListFilesOptions = {}) {
    return this.operations.listBranchFiles(this.getProjectSlug()!, branchName, options);
  }

  getBranchFile(branchName: string, pathOrId: string) {
    return this.operations.getBranchFile(this.getProjectSlug()!, branchName, pathOrId);
  }

  // =============================================================================
  // Environment-specific Operations
  // =============================================================================

  listEnvironmentFiles(environmentName = "production", options: ListFilesOptions = {}) {
    return this.operations.listEnvironmentFiles(this.getProjectSlug()!, environmentName, options);
  }

  listAllEnvironmentFiles(
    environmentName = "production",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ) {
    return this.operations.listAllEnvironmentFiles(
      this.getProjectSlug()!,
      environmentName,
      options,
    );
  }

  getEnvironmentFile(environmentName: string, pathOrId: string) {
    return this.operations.getEnvironmentFile(this.getProjectSlug()!, environmentName, pathOrId);
  }

  // =============================================================================
  // Release-specific Operations
  // =============================================================================

  listReleaseFiles(version = "latest", options: ListFilesOptions = {}) {
    return this.operations.listReleaseFiles(this.getProjectSlug()!, version, options);
  }

  getReleaseFile(version: string, pathOrId: string) {
    return this.operations.getReleaseFile(this.getProjectSlug()!, version, pathOrId);
  }

  // =============================================================================
  // Domain Lookup
  // =============================================================================

  lookupProjectByDomain(domain: string) {
    return this.operations.lookupProjectByDomain(domain);
  }

  // =============================================================================
  // Adapter Convenience Methods
  // =============================================================================

  async getFileById(entityId: string): Promise<{ path: string; content: string } | null> {
    try {
      const file = await this.getFile(entityId);
      return { path: file.path, content: file.content };
    } catch (error) {
      if (error instanceof Error && error.message.includes("404")) {
        return null;
      }
      throw error;
    }
  }

  async searchFiles(pattern: string): Promise<{ id?: string; path: string }[]> {
    const result = await this.listFiles({ pattern, limit: 100 });
    return result.files.map((f) => ({ id: f.id, path: f.path }));
  }

  listPublishedFiles(_projectId?: string, _releaseId?: string) {
    return this.operations.listAllEnvironmentFiles(this.getProjectSlug()!, "production");
  }

  async getPublishedFileContent(path: string): Promise<string> {
    const result = await this.operations.getEnvironmentFile(
      this.getProjectSlug()!,
      "production",
      path,
    );
    return result.content;
  }
}

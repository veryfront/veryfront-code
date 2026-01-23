import { logger } from "#veryfront/utils";
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
  /** Cached project data from initialization - avoids redundant API calls */
  private cachedProjectData?: Awaited<ReturnType<VeryfrontAPIOperations["getProject"]>>;

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
    const slug = this.getProjectSlug();
    logger.debug("[VeryfrontAPIClient] initialize() called", {
      slug,
      initialized: this.initialized,
      hasPendingPromise: !!this.initializingPromise,
    });

    if (this.initializingPromise) {
      logger.debug("[VeryfrontAPIClient] Waiting for pending initialization", { slug });
      const waitStart = performance.now();
      await this.initializingPromise;
      logger.debug("[VeryfrontAPIClient] Pending initialization resolved", {
        slug,
        waitDuration: `${(performance.now() - waitStart).toFixed(2)}ms`,
      });
      return;
    }

    if (this.initialized) {
      logger.debug("[VeryfrontAPIClient] Already initialized", { slug });
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
    const initStartTime = performance.now();
    const slug = this.getProjectSlug();
    logger.debug("[VeryfrontAPIClient] doInitialize START", { slug });

    if (!slug) {
      throw new VeryfrontAPIError("No project slug available for initialization", 400);
    }

    if (this.config.projectId) {
      logger.debug("[VeryfrontAPIClient] Using known projectId", {
        slug,
        projectId: this.config.projectId,
        duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
      });
      this.operations.setProjectId(this.config.projectId);
      this.initialized = true;
      return;
    }

    // Use getProject directly instead of listProjects - more efficient and works
    // with tokens that have project access but not list access
    logger.debug("[VeryfrontAPIClient] Calling getProject API", { slug });
    const getProjectStart = performance.now();
    const project = await this.operations.getProject(slug);
    logger.debug("[VeryfrontAPIClient] getProject API completed", {
      slug,
      projectId: project.id,
      apiDuration: `${(performance.now() - getProjectStart).toFixed(2)}ms`,
    });

    // Cache the project data to avoid redundant API calls
    // Adapter can use getCachedProject() instead of calling getProject() again
    this.cachedProjectData = project;
    this.operations.setProjectId(project.id);
    this.initialized = true;
    logger.debug("[VeryfrontAPIClient] doInitialize DONE", {
      slug,
      projectId: project.id,
      totalDuration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
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

  /**
   * Get the cached project data from initialization.
   * Returns undefined if not yet initialized or if projectId was provided in config.
   * Use this instead of calling getProject() to avoid redundant API calls.
   */
  getCachedProject(): Awaited<ReturnType<VeryfrontAPIOperations["getProject"]>> | undefined {
    return this.cachedProjectData;
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

  /**
   * Search for files matching a pattern and return them with content.
   * Useful for batch-loading files without knowing exact extensions.
   *
   * Example: searchFilesWithContent("components/Button.*") returns all files
   * like Button.tsx, Button.ts, Button.jsx etc. with their content.
   *
   * @param pattern - Glob pattern to match files (e.g., "path/file.*" or "pages/_error.*")
   * @returns Array of files with path and content
   */
  async searchFilesWithContent(
    pattern: string,
  ): Promise<Array<{ path: string; content: string }>> {
    const projectRef = this.getProjectSlug()!;
    const context = this.getContext();

    // Use listFiles with pattern - the API returns files matching the glob
    let result;
    switch (context.type) {
      case "branch":
        result = await this.operations.listBranchFiles(projectRef, context.name, {
          pattern,
          limit: 20,
        });
        break;
      case "environment":
        result = await this.operations.listEnvironmentFiles(projectRef, context.name, {
          pattern,
          limit: 20,
        });
        break;
      case "release":
        result = await this.operations.listReleaseFiles(projectRef, context.version, {
          pattern,
          limit: 20,
        });
        break;
    }

    // Filter to only files that have content (some list endpoints include content)
    // If content not included, we need to fetch individually but in parallel
    const filesWithContent: Array<{ path: string; content: string }> = [];
    const filesNeedingContent: string[] = [];

    for (const file of result.files) {
      if (file.content) {
        filesWithContent.push({ path: file.path, content: file.content });
      } else {
        filesNeedingContent.push(file.path);
      }
    }

    // Fetch missing content in parallel (if any files didn't include content)
    if (filesNeedingContent.length > 0) {
      const contentFetches = filesNeedingContent.map(async (path) => {
        try {
          const content = await this.getFileContent(path);
          return { path, content };
        } catch {
          return null;
        }
      });

      const fetched = await Promise.all(contentFetches);
      for (const item of fetched) {
        if (item) {
          filesWithContent.push(item);
        }
      }
    }

    return filesWithContent;
  }

  /**
   * Resolve a file path without extension by searching for all possible extensions.
   * Returns the first match based on extension priority.
   *
   * @param basePath - Path without extension (e.g., "components/Button")
   * @param extensionPriority - Preferred extension order (default: .tsx, .ts, .jsx, .js, .mdx, .md)
   * @returns The resolved file with content, or null if not found
   */
  async resolveFileWithExtension(
    basePath: string,
    extensionPriority = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"],
  ): Promise<{ path: string; content: string } | null> {
    // Search for all files matching basePath with any extension
    const pattern = `${basePath}.*`;
    const matches = await this.searchFilesWithContent(pattern);

    if (matches.length === 0) {
      return null;
    }

    // Sort by extension priority and return the first match
    const sorted = matches.sort((a, b) => {
      const extA = extensionPriority.findIndex((ext) => a.path.endsWith(ext));
      const extB = extensionPriority.findIndex((ext) => b.path.endsWith(ext));
      return (extA === -1 ? 99 : extA) - (extB === -1 ? 99 : extB);
    });

    return sorted[0] ?? null;
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

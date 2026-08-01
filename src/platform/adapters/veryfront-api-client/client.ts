import { logger as baseLogger, parallelMap } from "#veryfront/utils";
import { normalizeVeryfrontApiRetryConfig } from "#veryfront/utils/config-resource-limits.ts";
import {
  type EnsureStyleArtifactBuildInput,
  type FileDetail,
  type FileListResult,
  type GetFileOptions,
  type ListFilesOptions,
  type ListProjectsOptions,
  type ProjectStyleArtifactResolution,
  type ResolveStyleArtifactInput,
  type TokenProvider,
  type UpsertStyleArtifactInput,
  VeryfrontAPIOperations,
} from "./operations.ts";
import { API_CLIENT_ERROR, type VeryfrontAPIConfig, VeryfrontError } from "./types.ts";

const logger = baseLogger.component("veryfront-api-client");

const DEFAULT_SEARCH_LIMIT = 100;

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

export class VeryfrontApiClient {
  private config: VeryfrontAPIConfig & {
    retry: Required<NonNullable<VeryfrontAPIConfig["retry"]>>;
  };
  private operations: VeryfrontAPIOperations;
  private readonly requestCredentialProvider?: TokenProvider;
  private requestToken?: string;
  private requestProjectSlug?: string;
  private requestContext?: FileContext;
  private requestBranch?: string | null;
  private initialized = false;
  private initializingPromise?: Promise<void>;
  private initializationController?: AbortController;
  private initializationGeneration = 0;
  /** Cached project data from initialization - avoids redundant API calls */
  private cachedProjectData?: Awaited<ReturnType<VeryfrontAPIOperations["getProject"]>>;

  constructor(config: VeryfrontAPIConfig, requestCredentialProvider?: TokenProvider) {
    const retryConfig = normalizeVeryfrontApiRetryConfig(config.retry);

    this.config = { ...config, retry: retryConfig };
    this.requestCredentialProvider = requestCredentialProvider;

    const tokenProvider: TokenProvider = requestCredentialProvider ??
      (() => {
        if (this.requestToken) return this.requestToken;
        if (this.config.apiToken) return this.config.apiToken;
        throw API_CLIENT_ERROR.create({ detail: "No API token available", status: 401 });
      });

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
    if (this.requestCredentialProvider) {
      throw API_CLIENT_ERROR.create({
        detail: "Cannot mutate a client backed by an immutable request credential provider",
        status: 409,
      });
    }
    this.requestToken = token;
  }

  clearRequestToken(): void {
    if (this.requestCredentialProvider) {
      throw API_CLIENT_ERROR.create({
        detail: "Cannot clear a client backed by an immutable request credential provider",
        status: 409,
      });
    }
    this.requestToken = undefined;
  }

  setProjectSlug(slug: string): void {
    if (typeof slug !== "string" || slug.trim().length === 0) {
      throw API_CLIENT_ERROR.create({
        detail: "Project slug must be a non-empty string",
        status: 400,
      });
    }

    const previousSlug = this.getProjectSlug();
    this.requestProjectSlug = slug;
    if (slug !== previousSlug) {
      this.invalidateInitialization();
    }
  }

  getProjectSlug(): string | undefined {
    return this.requestProjectSlug ?? this.config.projectSlug;
  }

  /** Throws a structured error when no project slug is configured, instead of passing `undefined` to API calls. */
  private requireProjectSlug(): string {
    const slug = this.getProjectSlug();
    if (!slug) {
      throw API_CLIENT_ERROR.create({
        detail:
          "No project slug configured — call setProjectSlug() or provide projectSlug in the config before making project-scoped API calls",
        status: 400,
      });
    }
    return slug;
  }

  clearProjectSlug(): void {
    const previousSlug = this.getProjectSlug();
    this.requestProjectSlug = undefined;
    if (this.getProjectSlug() !== previousSlug) {
      this.invalidateInitialization();
    }
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
      return;
    }

    this.clearContext();
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
    logger.debug("initialize() called", {
      slug,
      initialized: this.initialized,
      hasPendingPromise: !!this.initializingPromise,
    });

    if (this.initializingPromise) {
      logger.debug("Waiting for pending initialization", { slug });
      const waitStart = performance.now();
      await this.initializingPromise;
      logger.debug("Pending initialization resolved", {
        slug,
        waitDuration: `${(performance.now() - waitStart).toFixed(2)}ms`,
      });
      return;
    }

    if (this.initialized) {
      logger.debug("Already initialized", { slug });
      return;
    }

    const generation = this.initializationGeneration;
    const controller = new AbortController();
    this.initializationController = controller;
    const initialization = this.doInitialize(slug, generation, controller.signal).then(() => {
      this.assertInitializationCurrent(generation, controller.signal);
    });
    this.initializingPromise = initialization;

    try {
      await initialization;
    } finally {
      if (this.initializingPromise === initialization) {
        this.initializingPromise = undefined;
      }
      if (this.initializationController === controller) {
        this.initializationController = undefined;
      }
    }
  }

  private async doInitialize(
    slug: string | undefined,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    const initStartTime = performance.now();
    logger.debug("doInitialize START", { slug });

    if (!slug) {
      throw API_CLIENT_ERROR.create({
        detail: "No project slug available for initialization",
        status: 400,
      });
    }

    this.assertInitializationCurrent(generation, signal);

    if (this.config.projectId && slug === this.config.projectSlug) {
      logger.debug("Using known projectId", {
        slug,
        projectId: this.config.projectId,
        duration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
      });
      this.assertInitializationCurrent(generation, signal);
      this.operations.setProjectId(this.config.projectId);
      this.initialized = true;
      return;
    }

    // Use getProject directly instead of listProjects - more efficient and works
    // with tokens that have project access but not list access
    logger.debug("Calling getProject API", { slug });
    const getProjectStart = performance.now();
    const project = await this.operations.getProject(slug, signal);
    this.assertInitializationCurrent(generation, signal);
    logger.debug("getProject API completed", {
      slug,
      projectId: project.id,
      apiDuration: `${(performance.now() - getProjectStart).toFixed(2)}ms`,
    });

    // Cache the project data to avoid redundant API calls
    // Adapter can use getCachedProject() instead of calling getProject() again
    this.cachedProjectData = project;
    this.operations.setProjectId(project.id);
    this.initialized = true;
    logger.debug("doInitialize DONE", {
      slug,
      projectId: project.id,
      totalDuration: `${(performance.now() - initStartTime).toFixed(2)}ms`,
    });
  }

  reset(): void {
    this.invalidateInitialization();
  }

  private invalidateInitialization(): void {
    this.initializationGeneration++;
    const controller = this.initializationController;
    this.initializationController = undefined;
    this.initializingPromise = undefined;
    this.initialized = false;
    this.cachedProjectData = undefined;
    this.operations.clearProjectId();
    controller?.abort(
      new DOMException("Veryfront API client initialization was invalidated", "AbortError"),
    );
  }

  private assertInitializationCurrent(generation: number, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (generation !== this.initializationGeneration) {
      throw new DOMException(
        "Veryfront API client initialization was invalidated",
        "AbortError",
      );
    }
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

  listProjects(options: ListProjectsOptions = {}) {
    return this.operations.listProjects(options);
  }

  getProject(projectRef?: string) {
    return this.operations.getProject(projectRef ?? this.requireProjectSlug());
  }

  // =============================================================================
  // File Operations (context-aware)
  // =============================================================================

  listFiles(options: ListFilesOptions = {}): Promise<FileListResult> {
    return this.listFilesByContext(this.requireProjectSlug(), this.getContext(), options);
  }

  listAllFiles(options: Omit<ListFilesOptions, "cursor"> = {}) {
    const projectRef = this.requireProjectSlug();
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

  getFile(pathOrId: string, options: { expectedMissing?: boolean } = {}): Promise<FileDetail> {
    const projectRef = this.requireProjectSlug();
    const context = this.getContext();

    switch (context.type) {
      case "branch":
        return this.operations.getBranchFile(projectRef, context.name, pathOrId, options);
      case "environment":
        return this.operations.getEnvironmentFile(projectRef, context.name, pathOrId, options);
      case "release":
        return this.operations.getReleaseFile(projectRef, context.version, pathOrId, options);
    }
  }

  async getFileContent(pathOrId: string): Promise<string> {
    const file = await this.getFile(pathOrId);
    return file.content;
  }

  getFileContentBytesWithinLimit(
    pathOrId: string,
    maximumBytes: number,
    options: GetFileOptions = {},
  ): Promise<Uint8Array> {
    const projectRef = this.requireProjectSlug();
    const context = this.getContext();

    switch (context.type) {
      case "branch":
        return this.operations.getBranchFileContentBytesWithinLimit(
          projectRef,
          context.name,
          pathOrId,
          maximumBytes,
          options,
        );
      case "environment":
        return this.operations.getEnvironmentFileContentBytesWithinLimit(
          projectRef,
          context.name,
          pathOrId,
          maximumBytes,
          options,
        );
      case "release":
        return this.operations.getReleaseFileContentBytesWithinLimit(
          projectRef,
          context.version,
          pathOrId,
          maximumBytes,
          options,
        );
    }
  }

  async getOptionalFileContent(pathOrId: string): Promise<string> {
    const file = await this.getFile(pathOrId, { expectedMissing: true });
    return file.content;
  }

  // =============================================================================
  // Branch-specific Operations
  // =============================================================================

  listBranchFiles(branchName = "main", options: ListFilesOptions = {}) {
    return this.operations.listBranchFiles(this.requireProjectSlug(), branchName, options);
  }

  getBranchFile(branchName: string, pathOrId: string) {
    return this.operations.getBranchFile(this.requireProjectSlug(), branchName, pathOrId);
  }

  // =============================================================================
  // Environment-specific Operations
  // =============================================================================

  listEnvironmentFiles(environmentName = "production", options: ListFilesOptions = {}) {
    return this.operations.listEnvironmentFiles(
      this.requireProjectSlug(),
      environmentName,
      options,
    );
  }

  listAllEnvironmentFiles(
    environmentName = "production",
    options: Omit<ListFilesOptions, "cursor"> = {},
  ) {
    return this.operations.listAllEnvironmentFiles(
      this.requireProjectSlug(),
      environmentName,
      options,
    );
  }

  getEnvironmentFile(environmentName: string, pathOrId: string) {
    return this.operations.getEnvironmentFile(this.requireProjectSlug(), environmentName, pathOrId);
  }

  // =============================================================================
  // Release-specific Operations
  // =============================================================================

  listReleaseFiles(version = "latest", options: ListFilesOptions = {}) {
    return this.operations.listReleaseFiles(this.requireProjectSlug(), version, options);
  }

  listAllReleaseFiles(version = "latest", options: Omit<ListFilesOptions, "cursor"> = {}) {
    return this.operations.listAllReleaseFiles(this.requireProjectSlug(), version, options);
  }

  getReleaseFile(version: string, pathOrId: string) {
    return this.operations.getReleaseFile(this.requireProjectSlug(), version, pathOrId);
  }

  // =============================================================================
  // Domain Lookup
  // =============================================================================

  lookupProjectByDomain(domain: string) {
    return this.operations.lookupProjectByDomain(domain);
  }

  resolveStyleArtifact(
    input: ResolveStyleArtifactInput,
    projectRef = this.requireProjectSlug(),
  ): Promise<ProjectStyleArtifactResolution> {
    return this.operations.resolveStyleArtifact(projectRef, input);
  }

  ensureStyleArtifactBuild(
    input: EnsureStyleArtifactBuildInput,
    projectRef = this.requireProjectSlug(),
  ): Promise<ProjectStyleArtifactResolution> {
    return this.operations.ensureStyleArtifactBuild(projectRef, input);
  }

  upsertStyleArtifact(
    input: UpsertStyleArtifactInput,
    projectRef = this.requireProjectSlug(),
  ): Promise<ProjectStyleArtifactResolution> {
    return this.operations.upsertStyleArtifact(projectRef, input);
  }

  // =============================================================================
  // Release Asset Manifest Operations
  // =============================================================================

  beginReleaseAssetManifestBuild(version: string, projectRef = this.requireProjectSlug()) {
    return this.operations.beginReleaseAssetManifestBuild(projectRef, version);
  }

  uploadReleaseAsset(
    version: string,
    contentHash: string,
    contentType: string,
    bytes: Uint8Array,
    projectRef = this.requireProjectSlug(),
  ) {
    return this.operations.uploadReleaseAsset(
      projectRef,
      version,
      contentHash,
      contentType,
      bytes,
    );
  }

  putReleaseAssetManifest(
    version: string,
    manifest: unknown,
    projectRef = this.requireProjectSlug(),
  ) {
    return this.operations.putReleaseAssetManifest(projectRef, version, manifest);
  }

  reportReleaseAssetManifestState(
    version: string,
    state: "failed",
    error?: string,
    projectRef = this.requireProjectSlug(),
  ) {
    return this.operations.reportReleaseAssetManifestState(projectRef, version, state, error);
  }

  getReleaseAssetManifest(version: string, projectRef = this.requireProjectSlug()) {
    return this.operations.getReleaseAssetManifest(projectRef, version);
  }

  // =============================================================================
  // Adapter Convenience Methods
  // =============================================================================

  async getFileById(entityId: string): Promise<{ path: string; content: string } | null> {
    try {
      const file = await this.getFile(entityId, { expectedMissing: true });
      return { path: file.path, content: file.content };
    } catch (error) {
      if (error instanceof VeryfrontError && error.status === 404) return null;
      throw error;
    }
  }

  async searchFiles(pattern: string): Promise<{ id?: string; path: string }[]> {
    const files = await this.listAllFiles({ pattern, limit: DEFAULT_SEARCH_LIMIT });
    return files.map((file) => ({ id: file.id, path: file.path }));
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
    const files = await this.listAllFiles({ pattern, limit: DEFAULT_SEARCH_LIMIT });
    const resolved = await parallelMap(
      files,
      async (file): Promise<{ path: string; content: string } | null> => {
        if (file.content !== undefined) {
          return { path: file.path, content: file.content };
        }

        try {
          const content = await this.getOptionalFileContent(file.path);
          return { path: file.path, content };
        } catch (error) {
          if (error instanceof VeryfrontError && error.status === 404) {
            logger.debug("File disappeared during search", { path: file.path });
            return null;
          }
          throw error;
        }
      },
    );

    return resolved.filter(
      (file): file is { path: string; content: string } => file !== null,
    );
  }

  private listFilesByContext(
    projectRef: string,
    context: FileContext,
    options: ListFilesOptions,
  ): Promise<FileListResult> {
    switch (context.type) {
      case "branch":
        return this.operations.listBranchFiles(projectRef, context.name, options);
      case "environment":
        return this.operations.listEnvironmentFiles(projectRef, context.name, options);
      case "release":
        return this.operations.listReleaseFiles(projectRef, context.version, options);
    }
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
    const matches = await this.searchFilesWithContent(`${basePath}.*`);
    if (matches.length === 0) return null;

    matches.sort((a, b) => {
      const extA = extensionPriority.findIndex((ext) => a.path.endsWith(ext));
      const extB = extensionPriority.findIndex((ext) => b.path.endsWith(ext));
      return (extA === -1 ? 99 : extA) - (extB === -1 ? 99 : extB);
    });

    return matches[0] ?? null;
  }

  listPublishedFiles(_projectId?: string, releaseId?: string, environmentName?: string) {
    const projectRef = this.requireProjectSlug();

    if (releaseId) {
      return this.operations.listAllReleaseFiles(projectRef, releaseId);
    }

    if (environmentName) {
      return this.operations.listAllEnvironmentFiles(projectRef, environmentName);
    }

    throw API_CLIENT_ERROR.create({
      detail: "Cannot list published files without releaseId or environmentName",
      status: 400,
    });
  }

  async getPublishedFileContent(
    path: string,
    releaseId?: string,
    environmentName?: string,
  ): Promise<string> {
    const projectRef = this.requireProjectSlug();

    if (releaseId) {
      const result = await this.operations.getReleaseFile(projectRef, releaseId, path);
      return result.content;
    }

    if (environmentName) {
      const result = await this.operations.getEnvironmentFile(projectRef, environmentName, path);
      return result.content;
    }

    throw API_CLIENT_ERROR.create({
      detail: "Cannot fetch published file without releaseId or environmentName",
      status: 400,
    });
  }

  getPublishedFileContentBytesWithinLimit(
    path: string,
    maximumBytes: number,
    releaseId?: string,
    environmentName?: string,
    options: GetFileOptions = {},
  ): Promise<Uint8Array> {
    const projectRef = this.requireProjectSlug();

    if (releaseId) {
      return this.operations.getReleaseFileContentBytesWithinLimit(
        projectRef,
        releaseId,
        path,
        maximumBytes,
        options,
      );
    }

    if (environmentName) {
      return this.operations.getEnvironmentFileContentBytesWithinLimit(
        projectRef,
        environmentName,
        path,
        maximumBytes,
        options,
      );
    }

    throw API_CLIENT_ERROR.create({
      detail: "Cannot fetch published file without releaseId or environmentName",
      status: 400,
    });
  }
}

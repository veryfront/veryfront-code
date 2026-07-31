import { buildClientManifest } from "#veryfront/rendering/rsc/component-analyzer.ts";
import { RSCRenderer } from "#veryfront/rendering/rsc/server-renderer/index.ts";
import type { ClientComponentMeta } from "#veryfront/rendering/rsc/types.ts";
import { ManifestHandler } from "./manifest-handler.ts";
import { PageHandler } from "./page-handler.ts";
import { RenderHandler } from "./render-handler.ts";
import { StreamHandler } from "./stream-handler.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  createDependencyPinningSource,
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
  resolveProjectReactVersion,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  assertImportMapIdentity,
  type ImportMapIdentity,
  preloadImportMap,
} from "#veryfront/modules/import-map/index.ts";
import type { ClientModuleStrategy } from "#veryfront/types/rsc.ts";

export interface RSCServerHandlerOptions {
  config?: VeryfrontConfig;
  isLocalProject?: boolean;
  clientModuleStrategy?: ClientModuleStrategy;
  mode?: "development" | "production";
  adapter?: RuntimeAdapter;
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
  releaseId?: string;
  /**
   * Exact immutable map selected at the authenticated request boundary.
   *
   * Direct standalone callers may omit this and retain the historical
   * adapter-backed loading behavior.
   */
  importMapIdentity?: ImportMapIdentity;
  branch?: string | null;
  /** Canonical feature state used to scope pin-on handler identities. */
  dependencyPinningEnabled?: boolean;
  /** Validated request snapshot for snapshot-bound transports. */
  dependencyPinningCacheKey?: string;
  dependencyPinningSource?: DependencyPinningSourceInput;
}

export function getConfiguredRSCReactVersion(config?: VeryfrontConfig): string | undefined {
  if (config?.react?.version) return config.react.version;

  const legacyVersions = config?.client?.cdn?.versions;
  return legacyVersions && legacyVersions !== "auto" ? legacyVersions.react : undefined;
}

export function getConfiguredRSCDependencyVersionIdentity(
  config?: VeryfrontConfig,
): readonly [react: string | null, veryfront: string | null] {
  const legacyVersions = config?.client?.cdn?.versions;
  const veryfrontVersion = legacyVersions && legacyVersions !== "auto"
    ? legacyVersions.veryfront
    : undefined;

  return [
    getConfiguredRSCReactVersion(config) ?? null,
    veryfrontVersion ?? null,
  ];
}

export class RSCDevServerHandler {
  private renderer: RSCRenderer | null = null;
  private clientManifest: Map<string, ClientComponentMeta> | null = null;
  private rendererPromise: Promise<void> | null = null;
  private reactVersionPromise: Promise<string> | null = null;
  private invalidationGeneration = 0;

  private readonly manifestHandler: ManifestHandler;
  private readonly renderHandler: RenderHandler;
  private readonly streamHandler: StreamHandler;
  private readonly dependencyPinningSource: DependencyPinningSourceInput;

  constructor(
    private readonly projectDir: string,
    options: RSCServerHandlerOptions = {},
  ) {
    const importMapIdentity = options.importMapIdentity;
    if (importMapIdentity) {
      assertImportMapIdentity(importMapIdentity);
    }
    const adapter = options.adapter;
    const appDir = options.config?.directories?.app ?? "app";
    const isLocalProject = options.isLocalProject === true;
    const clientModuleStrategy = options.clientModuleStrategy === "fs" ? "fs" : "rsc-module";
    const mode = options.mode ?? "production";
    const moduleContentSourceId = options.contentSourceId ?? options.releaseId ??
      (options.branch ? `branch:${options.branch}` : undefined) ??
      (isLocalProject ? "local-main" : mode === "development" ? "preview-main" : "production");
    this.dependencyPinningSource = options.dependencyPinningSource ??
      createDependencyPinningSource({
        projectDir,
        adapter: options.adapter,
        isLocalProject,
        projectId: options.projectId,
        projectSlug: options.projectSlug,
        contentSourceId: options.contentSourceId,
        releaseId: options.releaseId,
        branch: options.branch,
        config: options.config,
      });
    this.manifestHandler = new ManifestHandler(projectDir, {
      appDir,
      clientModuleStrategy,
      fs: adapter?.fs,
      contentSourceId: moduleContentSourceId,
    });
    this.renderHandler = new RenderHandler(
      projectDir,
      () => this.renderer,
      mode,
      appDir,
      {
        adapter: options.adapter,
        projectId: options.projectId,
        projectSlug: options.projectSlug,
        contentSourceId: moduleContentSourceId,
        dependencyPinningSource: this.dependencyPinningSource,
        reactVersion: (snapshot) => this.getReactVersionForSnapshot(snapshot),
        importMap: importMapIdentity
          ? () => Promise.resolve(importMapIdentity.importMap)
          : adapter
          ? () =>
            preloadImportMap(
              projectDir,
              adapter,
              options.projectId ?? projectDir,
              {
                contentSourceId: moduleContentSourceId,
                config: options.config,
              },
            )
          : undefined,
      },
    );
    this.streamHandler = new StreamHandler(this.renderHandler);
    this.appDir = appDir;
    this.clientModuleStrategy = clientModuleStrategy;
    this.mode = mode;
    this.fs = adapter?.fs;
    this.config = options.config;
  }

  private readonly appDir: string;
  private readonly clientModuleStrategy: ClientModuleStrategy;
  private readonly mode: "development" | "production";
  private readonly fs?: RuntimeAdapter["fs"];
  private readonly config?: VeryfrontConfig;

  async handleManifest(dependencyPinningCacheKey?: string): Promise<Response> {
    if (
      dependencyPinningCacheKey &&
      !dependencyPinningCacheKey.startsWith("on:")
    ) {
      throw new Error(`Invalid dependency pinning snapshot: ${dependencyPinningCacheKey}`);
    }
    const dependencySnapshot = await resolveRequestedDependencyPinningSnapshot(
      this.dependencyPinningSource,
      dependencyPinningCacheKey,
    );
    if (!dependencySnapshot) {
      throw new Error(`Unknown dependency pinning snapshot: ${dependencyPinningCacheKey}`);
    }
    return this.manifestHandler.handle(
      this.clientManifest,
      dependencySnapshot.cacheKey,
    );
  }

  async handleRender(
    pathname: string,
    searchParams: URLSearchParams,
    request?: Request,
  ): Promise<Response> {
    await this.ensureRenderer();
    return this.renderHandler.handle(pathname, searchParams, request);
  }

  async handleStream(
    pathname: string,
    searchParams: URLSearchParams,
    request?: Request,
  ): Promise<Response> {
    await this.ensureRenderer();
    return this.streamHandler.handle(pathname, searchParams, request);
  }

  async handlePage(
    pathname: string,
    searchParams: URLSearchParams,
    nonce?: string,
  ): Promise<Response> {
    const dependencySnapshot = await resolveDependencyPinningSnapshot(
      this.dependencyPinningSource,
    );
    const pageHandler = new PageHandler(
      this.mode === "development",
      await this.getReactVersionForSnapshot(dependencySnapshot),
      this.clientModuleStrategy,
      dependencySnapshot.cacheKey,
    );
    return pageHandler.handle(pathname, searchParams, nonce);
  }

  invalidate(): void {
    this.invalidationGeneration++;
    this.renderer = null;
    this.clientManifest = null;
    this.manifestHandler.clearCache();
  }

  private async ensureRenderer(): Promise<void> {
    while (!this.renderer) {
      if (!this.rendererPromise) {
        const generation = this.invalidationGeneration;
        const rendererPromise = this.initializeRenderer(generation);
        this.rendererPromise = rendererPromise;
        const clearRendererPromise = () => {
          if (this.rendererPromise === rendererPromise) this.rendererPromise = null;
        };
        void rendererPromise.then(clearRendererPromise, clearRendererPromise);
      }
      await this.rendererPromise;
    }
  }

  private async initializeRenderer(generation: number): Promise<void> {
    const clientManifest = await buildClientManifest(this.projectDir, this.appDir, this.fs);
    const reactVersion = await this.getReactVersion();
    if (generation !== this.invalidationGeneration) return;

    this.clientManifest = clientManifest;
    this.manifestHandler.clearCache();
    this.renderer = new RSCRenderer({
      clientManifest,
      projectDir: this.projectDir,
      mode: this.mode,
      clientModuleStrategy: this.clientModuleStrategy,
      reactVersion,
    });
  }

  private getReactVersion(): Promise<string> {
    this.reactVersionPromise ??= resolveProjectReactVersion({
      projectDir: this.projectDir,
      dependencyPinningSource: this.dependencyPinningSource,
      config: this.config,
    });
    return this.reactVersionPromise;
  }

  private getReactVersionForSnapshot(
    dependencySnapshot: DependencyPinningSnapshot,
  ): Promise<string> {
    if (dependencySnapshot.cacheKey.startsWith("on:")) {
      return resolveProjectReactVersion({
        projectDir: this.projectDir,
        dependencyPinningSource: this.dependencyPinningSource,
        config: this.config,
        dependencyPinningCacheKey: dependencySnapshot.cacheKey,
        dependencyPinningDependencies: dependencySnapshot.dependencies,
      });
    }
    return this.getReactVersion();
  }
}

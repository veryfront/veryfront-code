import type { ResolveFileOptions } from "../../base.ts";
import type {
  EnsureStyleArtifactBuildInput,
  Project,
  ProjectStyleArtifactResolution,
  ResolveStyleArtifactInput,
  UpsertStyleArtifactInput,
} from "../../veryfront-api-client/index.ts";
import type { GitHubConfig } from "../github/types.ts";
import type { DirectoryEntry } from "../shared-types.ts";
import type { RequestTokenProvenance } from "./request-context.ts";

export type { DirectoryEntry };

export interface FSAdapter {
  readFile(path: string): Promise<Uint8Array | string>;
  /** Read raw bytes without an intermediate text decode when supported. */
  readFileBytes?(path: string): Promise<Uint8Array>;
  /**
   * Read through EOF or at most `byteLimit` bytes directly from the backing
   * store.
   *
   * Adapters must omit this capability when their upstream API only supports
   * whole-object reads.
   */
  readFileBytesBounded?(path: string, byteLimit: number): Promise<Uint8Array>;
  readTextFile?(path: string): Promise<string>;
  readOptionalTextFile?(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
    size: number;
    mtime: Date | null;
  }>;

  readDir?(path: string): AsyncIterable<DirectoryEntry>;
  readdir?(path: string): AsyncIterable<DirectoryEntry> | Promise<DirectoryEntry[]>;

  writeFile?(path: string, content: string): Promise<void>;
  writeFileBytes?(path: string, content: Uint8Array): Promise<void>;
  mkdir?(path: string, options?: { recursive?: boolean }): Promise<void>;
  remove?(path: string, options?: { recursive?: boolean }): Promise<void>;

  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;

  resolveFile?(basePath: string, options?: ResolveFileOptions): Promise<string | null>;
  refreshSourceSnapshot?(reason?: string): Promise<void>;
  ensureSourceSnapshotFresh?(reason?: string): Promise<void>;
  getSourceSnapshotVersion?(): number | undefined | Promise<number | undefined>;
  /**
   * Resolve the request-scoped control-plane boundary for prepared CSS.
   *
   * Only Veryfront-backed adapters expose this capability. Local and other
   * non-Veryfront filesystems intentionally omit it and compile CSS locally.
   */
  getStyleArtifactAccess?(): Promise<StyleArtifactAccess>;
}

export interface ContextualFSAdapter extends FSAdapter {
  setRequestToken?(token: string): void;
  clearRequestToken?(): void;

  setRequestBranch?(branch: string | null): void;
  getRequestBranch?(): string | null;
  clearRequestBranch?(): void;

  setProductionMode?(enabled: boolean, releaseId?: string | null): void;

  createStyleConfigBinding?(): StyleConfigBinding | Promise<StyleConfigBinding>;
  installStyleConfig?(
    binding: StyleConfigBinding,
    config: Readonly<object>,
  ): boolean | Promise<boolean>;

  runWithContext?<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
      tokenProvenance?: RequestTokenProvenance;
    },
  ): Promise<T>;
}

export type ContentSource =
  | { type: "branch"; branch?: string }
  | { type: "environment"; name: string }
  | { type: "domain"; domain: string }
  | { type: "release"; releaseId?: string };

export interface ResolvedContentContext {
  sourceType: "branch" | "environment" | "release";
  projectSlug: string;
  branch?: string;
  environmentName?: string;
  releaseId?: string;
}

/** Request-scoped style-artifact operations bound to one project adapter. */
export interface StyleArtifactRegistry {
  resolveStyleArtifact(
    input: ResolveStyleArtifactInput,
  ): Promise<ProjectStyleArtifactResolution>;
  ensureStyleArtifactBuild(
    input: EnsureStyleArtifactBuildInput,
  ): Promise<ProjectStyleArtifactResolution>;
  upsertStyleArtifact(
    input: UpsertStyleArtifactInput,
  ): Promise<ProjectStyleArtifactResolution>;
}

/**
 * Immutable source and registry snapshot for one prepared-CSS request.
 *
 * The registry deliberately exposes bound operations rather than the mutable
 * API client that owns credentials and project-selection state.
 */
export interface StyleArtifactAccess {
  readonly contentContext: Readonly<ResolvedContentContext>;
  readonly registry: Readonly<StyleArtifactRegistry>;
}

export interface StylePregenerationFile {
  path: string;
  content?: string;
}

export interface PreviewStyleArtifactInfo {
  hash: string;
  assetPath: string;
}

/**
 * Opaque, one-shot authority to install style configuration for one exact
 * project content snapshot.
 *
 * Adapters validate object identity in addition to these diagnostic fields, so
 * callers cannot fabricate or replay a binding after its source revision moves.
 */
export interface StyleConfigBinding {
  readonly projectSlug: string;
  readonly sourceKey: string;
  readonly sourceRevision: number;
}

export interface StylePregenerationContext {
  projectSlug: string;
  projectDir?: string;
  contentContext: ResolvedContentContext | null;
  /**
   * Already validated project configuration supplied by the trusted hosted
   * runtime. Platform adapters keep this value opaque.
   */
  config?: Readonly<object>;
}

export interface StyleCallbacks {
  pregenerateStyles?: (
    files: StylePregenerationFile[],
    context: StylePregenerationContext,
  ) => Promise<PreviewStyleArtifactInfo | undefined>;
}

export interface FSAdapterConfig {
  type?: "local" | "veryfront-api" | "memory" | "github";
  projectDir?: string;
  veryfront?: {
    apiToken?: string;
    projectSlug?: string;
    projectId?: string;
    apiBaseUrl?: string;
    proxyMode?: boolean;
    contentSource?: ContentSource;
    cache?: {
      enabled?: boolean;
      ttl?: number;
      maxSize?: number;
      maxMemory?: number;
    };
    retry?: {
      /** Retries after the initial request, from 0 through 9. */
      maxRetries?: number;
      initialDelay?: number;
      maxDelay?: number;
    };
  };
  github?: GitHubConfig;
  invalidationCallbacks?: InvalidationCallbacks;
  styleCallbacks?: StyleCallbacks;
}

export interface VeryfrontFSState {
  initialized: boolean;
  projectDir?: string;
  projectData?: Project;
}

export interface CacheStats {
  cache: {
    size: number;
    memoryUsed: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
  poke?: {
    received: number;
    invalidationsTriggered: number;
    lastPokeTime: number;
    connectionId: string | null;
  };
}

export interface InvalidationProjectContext {
  projectId?: string;
  projectSlug?: string;
  projectDir?: string;
  environment?: "preview" | "production";
  branch?: string | null;
  releaseId?: string | null;
  contentSourceId?: string;
  styleArtifactHash?: string;
  styleAssetPath?: string;
}

export interface InvalidationCallbacks {
  clearSSRModuleCache?: () => void | Promise<void>;
  clearSSRModuleCacheForProject?: (projectId: string) => void | Promise<void>;
  clearRouterDetectionCacheForProject?: (projectId: string) => void | Promise<void>;
  clearProjectDiscoveryCacheForProject?: (projectId: string) => void | Promise<void>;
  clearModulePathCache?: () => void | Promise<void>;
  invalidateModulePaths?: (changedPaths: string[]) => void | Promise<void>;
  clearSnippetCacheForProject?: (projectSlug: string) => void | Promise<void>;
  triggerReload?: (changedPaths?: string[], project?: InvalidationProjectContext) => void;
  clearRendererCacheForProject?: (projectId: string) => void | Promise<void>;
  /** Invalidate project-level CSS cache when source files change */
  clearProjectCSSCache?: (projectSlug: string) => void | Promise<void>;
  /** Clear domain lookup cache to refresh release IDs after publishing */
  clearDomainCache?: () => void;
  /** Evict the current shared proxy adapter after successful invalidation */
  evictCurrentAdapter?: () => void;
}

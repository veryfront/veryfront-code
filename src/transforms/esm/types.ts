import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { DependencyHashCache } from "#veryfront/cache/dependency-graph.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";

export interface TransformOptions {
  dev?: boolean;
  projectId: string;
  jsxImportSource?: string;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
  ssr?: boolean;
  apiBaseUrl?: string;
  studioEmbed?: boolean;
  /** React version for transforms (from project config, defaults to DEFAULT_REACT_VERSION) */
  reactVersion?: string;
  /** Internal per-render dependency hash cache. */
  dependencyHashCache?: DependencyHashCache;
  /** Internal observer for meaningful transform milestones. */
  onProgress?: TransformProgressListener;
}

export interface TransformContext {
  source: string;
  filePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  options: TransformOptions;
}

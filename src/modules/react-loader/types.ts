import type * as React from "react";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";

export interface LoadComponentOptions {
  projectId?: string;
  /** Project slug for cache directory (human-readable name) */
  projectSlug?: string;
  /**
   * Render mode for every transform this load triggers. `true` selects
   * development semantics: no minification, no tree shaking, inline
   * sourcemaps, MDX development mode, and the dev-only SSR loader branches.
   *
   * Required, not optional with a default, because an omitted flag used to
   * resolve to `true` and hand a production render development semantics. A
   * required field moves that failure from a silent runtime downgrade to a
   * `deno task typecheck` failure in CI.
   */
  dev: boolean;
  moduleServerUrl?: string;
  /** Absolute request origin used to identify same-origin module URLs. */
  moduleServerOrigin?: string;
  vendorBundleHash?: string;
  /** If true, don't rewrite imports for module server (for server-side execution) */
  ssr?: boolean;
  /** Content source ID for cache isolation (branch name or release ID) */
  contentSourceId?: string;
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /** Bare npm package roots that the runtime resolves without bundling. */
  serverExternalPackages?: readonly string[];
  /** Internal stable flag + package dependency-map key for cache isolation. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace used to prove write-back authority. */
  dependencyPinningSource?: DependencyPinningSourceInput;
  /** Request mode ("preview" | "production") for studio features */
  mode?: string;
  /** Cooperative cancellation for request-scoped SSR transforms. */
  signal?: AbortSignal;
}

export interface ComponentSource {
  name: string;
  source: string;
  filePath: string;
}

export type ComponentMap = Record<string, React.ComponentType<Record<string, unknown>>>;

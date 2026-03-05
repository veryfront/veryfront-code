import type * as React from "react";

export interface LoadComponentOptions {
  projectId?: string;
  /** Project slug for cache directory (human-readable name) */
  projectSlug?: string;
  dev?: boolean;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
  /** If true, don't rewrite imports for module server (for server-side execution) */
  ssr?: boolean;
  /** Content source ID for cache isolation (branch name or release ID) */
  contentSourceId?: string;
  /** React version for transforms (from project config) */
  reactVersion?: string;
  /** Request mode ("preview" | "production") for studio features */
  mode?: string;
}

export interface ComponentSource {
  name: string;
  source: string;
  filePath: string;
}

export type ComponentMap = Record<string, React.ComponentType<Record<string, unknown>>>;

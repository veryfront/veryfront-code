import type * as React from "react";

export interface LoadComponentOptions {
  projectId?: string;

  dev?: boolean;

  moduleServerUrl?: string;

  vendorBundleHash?: string;

  ssr?: boolean; // If true, don't rewrite imports for module server (for server-side execution)

  /** Content source ID for cache isolation (branch name or release ID) */
  contentSourceId?: string;
}

export interface ComponentSource {
  name: string;

  source: string;

  filePath: string;
}

export type ComponentMap = Record<string, React.ComponentType<Record<string, unknown>>>;

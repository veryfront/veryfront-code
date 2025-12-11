import type * as React from "react";

export interface LoadComponentOptions {
  projectId?: string;

  dev?: boolean;

  moduleServerUrl?: string;

  vendorBundleHash?: string;

  ssr?: boolean;
}

export interface ComponentSource {
  name: string;

  source: string;

  filePath: string;
}

export type ComponentMap = Record<string, React.ComponentType<Record<string, unknown>>>;

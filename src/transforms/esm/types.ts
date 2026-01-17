import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

export interface TransformOptions {
  dev?: boolean;
  projectId: string;
  jsxImportSource?: string;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
  ssr?: boolean; // If true, don't rewrite imports for module server (for server-side execution)
  apiBaseUrl?: string; // Base URL for API (used for cross-project imports)
  studioEmbed?: boolean;
}

export interface TransformContext {
  source: string;
  filePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  options: TransformOptions;
}

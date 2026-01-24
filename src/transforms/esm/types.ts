import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

export interface TransformOptions {
  dev?: boolean;
  projectId: string;
  jsxImportSource?: string;
  moduleServerUrl?: string;
  vendorBundleHash?: string;
  ssr?: boolean;
  apiBaseUrl?: string;
  studioEmbed?: boolean;
}

export interface TransformContext {
  source: string;
  filePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  options: TransformOptions;
}

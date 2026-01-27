import type { RuntimeAdapter } from "../../platform/adapters/base.js";

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
}

export interface TransformContext {
  source: string;
  filePath: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  options: TransformOptions;
}

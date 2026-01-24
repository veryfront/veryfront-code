export interface BundlerOptions {
  sources: {
    path: string;
    content: string;
    type: "mdx" | "tsx" | "ts" | "jsx" | "js" | "css";
  }[];
  projectDir: string;
  outputDir?: string;
  mode: "development" | "production";
  platform?: "browser" | "node" | "neutral";
  external?: string[];
  globals?: Record<string, string>;
}

export interface BundleResult {
  outputs: Map<
    string,
    {
      path: string;
      content: string;
      type: string;
      meta?: Record<string, unknown>;
    }
  >;
  errors: Error[];
  warnings: string[];
  dependencies: Map<string, string[]>;
}

export interface MDXBundleOptions {
  content: string;
  filePath: string;
  projectDir: string;
  mode?: "development" | "production";
  globals?: Record<string, string>;
  remarkPlugins?: unknown[];
  rehypePlugins?: unknown[];
}

export interface MDXBundleResult {
  code: string;
  frontmatter: Record<string, unknown>;
  dependencies: string[];
  errors?: Error[];
}

export interface EmbeddedBundleManifest {
  version: 1;
  routes: { path: string; file: string; type: "page" | "api" }[];
  assets: { path: string; file: string; contentType: string }[];
}

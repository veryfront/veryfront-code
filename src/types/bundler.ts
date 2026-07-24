/** Options shared by the build renderer's source bundlers. */
export interface BundlerOptions {
  /** In-memory source files supplied to the bundler. */
  sources: Array<{
    /** Project-relative source path. */
    path: string;
    /** Source file contents. */
    content: string;
    /** Source syntax handled by the bundler. */
    type: "mdx" | "tsx" | "ts" | "jsx" | "js" | "css";
  }>;
  /** Absolute directory of the project being bundled. */
  projectDir: string;
  /** Optional directory for emitted bundle files. */
  outputDir?: string;
  /** Optimization mode used for this bundle. */
  mode: "development" | "production";
  /** Runtime target for generated modules. */
  platform?: "browser" | "node" | "neutral";
  /** Module specifiers that remain external. */
  external?: string[];
  /** Global replacements made available to source modules. */
  globals?: Record<string, string>;
}

/** Files, diagnostics, and dependencies produced by a bundle operation. */
export interface BundleResult {
  /** Emitted outputs keyed by their logical path. */
  outputs: Map<
    string,
    {
      /** Output path. */
      path: string;
      /** Emitted text contents. */
      content: string;
      /** Output media or module type. */
      type: string;
      /** Optional bundler-specific metadata. */
      meta?: Record<string, unknown>;
    }
  >;
  /** Errors that prevented a complete bundle. */
  errors: Error[];
  /** Non-fatal diagnostic messages. */
  warnings: string[];
  /** Source dependency paths keyed by source path. */
  dependencies: Map<string, string[]>;
}

/** Options for compiling one MDX source into an executable module. */
export interface MDXBundleOptions {
  /** Raw MDX source. */
  content: string;
  /** Source file path used for resolution and diagnostics. */
  filePath: string;
  /** Absolute directory of the source project. */
  projectDir: string;
  /** Optimization mode used for compilation. */
  mode?: "development" | "production";
  /** Global replacements made available to the MDX module. */
  globals?: Record<string, string>;
  /** Remark plugins passed to the MDX compiler. */
  remarkPlugins?: unknown[];
  /** Rehype plugins passed to the MDX compiler. */
  rehypePlugins?: unknown[];
}

/** Compiled MDX code and metadata returned by the MDX bundler. */
export interface MDXBundleResult {
  /** Executable module code. */
  code: string;
  /** Parsed frontmatter values. */
  frontmatter: Record<string, unknown>;
  /** Source dependencies discovered during compilation. */
  dependencies: string[];
  /** Optional compilation errors. */
  errors?: Error[];
}

/** Manifest embedded in a self-contained Veryfront build. */
export interface EmbeddedBundleManifest {
  /** Manifest format version. */
  version: 1;
  /** Page and API route entries included in the bundle. */
  routes: Array<{ path: string; file: string; type: "page" | "api" }>;
  /** Static assets included in the bundle. */
  assets: Array<{ path: string; file: string; contentType: string }>;
}

/**
 * Build System Type Definitions
 * Consolidated from cli/commands/build/types.ts and server/build-types.ts
 */

export interface BuildOptions {
  projectDir: string;
  outputDir?: string;

  // CLI-style options (shorthand)
  splitting?: boolean;
  compress?: boolean;
  prefetch?: boolean;

  // Server-style options (verbose)
  enableSplitting?: boolean;
  enableCompression?: boolean;
  enablePrefetch?: boolean;

  // Common options
  ssg?: boolean;
  include?: string[];
  exclude?: string[];
  dryRun?: boolean;
}

export interface BuildStats {
  pages: number;
  components: number;
  chunks: number;
  assets: number;
  totalSize: number;
  duration: number;
  ssgPaths?: string[];
}

export interface RouteInfo {
  path: string;
  file: string;
  slug: string;
}

export interface AppRouteInfo {
  path: string;
  pageFile: string;
  segments: string[];
  segmentDirs: string[];
}

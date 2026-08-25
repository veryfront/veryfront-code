/** Deterministic dependency analysis for the project's authored pages. */
export interface ChunkAnalysis {
  pages: Map<string, PageImports>;
  /** Number of distinct pages that import each external dependency. */
  sharedDeps: Map<string, number>;
  suggestedChunks: ChunkSuggestion[];
}

/** Source-ordered, duplicate-free imports discovered for one page. */
export interface PageImports {
  path: string;
  local: string[];
  remote: string[];
  shared: string[];
}

/** One heuristic vendor-chunk recommendation. */
export interface ChunkSuggestion {
  name: string;
  deps: string[];
  pages: string[];
  /** Estimated bytes saved; this is not a measured output-file size. */
  benefit: number;
}

/** Serializable chunk plan consumed by analysis tooling. */
export interface ChunkManifest {
  version: string;
  chunks: Record<
    string,
    {
      deps: string[];
      size: number;
    }
  >;
  pages: Record<
    string,
    {
      chunks: string[];
      deps: {
        local: string[];
        remote: string[];
        shared: string[];
      };
    }
  >;
}

/**
 * Minimal filesystem capability accepted by chunk analysis.
 *
 * Implementations must reject operational failures. A missing top-level scan
 * root is the only absence treated as an empty source set.
 */
export interface ChunkOptimizerFileSystem {
  readDir(path: string): AsyncIterable<unknown>;
  readTextFile(path: string): Promise<string>;
}

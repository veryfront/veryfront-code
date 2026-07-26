import type {
  RagSearchOptions,
  RagSearchResult,
  RagStoreBackend,
} from "#veryfront/embedding/index.ts";
import type { Tool } from "#veryfront/tool/types.ts";

/** Configuration for project knowledge indexing and retrieval. */
export interface ProjectKnowledgeConfig {
  /**
   * Project root used to resolve relative local paths.
   *
   * Hosted Veryfront Cloud request contexts ignore this for release-backed
   * content lookup, but local development uses it to find `knowledge/` and
   * `data/knowledge-index.json`.
   */
  projectDir?: string;
  /**
   * Directory containing source-controlled knowledge files.
   *
   * Defaults to `knowledge`.
   */
  contentDir?: string;
  /**
   * Local JSON index path.
   *
   * Defaults to `data/knowledge-index.json`.
   */
  storagePath?: string;
  contentExtensions?: string[];
  model?: string;
  backend?: RagStoreBackend;
  branch?: string;
  topK?: number;
  threshold?: number;
  maxQueryChars?: number;
}

/** Per-call options for project knowledge retrieval. */
export interface ProjectKnowledgeRetrieveOptions extends RagSearchOptions {
  maxQueryChars?: number;
}

/** Result returned from project knowledge retrieval. */
export interface ProjectKnowledgeResult {
  query: string;
  matches: RagSearchResult[];
  context: string;
}

/** Input accepted by local and hosted OKF knowledge lookup. */
export interface ProjectKnowledgeLookupInput {
  /** Optional project reference; hosted calls must match request scope. */
  project_reference?: string;
  /** Frontmatter/path query. */
  query?: string;
  /** Opaque cursor returned by a previous page. */
  cursor?: string;
  /** Specific document target, either a path string or an object containing a path-like field. */
  lookup_target?: unknown;
  /** Page size; bounded to the hosted-compatible maximum. */
  limit?: number;
  /** Number of deterministic manifest shards. */
  shard_count?: number;
  /** Zero-based shard selected from shard_count. */
  shard_index?: number;
}

/** Compact frontmatter field returned by manifest lookup. */
export interface ProjectKnowledgeLookupFrontmatterField {
  key: string;
  value: string;
}

/** One knowledge manifest match. */
export interface ProjectKnowledgeLookupItem {
  path: string;
  matched_fields: string[];
  frontmatter: ProjectKnowledgeLookupFrontmatterField[];
  /** Present for explicit lookup targets, including empty documents. */
  content?: string;
}

/** Cursor links returned by knowledge lookup. */
export interface ProjectKnowledgeLookupPageInfo {
  self: string | null;
  first: string | null;
  next: string | null;
  prev: string | null;
}

/** Shard metadata returned by knowledge lookup. */
export interface ProjectKnowledgeLookupShard {
  shard_index: number;
  shard_count: number;
  total_items: number;
}

/** Hosted-compatible knowledge lookup response. */
export interface ProjectKnowledgeLookupOutput {
  query: string;
  mode: "search" | "browse";
  data: ProjectKnowledgeLookupItem[];
  page_info: ProjectKnowledgeLookupPageInfo;
  returned: number;
  total_matches: number;
  shard: ProjectKnowledgeLookupShard;
}

/** Options for constructing the local search_knowledge tool. */
export interface CreateSearchKnowledgeToolOptions extends ProjectKnowledgeConfig {
  id?: string;
  description?: string;
}

/** Local tool matching the hosted search_knowledge contract. */
export type SearchKnowledgeTool = Tool<
  ProjectKnowledgeLookupInput,
  ProjectKnowledgeLookupOutput
>;

/** Helper for indexing and retrieving project knowledge. */
export interface ProjectKnowledge {
  /**
   * Index configured project knowledge explicitly.
   *
   * Keep this out of the chat request path. Use it during setup, deploy,
   * ingestion, or another controlled lifecycle step.
   */
  index(): Promise<void>;
  /**
   * Search the local OKF knowledge manifest using the same compact response
   * shape as Veryfront Cloud's `search_knowledge` tool. Explicit
   * `lookup_target` calls include document content. This does not build or
   * query the embedding index.
   */
  lookup(input: ProjectKnowledgeLookupInput): Promise<ProjectKnowledgeLookupOutput>;
  retrieve(
    query: string,
    options?: ProjectKnowledgeRetrieveOptions,
  ): Promise<ProjectKnowledgeResult>;
  search(query: string, options?: RagSearchOptions): Promise<RagSearchResult[]>;
}

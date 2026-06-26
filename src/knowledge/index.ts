/**
 * Project knowledge retrieval helpers.
 *
 * @module knowledge
 *
 * @example
 * ```ts
 * import { projectKnowledge } from "veryfront/knowledge";
 *
 * const knowledge = projectKnowledge();
 * await knowledge.index();
 * const result = await knowledge.retrieve("SSO login failure");
 * ```
 */

import { ragStore } from "#veryfront/embedding/index.ts";
import type {
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreBackend,
} from "#veryfront/embedding/index.ts";
import { isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";

const DEFAULT_CONTENT_DIR = "knowledge";
const DEFAULT_STORAGE_PATH = "data/knowledge-index.json";
const DEFAULT_TOP_K = 3;
const DEFAULT_QUERY_MAX_CHARS = 500;

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

/** Helper for indexing and retrieving project knowledge. */
export interface ProjectKnowledge {
  /**
   * Index configured project knowledge explicitly.
   *
   * Keep this out of the chat request path. Use it during setup, deploy,
   * ingestion, or another controlled lifecycle step.
   */
  index(): Promise<void>;
  retrieve(
    query: string,
    options?: ProjectKnowledgeRetrieveOptions,
  ): Promise<ProjectKnowledgeResult>;
  search(query: string, options?: RagSearchOptions): Promise<RagSearchResult[]>;
}

function resolveProjectPath(projectDir: string | undefined, path: string): string {
  if (!projectDir || isAbsolute(path)) return path;
  return join(projectDir, path);
}

/** Normalize a knowledge query before retrieval. */
export function normalizeKnowledgeQuery(
  query: string,
  maxChars: number = DEFAULT_QUERY_MAX_CHARS,
): string {
  return query.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/** Format search results into a deterministic prompt context block. */
export function formatKnowledgeContext(results: RagSearchResult[]): string {
  return results
    .map((result) => `[${result.title}] (score: ${result.score.toFixed(2)})\n${result.text}`)
    .join("\n\n---\n\n");
}

/** Create a project knowledge helper backed by the configured RAG store. */
export function projectKnowledge(config: ProjectKnowledgeConfig = {}): ProjectKnowledge {
  const store: RagStore = ragStore({
    model: config.model,
    backend: config.backend,
    branch: config.branch,
    contentDir: resolveProjectPath(config.projectDir, config.contentDir ?? DEFAULT_CONTENT_DIR),
    storagePath: resolveProjectPath(config.projectDir, config.storagePath ?? DEFAULT_STORAGE_PATH),
    contentExtensions: config.contentExtensions,
  });

  async function index(): Promise<void> {
    await store.indexContentDir();
  }

  async function search(
    query: string,
    options?: RagSearchOptions,
  ): Promise<RagSearchResult[]> {
    const normalizedQuery = normalizeKnowledgeQuery(query, config.maxQueryChars);
    if (!normalizedQuery) return [];
    return store.search(normalizedQuery, {
      topK: options?.topK ?? config.topK ?? DEFAULT_TOP_K,
      threshold: options?.threshold ?? config.threshold,
    });
  }

  return {
    index,
    async retrieve(
      query: string,
      options?: ProjectKnowledgeRetrieveOptions,
    ): Promise<ProjectKnowledgeResult> {
      const normalizedQuery = normalizeKnowledgeQuery(
        query,
        options?.maxQueryChars ?? config.maxQueryChars,
      );
      if (!normalizedQuery) return { query: "", matches: [], context: "" };

      const matches = await store.search(normalizedQuery, {
        topK: options?.topK ?? config.topK ?? DEFAULT_TOP_K,
        threshold: options?.threshold ?? config.threshold,
      });

      return {
        query: normalizedQuery,
        matches,
        context: formatKnowledgeContext(matches),
      };
    },
    search,
  };
}

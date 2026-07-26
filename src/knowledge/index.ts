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
import type { RagSearchOptions, RagSearchResult, RagStore } from "#veryfront/embedding/index.ts";
import { isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";
import {
  DEFAULT_CONTENT_DIR,
  DEFAULT_QUERY_MAX_CHARS,
  DEFAULT_STORAGE_PATH,
  normalizeProjectKnowledgeCallOptions,
  normalizeProjectKnowledgeConfig,
} from "./config.ts";
import { createSearchKnowledgeTool, searchProjectKnowledge } from "./lookup.ts";
import { formatKnowledgeContext, normalizeKnowledgeQuery } from "./query.ts";
import type {
  ProjectKnowledge,
  ProjectKnowledgeConfig,
  ProjectKnowledgeResult,
  ProjectKnowledgeRetrieveOptions,
} from "./types.ts";

export {
  createSearchKnowledgeTool,
  formatKnowledgeContext,
  normalizeKnowledgeQuery,
  searchProjectKnowledge,
};

export type {
  CreateSearchKnowledgeToolOptions,
  ProjectKnowledge,
  ProjectKnowledgeConfig,
  ProjectKnowledgeLookupFrontmatterField,
  ProjectKnowledgeLookupInput,
  ProjectKnowledgeLookupItem,
  ProjectKnowledgeLookupOutput,
  ProjectKnowledgeLookupPageInfo,
  ProjectKnowledgeLookupShard,
  ProjectKnowledgeResult,
  ProjectKnowledgeRetrieveOptions,
  SearchKnowledgeTool,
} from "./types.ts";

function resolveProjectPath(projectDir: string | undefined, path: string): string {
  if (!projectDir || isAbsolute(path)) return path;
  return join(projectDir, path);
}

/** Create a project knowledge helper backed by the configured RAG store. */
export function projectKnowledge(config: ProjectKnowledgeConfig = {}): ProjectKnowledge {
  const resolvedConfig = normalizeProjectKnowledgeConfig(config);
  const store: RagStore = ragStore({
    model: resolvedConfig.model,
    backend: resolvedConfig.backend,
    branch: resolvedConfig.branch,
    contentDir: resolveProjectPath(
      resolvedConfig.projectDir,
      resolvedConfig.contentDir ?? DEFAULT_CONTENT_DIR,
    ),
    storagePath: resolveProjectPath(
      resolvedConfig.projectDir,
      resolvedConfig.storagePath ?? DEFAULT_STORAGE_PATH,
    ),
    contentExtensions: resolvedConfig.contentExtensions,
  });

  async function index(): Promise<void> {
    await store.indexContentDir();
  }

  async function search(
    query: string,
    options?: RagSearchOptions,
  ): Promise<RagSearchResult[]> {
    const resolvedOptions = normalizeProjectKnowledgeCallOptions(
      options,
      resolvedConfig,
      false,
    );
    resolvedOptions.abortSignal?.throwIfAborted();
    const normalizedQuery = normalizeKnowledgeQuery(
      query,
      resolvedConfig.maxQueryChars ?? DEFAULT_QUERY_MAX_CHARS,
    );
    if (!normalizedQuery) return [];
    return await store.search(normalizedQuery, {
      topK: resolvedOptions.topK,
      threshold: resolvedOptions.threshold,
      abortSignal: resolvedOptions.abortSignal,
    });
  }

  return {
    index,
    lookup(input) {
      return searchProjectKnowledge(input, resolvedConfig);
    },
    async retrieve(
      query: string,
      options?: ProjectKnowledgeRetrieveOptions,
    ): Promise<ProjectKnowledgeResult> {
      const resolvedOptions = normalizeProjectKnowledgeCallOptions(
        options,
        resolvedConfig,
        true,
      );
      resolvedOptions.abortSignal?.throwIfAborted();
      const normalizedQuery = normalizeKnowledgeQuery(
        query,
        resolvedOptions.maxQueryChars,
      );
      if (!normalizedQuery) return { query: "", matches: [], context: "" };

      const matches = await store.search(normalizedQuery, {
        topK: resolvedOptions.topK,
        threshold: resolvedOptions.threshold,
        abortSignal: resolvedOptions.abortSignal,
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

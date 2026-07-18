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
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import type {
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreBackend,
} from "#veryfront/embedding/index.ts";
import { exists, readDir, readTextFile } from "#veryfront/platform/compat/index.ts";
import { extract } from "#veryfront/compat/std/front-matter-yaml.ts";
import { isAbsolute, join, relative } from "#veryfront/platform/compat/path/index.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import { tool } from "#veryfront/tool/factory.ts";
import type { JsonSchema } from "#veryfront/tool/schema/index.ts";
import type { Tool, ToolExecutionContext } from "#veryfront/tool/types.ts";

const DEFAULT_CONTENT_DIR = "knowledge";
const DEFAULT_STORAGE_PATH = "data/knowledge-index.json";
const DEFAULT_TOP_K = 3;
const DEFAULT_QUERY_MAX_CHARS = 500;
const DEFAULT_LOOKUP_LIMIT = 8;
const MAX_LOOKUP_LIMIT = 12;
const MAX_FRONTMATTER_FIELDS = 6;
const MAX_FRONTMATTER_VALUE_LENGTH = 240;
const KNOWLEDGE_LOOKUP_CURSOR_VERSION = 1;
const FRONTMATTER_FIELD_PRIORITY = [
  "title",
  "name",
  "description",
  "summary",
  "source",
  "source_type",
  "added",
] as const;

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

export interface ProjectKnowledgeLookupInput {
  project_reference?: string;
  query?: string;
  cursor?: string;
  lookup_target?: unknown;
  limit?: number;
  shard_count?: number;
  shard_index?: number;
}

export interface ProjectKnowledgeLookupFrontmatterField {
  key: string;
  value: string;
}

export interface ProjectKnowledgeLookupItem {
  path: string;
  matched_fields: string[];
  frontmatter: ProjectKnowledgeLookupFrontmatterField[];
  content?: string;
}

export interface ProjectKnowledgeLookupPageInfo {
  self: string | null;
  first: string | null;
  next: string | null;
  prev: string | null;
}

export interface ProjectKnowledgeLookupShard {
  shard_index: number;
  shard_count: number;
  total_items: number;
}

export interface ProjectKnowledgeLookupOutput {
  query: string;
  mode: "search" | "browse";
  data: ProjectKnowledgeLookupItem[];
  page_info: ProjectKnowledgeLookupPageInfo;
  returned: number;
  total_matches: number;
  shard: ProjectKnowledgeLookupShard;
}

export interface CreateSearchKnowledgeToolOptions extends ProjectKnowledgeConfig {
  id?: string;
  description?: string;
}

export type SearchKnowledgeTool = Tool<ProjectKnowledgeLookupInput, ProjectKnowledgeLookupOutput>;

interface ProjectKnowledgeManifestEntry {
  path: string;
  frontmatter: ProjectKnowledgeLookupFrontmatterField[];
  searchableFrontmatter: ProjectKnowledgeLookupFrontmatterField[];
  content?: string;
}

interface SearchableProjectKnowledgeManifestEntry extends ProjectKnowledgeManifestEntry {
  normalizedPath: string;
  searchableFrontmatter: Array<
    ProjectKnowledgeLookupFrontmatterField & {
      normalizedKey: string;
      normalizedValue: string;
    }
  >;
}

interface ProjectKnowledgeLookupCursorState {
  version: typeof KNOWLEDGE_LOOKUP_CURSOR_VERSION;
  query: string;
  offset: number;
  limit: number;
  shardCount: number;
  shardIndex: number;
}

interface HostedKnowledgeContext {
  projectRef: string;
  projectSlug?: string;
  projectId?: string;
  authToken: string;
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
}

const SEARCH_KNOWLEDGE_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    project_reference: {
      type: "string",
      description: "Project reference accepted for hosted/local parity.",
    },
    query: {
      type: "string",
      description: "Knowledge query to match against OKF frontmatter.",
    },
    cursor: {
      type: "string",
      description: "Cursor from a previous search_knowledge response.",
    },
    lookup_target: {
      type: "object",
      additionalProperties: true,
      description: "Optional target such as { path } for retrieving a specific knowledge document.",
    },
    limit: {
      type: "integer",
      description: "Maximum number of manifest entries to return.",
    },
    shard_count: {
      type: "integer",
      description: "Optional shard count for splitting large manifests.",
    },
    shard_index: {
      type: "integer",
      description: "Zero-based shard index.",
    },
  },
  additionalProperties: false,
};

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

function resolveProjectPath(projectDir: string | undefined, path: string): string {
  if (!projectDir || isAbsolute(path)) return path;
  return join(projectDir, path);
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripTrailingSlash(path: string): string {
  return toPosixPath(path).replace(/\/+$/, "");
}

function trimLeadingSlash(path: string): string {
  return toPosixPath(path).replace(/^\/+/, "");
}

function normalizeManifestPath(path: string): string {
  return trimLeadingSlash(path).replace(/^\.\//, "");
}

function buildHostedManifestPath(contentDir: string, filePath: string): string | null {
  const normalizedPath = trimLeadingSlash(filePath);
  const normalizedContentDir = stripTrailingSlash(trimLeadingSlash(contentDir)).replace(
    /^\.\//,
    "",
  );

  if (
    normalizedPath === normalizedContentDir || !normalizedPath.startsWith(
      `${normalizedContentDir}/`,
    )
  ) {
    return null;
  }

  if (!normalizedPath.endsWith(".md")) return null;
  return normalizedPath;
}

function buildManifestPath(config: ProjectKnowledgeConfig, absolutePath: string): string {
  const contentDir = config.contentDir ?? DEFAULT_CONTENT_DIR;
  const contentDirPath = resolveProjectPath(config.projectDir, contentDir);
  const relativeToContent = toPosixPath(relative(contentDirPath, absolutePath));

  if (!isAbsolute(contentDir)) {
    const normalizedContentDir = stripTrailingSlash(contentDir).replace(/^\.\//, "");
    return `${normalizedContentDir}/${relativeToContent}`;
  }

  if (config.projectDir) {
    return toPosixPath(relative(config.projectDir, absolutePath));
  }

  return relativeToContent;
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) return [];

  const files: string[] = [];
  for await (const entry of readDir(dir)) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory) {
      files.push(...await collectMarkdownFiles(entryPath));
      continue;
    }

    if (entry.isFile && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      normalizeText(value)
        .split(/\s+/)
        .filter((token) => token.length >= 2),
    ),
  ];
}

function hashPath(value: string): number {
  let hash = 5381;
  for (const char of value) {
    hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function collapseFrontmatterValue(value: unknown): string | null {
  if (value == null) return null;

  let stringValue = "";
  if (typeof value === "string") {
    stringValue = value;
  } else if (typeof value === "number" || typeof value === "boolean") {
    stringValue = String(value);
  } else if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    stringValue = iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  } else if (Array.isArray(value)) {
    stringValue = value
      .map((item) => collapseFrontmatterValue(item))
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .join(", ");
  } else {
    try {
      stringValue = JSON.stringify(value);
    } catch {
      stringValue = String(value);
    }
  }

  const collapsed = stringValue.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
}

function truncateFrontmatterValue(value: string): string {
  if (value.length <= MAX_FRONTMATTER_VALUE_LENGTH) return value;
  return `${value.slice(0, MAX_FRONTMATTER_VALUE_LENGTH - 3)}...`;
}

function compareFrontmatterFields(
  left: ProjectKnowledgeLookupFrontmatterField,
  right: ProjectKnowledgeLookupFrontmatterField,
): number {
  const leftPriority = FRONTMATTER_FIELD_PRIORITY.indexOf(
    left.key as typeof FRONTMATTER_FIELD_PRIORITY[number],
  );
  const rightPriority = FRONTMATTER_FIELD_PRIORITY.indexOf(
    right.key as typeof FRONTMATTER_FIELD_PRIORITY[number],
  );

  if (leftPriority !== rightPriority) {
    if (leftPriority === -1) return 1;
    if (rightPriority === -1) return -1;
    return leftPriority - rightPriority;
  }

  return left.key.localeCompare(right.key);
}

function collectFrontmatter(
  frontmatter: Record<string, unknown>,
): ProjectKnowledgeLookupFrontmatterField[] {
  return Object.entries(frontmatter)
    .map(([key, rawValue]) => {
      const value = collapseFrontmatterValue(rawValue);
      return value ? { key, value } : null;
    })
    .filter((entry): entry is ProjectKnowledgeLookupFrontmatterField => entry !== null)
    .sort(compareFrontmatterFields);
}

function sanitizeFrontmatter(frontmatter: Record<string, unknown>): {
  frontmatter: ProjectKnowledgeLookupFrontmatterField[];
  searchableFrontmatter: ProjectKnowledgeLookupFrontmatterField[];
} {
  const searchableFrontmatter = collectFrontmatter(frontmatter);
  return {
    frontmatter: searchableFrontmatter.slice(0, MAX_FRONTMATTER_FIELDS).map((field) => ({
      key: field.key,
      value: truncateFrontmatterValue(field.value),
    })),
    searchableFrontmatter,
  };
}

function toSearchableEntry(
  entry: ProjectKnowledgeManifestEntry,
): SearchableProjectKnowledgeManifestEntry {
  return {
    ...entry,
    normalizedPath: normalizeText(entry.path),
    searchableFrontmatter: entry.searchableFrontmatter.map((field) => ({
      ...field,
      normalizedKey: normalizeText(field.key),
      normalizedValue: normalizeText(field.value),
    })),
  };
}

function getLookupTargetPath(lookupTarget: unknown): string | null {
  if (typeof lookupTarget === "string" && lookupTarget.trim()) {
    return normalizeManifestPath(lookupTarget);
  }
  if (!lookupTarget || typeof lookupTarget !== "object" || Array.isArray(lookupTarget)) {
    return null;
  }

  const record = lookupTarget as Record<string, unknown>;
  for (const key of ["path", "source", "id", "documentCode", "document_code"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return normalizeManifestPath(value);
  }

  return null;
}

function createLookupItem(
  entry: ProjectKnowledgeManifestEntry,
  matchedFields: string[],
  includeContent = false,
): ProjectKnowledgeLookupItem {
  return {
    path: entry.path,
    matched_fields: matchedFields,
    frontmatter: entry.frontmatter,
    ...(includeContent && entry.content ? { content: entry.content } : {}),
  };
}

function encodeCursor(state: ProjectKnowledgeLookupCursorState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): ProjectKnowledgeLookupCursorState {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(cursor.length / 4) * 4,
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<
      ProjectKnowledgeLookupCursorState
    >;

    if (
      parsed.version !== KNOWLEDGE_LOOKUP_CURSOR_VERSION ||
      typeof parsed.query !== "string" ||
      typeof parsed.offset !== "number" ||
      typeof parsed.limit !== "number" ||
      typeof parsed.shardCount !== "number" ||
      typeof parsed.shardIndex !== "number"
    ) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid cursor payload" });
    }

    if (parsed.shardIndex < 0 || parsed.shardIndex >= parsed.shardCount) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Cursor shard_index must be within shard_count",
      });
    }

    return {
      version: parsed.version,
      query: parsed.query,
      offset: parsed.offset,
      limit: parsed.limit,
      shardCount: parsed.shardCount,
      shardIndex: parsed.shardIndex,
    };
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid knowledge lookup cursor" });
  }
}

function scoreEntry(
  entry: SearchableProjectKnowledgeManifestEntry,
  query: string,
  queryTokens: string[],
): { score: number; matchedFields: string[] } {
  const matchedFields = new Set<string>();
  const normalizedQuery = normalizeText(query);
  let score = 0;

  if (normalizedQuery && entry.normalizedPath.includes(normalizedQuery)) {
    score += 40;
    matchedFields.add("path");
  }

  for (const field of entry.searchableFrontmatter) {
    if (normalizedQuery && field.normalizedValue.includes(normalizedQuery)) {
      score += 28;
      matchedFields.add(field.key);
    }

    if (normalizedQuery && field.normalizedKey.includes(normalizedQuery)) {
      score += 12;
      matchedFields.add(field.key);
    }
  }

  if (queryTokens.length > 1) {
    for (const token of queryTokens) {
      if (entry.normalizedPath.includes(token)) {
        score += 10;
        matchedFields.add("path");
      }

      for (const field of entry.searchableFrontmatter) {
        if (field.normalizedValue.includes(token)) {
          score += 7;
          matchedFields.add(field.key);
        }

        if (field.normalizedKey.includes(token)) {
          score += 4;
          matchedFields.add(field.key);
        }
      }
    }
  }

  return {
    score,
    matchedFields: [...matchedFields].sort((left, right) => left.localeCompare(right)),
  };
}

async function getProjectKnowledgeManifest(
  config: ProjectKnowledgeConfig,
  context?: ToolExecutionContext,
): Promise<ProjectKnowledgeManifestEntry[]> {
  if (!config.projectDir) {
    const hostedManifest = await getHostedProjectKnowledgeManifest(config, context);
    if (hostedManifest) return hostedManifest;
  }

  const contentDir = resolveProjectPath(
    config.projectDir,
    config.contentDir ?? DEFAULT_CONTENT_DIR,
  );
  const files = (await collectMarkdownFiles(contentDir)).sort((left, right) =>
    buildManifestPath(config, left).localeCompare(buildManifestPath(config, right))
  );

  const manifest: ProjectKnowledgeManifestEntry[] = [];
  for (const file of files) {
    let parsedFrontmatter: Record<string, unknown> = {};
    try {
      const content = await readTextFile(file);
      parsedFrontmatter = extract<Record<string, unknown>>(content).attrs;
      manifest.push({
        path: buildManifestPath(config, file),
        content,
        ...sanitizeFrontmatter(parsedFrontmatter),
      });
      continue;
    } catch {
      parsedFrontmatter = {};
    }

    manifest.push({
      path: buildManifestPath(config, file),
      ...sanitizeFrontmatter(parsedFrontmatter),
    });
  }

  return manifest;
}

function getHostedKnowledgeContext(context?: ToolExecutionContext): HostedKnowledgeContext | null {
  const requestContext = getCurrentRequestContext();
  const authToken = typeof context?.authToken === "string" && context.authToken
    ? context.authToken
    : requestContext?.token;
  const projectSlug = typeof context?.projectSlug === "string" && context.projectSlug
    ? context.projectSlug
    : requestContext?.projectSlug;
  const projectId = typeof context?.projectId === "string" && context.projectId
    ? context.projectId
    : requestContext?.projectId;
  const projectRef = projectSlug ?? projectId;

  if (!authToken || !projectRef) return null;

  const productionMode = typeof context?.productionMode === "boolean"
    ? context.productionMode
    : requestContext?.productionMode ?? false;
  const releaseId = typeof context?.releaseId === "string" || context?.releaseId === null
    ? context.releaseId
    : requestContext?.releaseId ?? null;
  const branch = typeof context?.branch === "string" || context?.branch === null
    ? context.branch
    : requestContext?.branch ?? null;
  const environmentName =
    typeof context?.environmentName === "string" || context?.environmentName === null
      ? context.environmentName
      : requestContext?.environmentName ?? null;

  return {
    projectRef,
    projectSlug,
    projectId,
    authToken,
    productionMode,
    releaseId,
    branch,
    environmentName,
  };
}

function createHostedKnowledgeClient(hostedContext: HostedKnowledgeContext): VeryfrontApiClient {
  const client = new VeryfrontApiClient({
    apiBaseUrl: getHostEnv("VERYFRONT_API_URL") || "https://api.veryfront.com",
    proxyMode: true,
    projectId: hostedContext.projectId,
    projectSlug: hostedContext.projectRef,
  });

  client.setRequestToken(hostedContext.authToken);
  client.setProjectSlug(hostedContext.projectRef);

  if (hostedContext.productionMode && hostedContext.releaseId) {
    client.setContext({ type: "release", version: hostedContext.releaseId });
  } else if (hostedContext.productionMode && hostedContext.environmentName) {
    client.setContext({ type: "environment", name: hostedContext.environmentName });
  } else {
    client.setContext({ type: "branch", name: hostedContext.branch ?? "main" });
  }

  return client;
}

async function getHostedProjectKnowledgeManifest(
  config: ProjectKnowledgeConfig,
  context?: ToolExecutionContext,
): Promise<ProjectKnowledgeManifestEntry[] | null> {
  const hostedContext = getHostedKnowledgeContext(context);
  if (!hostedContext) return null;

  const contentDir = config.contentDir ?? DEFAULT_CONTENT_DIR;
  const client = createHostedKnowledgeClient(hostedContext);
  const contentPath = `${stripTrailingSlash(trimLeadingSlash(contentDir))}/`;
  const files = await client.listAllFiles({
    path: contentPath,
    sortBy: "path",
    sortOrder: "asc",
  });

  const manifest: ProjectKnowledgeManifestEntry[] = [];
  for (const file of files) {
    const manifestPath = buildHostedManifestPath(contentDir, file.path);
    if (!manifestPath || typeof file.content !== "string") continue;

    let parsedFrontmatter: Record<string, unknown> = {};
    try {
      parsedFrontmatter = extract<Record<string, unknown>>(file.content).attrs;
    } catch {
      parsedFrontmatter = {};
    }

    manifest.push({
      path: manifestPath,
      content: file.content,
      ...sanitizeFrontmatter(parsedFrontmatter),
    });
  }

  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

function lookupKnowledgeManifest(
  manifest: ProjectKnowledgeManifestEntry[],
  input: ProjectKnowledgeLookupInput,
): ProjectKnowledgeLookupOutput {
  const cursorState = input.cursor ? decodeCursor(input.cursor) : null;
  const providedQuery = input.query?.trim() ?? "";
  const resolvedQuery = (cursorState?.query ?? providedQuery).trim();
  const lookupTargetPath = cursorState ? null : getLookupTargetPath(input.lookup_target);

  if (!resolvedQuery && !lookupTargetPath) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "search_knowledge requires a non-empty query" });
  }

  if (cursorState && providedQuery && providedQuery !== cursorState.query) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "search_knowledge cursor query mismatch" });
  }

  const resolvedShardCount = cursorState?.shardCount ?? input.shard_count ?? 1;
  const resolvedShardIndex = cursorState?.shardIndex ?? input.shard_index ?? 0;

  if (resolvedShardCount < 1) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge shard_count must be at least 1",
    });
  }

  if (resolvedShardIndex < 0 || resolvedShardIndex >= resolvedShardCount) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge shard_index must be within shard_count",
    });
  }

  if (lookupTargetPath) {
    const entry = manifest.find((item) => normalizeManifestPath(item.path) === lookupTargetPath);
    const data = entry ? [createLookupItem(entry, ["path"], true)] : [];
    return {
      query: resolvedQuery || lookupTargetPath,
      mode: "search",
      data,
      page_info: {
        self: null,
        first: null,
        next: null,
        prev: null,
      },
      returned: data.length,
      total_matches: data.length,
      shard: {
        shard_index: resolvedShardIndex,
        shard_count: resolvedShardCount,
        total_items: manifest.length,
      },
    };
  }

  const resolvedLimit = Math.min(
    Math.max(cursorState?.limit ?? input.limit ?? DEFAULT_LOOKUP_LIMIT, 1),
    MAX_LOOKUP_LIMIT,
  );
  const resolvedOffset = Math.max(cursorState?.offset ?? 0, 0);
  const queryTokens = tokenize(resolvedQuery);

  const shardEntries = manifest
    .filter((entry) => hashPath(entry.path) % resolvedShardCount === resolvedShardIndex)
    .map(toSearchableEntry);

  const scoredEntries = shardEntries
    .map((entry) => ({
      entry,
      ...scoreEntry(entry, resolvedQuery, queryTokens),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.entry.path.localeCompare(right.entry.path);
    });

  const hasScoredMatches = scoredEntries.some((entry) => entry.score > 0);
  const mode = hasScoredMatches ? "search" : "browse";
  const orderedEntries = hasScoredMatches
    ? scoredEntries.filter((entry) => entry.score > 0)
    : scoredEntries;
  const pageEntries = orderedEntries.slice(resolvedOffset, resolvedOffset + resolvedLimit);
  const nextOffset = resolvedOffset + pageEntries.length;
  const hasMore = nextOffset < orderedEntries.length;
  const nextCursor = hasMore
    ? encodeCursor({
      version: KNOWLEDGE_LOOKUP_CURSOR_VERSION,
      query: resolvedQuery,
      offset: nextOffset,
      limit: resolvedLimit,
      shardCount: resolvedShardCount,
      shardIndex: resolvedShardIndex,
    })
    : null;

  return {
    query: resolvedQuery,
    mode,
    data: pageEntries.map(({ entry, matchedFields }) => createLookupItem(entry, matchedFields)),
    page_info: {
      self: input.cursor ?? null,
      first: null,
      next: nextCursor,
      prev: null,
    },
    returned: pageEntries.length,
    total_matches: orderedEntries.length,
    shard: {
      shard_index: resolvedShardIndex,
      shard_count: resolvedShardCount,
      total_items: shardEntries.length,
    },
  };
}

function coerceSearchKnowledgeInput(
  input: ProjectKnowledgeLookupInput,
): ProjectKnowledgeLookupInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "search_knowledge input must be an object" });
  }

  const value = input as Record<string, unknown>;
  return {
    project_reference: typeof value.project_reference === "string"
      ? value.project_reference
      : undefined,
    query: typeof value.query === "string" ? value.query : undefined,
    cursor: typeof value.cursor === "string" ? value.cursor : undefined,
    lookup_target: value.lookup_target,
    limit: typeof value.limit === "number" ? value.limit : undefined,
    shard_count: typeof value.shard_count === "number" ? value.shard_count : undefined,
    shard_index: typeof value.shard_index === "number" ? value.shard_index : undefined,
  };
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

/**
 * Search the local OKF knowledge manifest with the same input/output shape as
 * Veryfront Cloud's `search_knowledge` MCP tool.
 */
export async function searchProjectKnowledge(
  input: ProjectKnowledgeLookupInput,
  config: ProjectKnowledgeConfig = {},
  context?: ToolExecutionContext,
): Promise<ProjectKnowledgeLookupOutput> {
  const manifest = await getProjectKnowledgeManifest(config, context);
  return lookupKnowledgeManifest(manifest, input);
}

/** Create a local tool with the same id and response shape as hosted `search_knowledge`. */
export function createSearchKnowledgeTool(
  options: CreateSearchKnowledgeToolOptions = {},
): SearchKnowledgeTool {
  const { id = "search_knowledge", description, ...config } = options;

  return tool<ProjectKnowledgeLookupInput, ProjectKnowledgeLookupOutput>({
    id,
    description: description ??
      "Retrieve a compact, cursor-based slice of project knowledge, or a specific document by lookup target.",
    inputSchema: SEARCH_KNOWLEDGE_INPUT_SCHEMA,
    execute: (input, context) =>
      searchProjectKnowledge(coerceSearchKnowledgeInput(input), config, context),
  });
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
    lookup(input: ProjectKnowledgeLookupInput): Promise<ProjectKnowledgeLookupOutput> {
      return searchProjectKnowledge(input, config);
    },
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

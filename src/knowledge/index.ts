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
import {
  CONFIG_INVALID,
  INPUT_VALIDATION_FAILED,
  INVALID_ARGUMENT,
  VeryfrontError,
} from "#veryfront/errors";
import type {
  RagSearchOptions,
  RagSearchResult,
  RagStore,
  RagStoreBackend,
} from "#veryfront/embedding/index.ts";
export type {
  RagSearchOptions,
  RagSearchResult,
  RagStoreBackend,
} from "#veryfront/embedding/index.ts";
import { exists, readDir, readTextFile, stat } from "#veryfront/platform/compat/index.ts";
import { extract } from "#veryfront/compat/std/front-matter-yaml.ts";
import { basename, isAbsolute, join, relative } from "#veryfront/platform/compat/path/index.ts";
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
const MAX_LOOKUP_QUERY_CHARS = 500;
const MAX_KNOWLEDGE_QUERY_CHARS = 5 * 1_024 * 1_024;
const MAX_LOOKUP_CURSOR_CHARS = 8_192;
const MAX_LOOKUP_PATH_CHARS = 8_192;
const MAX_PROJECT_PATH_CHARS = 4_096;
const MAX_LOOKUP_SHARDS = 1_024;
const MAX_KNOWLEDGE_IDENTIFIER_CHARS = 512;
const MAX_CONTENT_EXTENSIONS = 64;
const MAX_CONTENT_EXTENSION_CHARS = 128;
const MAX_KNOWLEDGE_FILES = 10_000;
const MAX_KNOWLEDGE_DEPTH = 32;
const MAX_KNOWLEDGE_FILE_BYTES = 5 * 1_024 * 1_024;
const MAX_KNOWLEDGE_MANIFEST_BYTES = 64 * 1_024 * 1_024;
const MAX_FRONTMATTER_FIELDS = 6;
const MAX_FRONTMATTER_KEY_LENGTH = 256;
const MAX_FRONTMATTER_VALUE_LENGTH = 240;
const MAX_SEARCHABLE_FRONTMATTER_FIELDS = 64;
const MAX_SEARCHABLE_FRONTMATTER_VALUE_LENGTH = 4_096;
const KNOWLEDGE_LOOKUP_CURSOR_VERSION = 1;
const UTF8_ENCODER = new TextEncoder();
const SEARCH_KNOWLEDGE_INPUT_KEYS = new Set([
  "project_reference",
  "query",
  "cursor",
  "lookup_target",
  "limit",
  "shard_count",
  "shard_index",
]);
const PROJECT_KNOWLEDGE_CONFIG_KEYS = [
  "projectDir",
  "contentDir",
  "storagePath",
  "contentExtensions",
  "model",
  "backend",
  "branch",
  "topK",
  "threshold",
  "maxQueryChars",
] as const;
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
   * Providing this value opts into local content lookup, including when a
   * hosted request context is active. Omit it to use release-backed hosted
   * content when that context is available.
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
  /** File extensions accepted by embedding indexing. Manifest lookup reads OKF Markdown files. */
  contentExtensions?: string[];
  /** Embedding model in `provider/model` format. */
  model?: string;
  /** RAG persistence backend. Defaults to automatic selection. */
  backend?: RagStoreBackend;
  /** Branch used by a cloud-backed RAG store. Hosted manifest lookup uses the active context. */
  branch?: string;
  /** Default maximum embedding matches returned by `search` and `retrieve`. */
  topK?: number;
  /** Default minimum cosine-similarity score, from -1 through 1. */
  threshold?: number;
  /** Maximum normalized retrieval query length. Defaults to 500 characters. */
  maxQueryChars?: number;
}

/** Per-call options for project knowledge retrieval. */
export interface ProjectKnowledgeRetrieveOptions extends RagSearchOptions {
  /** Per-call maximum normalized query length. */
  maxQueryChars?: number;
}

/** Result returned from project knowledge retrieval. */
export interface ProjectKnowledgeResult {
  /** Normalized query sent to the RAG store. */
  query: string;
  /** Ranked RAG matches. */
  matches: RagSearchResult[];
  /** Matches formatted as a prompt context block. */
  context: string;
}

/** Input accepted by manifest-based project knowledge lookup. */
export interface ProjectKnowledgeLookupInput {
  /** Project reference retained for hosted tool shape compatibility. */
  project_reference?: string;
  /** Frontmatter query. Use a lookup target when no query is needed. */
  query?: string;
  /** Opaque cursor returned by an earlier lookup page. */
  cursor?: string;
  /** Document selector containing a path, source, ID, or document code. */
  lookup_target?: unknown;
  /** Requested page size. The lookup returns at most 12 entries. */
  limit?: number;
  /** Number of deterministic path shards. */
  shard_count?: number;
  /** Zero-based shard selected for this lookup. */
  shard_index?: number;
}

/** One compact frontmatter field returned by manifest lookup. */
export interface ProjectKnowledgeLookupFrontmatterField {
  /** Frontmatter key. */
  key: string;
  /** Collapsed and bounded display value. */
  value: string;
}

/** One project knowledge manifest result. */
export interface ProjectKnowledgeLookupItem {
  /** Project-relative knowledge source path. */
  path: string;
  /** Path or frontmatter fields that matched the query. */
  matched_fields: string[];
  /** Compact frontmatter fields suitable for tool output. */
  frontmatter: ProjectKnowledgeLookupFrontmatterField[];
  /** Full document content, included only for an explicit lookup target. */
  content?: string;
}

/** Cursor links for one knowledge lookup page. */
export interface ProjectKnowledgeLookupPageInfo {
  /** Cursor used for this page, or `null` for the first page. */
  self: string | null;
  /** First-page cursor when supplied by the backing surface. */
  first: string | null;
  /** Cursor for the next page. */
  next: string | null;
  /** Previous-page cursor when supplied by the backing surface. */
  prev: string | null;
}

/** Deterministic shard metadata for a knowledge lookup. */
export interface ProjectKnowledgeLookupShard {
  /** Zero-based selected shard. */
  shard_index: number;
  /** Total configured shard count. */
  shard_count: number;
  /** Manifest entries assigned to the selected shard. */
  total_items: number;
}

/** Paginated output returned by manifest-based project knowledge lookup. */
export interface ProjectKnowledgeLookupOutput {
  /** Effective query or explicit lookup target path. */
  query: string;
  /** `search` when fields matched, otherwise deterministic `browse` order. */
  mode: "search" | "browse";
  /** Entries returned on this page. */
  data: ProjectKnowledgeLookupItem[];
  /** Cursor links for this page. */
  page_info: ProjectKnowledgeLookupPageInfo;
  /** Number of entries returned on this page. */
  returned: number;
  /** Total matching entries within the selected shard. */
  total_matches: number;
  /** Selected shard metadata. */
  shard: ProjectKnowledgeLookupShard;
}

/** Options used to create a `search_knowledge` tool. */
export interface CreateSearchKnowledgeToolOptions extends ProjectKnowledgeConfig {
  /** Tool identifier. Defaults to `search_knowledge`. */
  id?: string;
  /** Tool description presented to the model. */
  description?: string;
}

/** Typed local or hosted project knowledge search tool. */
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

interface KnowledgeFileCollectionState {
  count: number;
}

interface KnowledgeManifestBudget {
  bytes: number;
}

function invalidKnowledgeArgument(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

function invalidKnowledgeLookup(detail: string): never {
  throw INPUT_VALIDATION_FAILED.create({ detail });
}

function rethrowSanitizedLocalKnowledgeError(error: unknown, signal?: AbortSignal): never {
  if (signal?.aborted) {
    throw new DOMException("Project knowledge lookup was aborted", "AbortError");
  }
  if (error instanceof VeryfrontError) throw error;
  if (typeof error === "object" && error !== null) {
    let isAbortError = false;
    try {
      isAbortError = Reflect.get(error, "name") === "AbortError";
    } catch {
      isAbortError = false;
    }
    if (isAbortError) {
      throw new DOMException("Project knowledge lookup was aborted", "AbortError");
    }
  }
  throw INPUT_VALIDATION_FAILED.create({
    detail: "Project knowledge files could not be read",
  });
}

function snapshotProperties(
  value: unknown,
  label: string,
  properties: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidKnowledgeArgument(`${label} must be an object`);
  }

  const snapshot: Record<string, unknown> = {};
  try {
    for (const property of properties) snapshot[property] = Reflect.get(value, property);
  } catch {
    invalidKnowledgeArgument(`${label} could not be read`);
  }
  return snapshot;
}

function snapshotOptionalString(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") invalidKnowledgeArgument(`${label} must be a string`);
  if (!allowEmpty && !value.trim()) invalidKnowledgeArgument(`${label} must not be empty`);
  if (value.length > maximum) {
    invalidKnowledgeArgument(`${label} exceeds ${maximum} characters`);
  }
  return value;
}

function validatePositiveInteger(
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    invalidKnowledgeArgument(`${label} must be a positive integer`);
  }
  if (Number(value) > maximum) {
    invalidKnowledgeArgument(`${label} must not exceed ${maximum}`);
  }
  return Number(value);
}

function snapshotProjectKnowledgeConfig(
  config: unknown,
): Readonly<ProjectKnowledgeConfig> {
  const values = snapshotProperties(
    config,
    "Project knowledge config",
    PROJECT_KNOWLEDGE_CONFIG_KEYS,
  );
  const rawContentExtensions = values.contentExtensions;
  let contentExtensions: string[] | undefined;
  if (rawContentExtensions !== undefined) {
    if (!Array.isArray(rawContentExtensions)) {
      invalidKnowledgeArgument("contentExtensions must be an array of strings");
    }
    if (rawContentExtensions.length > MAX_CONTENT_EXTENSIONS) {
      invalidKnowledgeArgument(
        `contentExtensions supports at most ${MAX_CONTENT_EXTENSIONS} entries`,
      );
    }
    contentExtensions = rawContentExtensions.map((extension) => {
      const stableExtension = snapshotOptionalString(
        extension,
        "Project knowledge content extension",
        MAX_CONTENT_EXTENSION_CHARS,
      )!;
      if (!stableExtension.startsWith(".")) {
        invalidKnowledgeArgument("Project knowledge content extensions must start with '.'");
      }
      return stableExtension.toLowerCase();
    });
    if (new Set(contentExtensions).size !== contentExtensions.length) {
      invalidKnowledgeArgument("contentExtensions must not contain duplicates");
    }
    Object.freeze(contentExtensions);
  }

  let backend: RagStoreBackend | undefined;
  switch (values.backend) {
    case undefined:
    case "auto":
    case "local-json":
    case "veryfront-cloud":
      backend = values.backend;
      break;
    default:
      invalidKnowledgeArgument(
        'Project knowledge backend must be "auto", "local-json", or "veryfront-cloud"',
      );
  }

  const topK = values.topK === undefined
    ? undefined
    : validatePositiveInteger(values.topK, "topK", 100);
  let threshold: number | undefined;
  if (values.threshold !== undefined) {
    if (
      typeof values.threshold !== "number" || !Number.isFinite(values.threshold) ||
      values.threshold < -1 || values.threshold > 1
    ) {
      invalidKnowledgeArgument("threshold must be a finite number between -1 and 1");
    }
    threshold = values.threshold;
  }
  const maxQueryChars = values.maxQueryChars === undefined ? undefined : validatePositiveInteger(
    values.maxQueryChars,
    "maxQueryChars",
    MAX_KNOWLEDGE_QUERY_CHARS,
  );

  return Object.freeze({
    projectDir: snapshotOptionalString(
      values.projectDir,
      "Project knowledge projectDir",
      MAX_PROJECT_PATH_CHARS,
    ),
    contentDir: snapshotOptionalString(
      values.contentDir,
      "Project knowledge contentDir",
      MAX_PROJECT_PATH_CHARS,
    ),
    storagePath: snapshotOptionalString(
      values.storagePath,
      "Project knowledge storagePath",
      MAX_PROJECT_PATH_CHARS,
    ),
    contentExtensions,
    model: snapshotOptionalString(
      values.model,
      "Project knowledge model",
      MAX_KNOWLEDGE_IDENTIFIER_CHARS,
      true,
    ),
    backend,
    branch: snapshotOptionalString(
      values.branch,
      "Project knowledge branch",
      MAX_KNOWLEDGE_IDENTIFIER_CHARS,
    ),
    topK,
    threshold,
    maxQueryChars,
  });
}

const SEARCH_KNOWLEDGE_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    project_reference: {
      type: "string",
      maxLength: MAX_KNOWLEDGE_IDENTIFIER_CHARS,
      description: "Project reference accepted for hosted/local parity.",
    },
    query: {
      type: "string",
      maxLength: MAX_LOOKUP_QUERY_CHARS,
      description: "Knowledge query to match against OKF frontmatter.",
    },
    cursor: {
      type: "string",
      maxLength: MAX_LOOKUP_CURSOR_CHARS,
      description: "Cursor from a previous search_knowledge response.",
    },
    lookup_target: {
      type: "object",
      additionalProperties: true,
      description: "Optional target such as { path } for retrieving a specific knowledge document.",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LOOKUP_LIMIT,
      description: "Maximum number of manifest entries to return.",
    },
    shard_count: {
      type: "integer",
      minimum: 1,
      maximum: MAX_LOOKUP_SHARDS,
      description: "Optional shard count for splitting large manifests.",
    },
    shard_index: {
      type: "integer",
      minimum: 0,
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
   * Search the active OKF knowledge manifest using the same compact response
   * shape locally and in Veryfront Cloud. Explicit `lookup_target` calls
   * include document content. This does not build or query the embedding index.
   */
  lookup(input: ProjectKnowledgeLookupInput): Promise<ProjectKnowledgeLookupOutput>;
  /** Retrieve ranked matches and a formatted prompt context block. */
  retrieve(
    query: string,
    options?: ProjectKnowledgeRetrieveOptions,
  ): Promise<ProjectKnowledgeResult>;
  /** Search the configured RAG store and return ranked matches. */
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

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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

  if (!normalizedPath.toLowerCase().endsWith(".md")) return null;
  return normalizedPath;
}

function buildManifestPath(config: ProjectKnowledgeConfig, absolutePath: string): string {
  const contentDir = config.contentDir ?? DEFAULT_CONTENT_DIR;
  const contentDirPath = resolveProjectPath(config.projectDir, contentDir);
  const relativeToContent = toPosixPath(relative(contentDirPath, absolutePath));

  if (!config.projectDir && !isAbsolute(contentDir)) {
    const normalizedContentDir = stripTrailingSlash(contentDir).replace(/^\.\//, "");
    return `${normalizedContentDir}/${relativeToContent}`;
  }

  const sourceRoot = basename(stripTrailingSlash(contentDirPath));
  return sourceRoot ? `${toPosixPath(sourceRoot)}/${relativeToContent}` : relativeToContent;
}

async function collectMarkdownFiles(
  dir: string,
  signal?: AbortSignal,
  depth = 0,
  state: KnowledgeFileCollectionState = { count: 0 },
): Promise<string[]> {
  signal?.throwIfAborted();
  if (depth > MAX_KNOWLEDGE_DEPTH) {
    invalidKnowledgeLookup("Project knowledge directory nesting is too deep");
  }
  if (depth === 0 && !(await exists(dir))) return [];

  const files: string[] = [];
  for await (const entry of readDir(dir)) {
    signal?.throwIfAborted();
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory) {
      files.push(...await collectMarkdownFiles(entryPath, signal, depth + 1, state));
      continue;
    }

    if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
      state.count++;
      if (state.count > MAX_KNOWLEDGE_FILES) {
        invalidKnowledgeLookup(
          `Project knowledge supports at most ${MAX_KNOWLEDGE_FILES} Markdown files`,
        );
      }
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
    .replace(/[^\p{L}\p{N}]+/gu, " ")
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

  return compareStrings(left.key, right.key);
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
    .sort(compareFrontmatterFields)
    .slice(0, MAX_SEARCHABLE_FRONTMATTER_FIELDS)
    .map((field) => ({
      key: field.key.slice(0, MAX_FRONTMATTER_KEY_LENGTH),
      value: field.value.slice(0, MAX_SEARCHABLE_FRONTMATTER_VALUE_LENGTH),
    }));
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
    if (lookupTarget.length > MAX_LOOKUP_PATH_CHARS) {
      invalidKnowledgeLookup(
        `search_knowledge lookup target exceeds ${MAX_LOOKUP_PATH_CHARS} characters`,
      );
    }
    return normalizeManifestPath(lookupTarget.trim());
  }
  if (!lookupTarget || typeof lookupTarget !== "object" || Array.isArray(lookupTarget)) {
    if (lookupTarget !== undefined && lookupTarget !== null && lookupTarget !== "") {
      invalidKnowledgeLookup("search_knowledge lookup_target must be an object or string");
    }
    return null;
  }

  for (const key of ["path", "source", "id", "documentCode", "document_code"]) {
    let value: unknown;
    try {
      value = Reflect.get(lookupTarget, key);
    } catch {
      invalidKnowledgeLookup("search_knowledge lookup_target could not be read");
    }
    if (typeof value !== "string" || !value.trim()) continue;
    if (value.length > MAX_LOOKUP_PATH_CHARS) {
      invalidKnowledgeLookup(
        `search_knowledge lookup target exceeds ${MAX_LOOKUP_PATH_CHARS} characters`,
      );
    }
    return normalizeManifestPath(value.trim());
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
    ...(includeContent && entry.content !== undefined ? { content: entry.content } : {}),
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
    if (
      cursor.length === 0 || cursor.length > MAX_LOOKUP_CURSOR_CHARS ||
      !/^[A-Za-z0-9_-]+$/.test(cursor)
    ) {
      throw new Error("Invalid cursor encoding");
    }
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
      parsed.query.length > MAX_LOOKUP_QUERY_CHARS ||
      !Number.isSafeInteger(parsed.offset) ||
      Number(parsed.offset) < 0 ||
      !Number.isSafeInteger(parsed.limit) ||
      Number(parsed.limit) < 1 ||
      Number(parsed.limit) > MAX_LOOKUP_LIMIT ||
      !Number.isSafeInteger(parsed.shardCount) ||
      Number(parsed.shardCount) < 1 ||
      Number(parsed.shardCount) > MAX_LOOKUP_SHARDS ||
      !Number.isSafeInteger(parsed.shardIndex)
    ) {
      throw new Error("Invalid cursor payload");
    }

    if (Number(parsed.shardIndex) < 0 || Number(parsed.shardIndex) >= Number(parsed.shardCount)) {
      throw new Error("Invalid cursor shard state");
    }

    return {
      version: parsed.version,
      query: parsed.query,
      offset: Number(parsed.offset),
      limit: Number(parsed.limit),
      shardCount: Number(parsed.shardCount),
      shardIndex: Number(parsed.shardIndex),
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
    matchedFields: [...matchedFields].sort(compareStrings),
  };
}

async function getLocalProjectKnowledgeManifest(
  config: Readonly<ProjectKnowledgeConfig>,
  signal?: AbortSignal,
): Promise<ProjectKnowledgeManifestEntry[]> {
  const contentDir = resolveProjectPath(
    config.projectDir,
    config.contentDir ?? DEFAULT_CONTENT_DIR,
  );
  const files = (await collectMarkdownFiles(contentDir, signal)).sort((left, right) =>
    compareStrings(buildManifestPath(config, left), buildManifestPath(config, right))
  );

  const manifest: ProjectKnowledgeManifestEntry[] = [];
  const budget: KnowledgeManifestBudget = { bytes: 0 };
  for (const file of files) {
    signal?.throwIfAborted();
    const fileInfo = await stat(file);
    if (fileInfo.size > MAX_KNOWLEDGE_FILE_BYTES) {
      invalidKnowledgeLookup(
        `Project knowledge files must not exceed ${MAX_KNOWLEDGE_FILE_BYTES} bytes`,
      );
    }
    const content = await readTextFile(file);
    const contentBytes = UTF8_ENCODER.encode(content).byteLength;
    if (contentBytes > MAX_KNOWLEDGE_FILE_BYTES) {
      invalidKnowledgeLookup(
        `Project knowledge files must not exceed ${MAX_KNOWLEDGE_FILE_BYTES} bytes`,
      );
    }
    budget.bytes += contentBytes;
    if (budget.bytes > MAX_KNOWLEDGE_MANIFEST_BYTES) {
      invalidKnowledgeLookup(
        `Project knowledge manifest must not exceed ${MAX_KNOWLEDGE_MANIFEST_BYTES} bytes`,
      );
    }

    let parsedFrontmatter: Record<string, unknown> = {};
    try {
      parsedFrontmatter = extract<Record<string, unknown>>(content).attrs;
    } catch {
      parsedFrontmatter = {};
    }

    manifest.push({
      path: buildManifestPath(config, file),
      content,
      ...sanitizeFrontmatter(parsedFrontmatter),
    });
  }

  return manifest;
}

async function getProjectKnowledgeManifest(
  config: Readonly<ProjectKnowledgeConfig>,
  context?: ToolExecutionContext,
): Promise<ProjectKnowledgeManifestEntry[]> {
  if (!config.projectDir) {
    const hostedManifest = await getHostedProjectKnowledgeManifest(config, context);
    if (hostedManifest) return hostedManifest;
  }

  try {
    return await getLocalProjectKnowledgeManifest(config, context?.abortSignal);
  } catch (error) {
    rethrowSanitizedLocalKnowledgeError(error, context?.abortSignal);
  }
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
  } else if (hostedContext.productionMode) {
    throw CONFIG_INVALID.create({
      detail: "Production knowledge lookup requires a release ID or environment name",
    });
  } else {
    client.setContext({ type: "branch", name: hostedContext.branch ?? "main" });
  }

  return client;
}

async function getHostedProjectKnowledgeManifest(
  config: Readonly<ProjectKnowledgeConfig>,
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
    maxFiles: MAX_KNOWLEDGE_FILES,
  }, { signal: context?.abortSignal });

  const manifest: ProjectKnowledgeManifestEntry[] = [];
  const budget: KnowledgeManifestBudget = { bytes: 0 };
  for (const file of files) {
    context?.abortSignal?.throwIfAborted();
    const manifestPath = buildHostedManifestPath(contentDir, file.path);
    if (!manifestPath || typeof file.content !== "string") continue;
    const contentBytes = UTF8_ENCODER.encode(file.content).byteLength;
    if (contentBytes > MAX_KNOWLEDGE_FILE_BYTES) {
      invalidKnowledgeLookup(
        `Project knowledge files must not exceed ${MAX_KNOWLEDGE_FILE_BYTES} bytes`,
      );
    }
    budget.bytes += contentBytes;
    if (budget.bytes > MAX_KNOWLEDGE_MANIFEST_BYTES) {
      invalidKnowledgeLookup(
        `Project knowledge manifest must not exceed ${MAX_KNOWLEDGE_MANIFEST_BYTES} bytes`,
      );
    }

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

  return manifest.sort((left, right) => compareStrings(left.path, right.path));
}

function lookupKnowledgeManifest(
  manifest: ProjectKnowledgeManifestEntry[],
  input: Readonly<ProjectKnowledgeLookupInput>,
): ProjectKnowledgeLookupOutput {
  const cursorState = input.cursor ? decodeCursor(input.cursor) : null;
  const providedQuery = input.query?.trim() ?? "";
  const resolvedQuery = (cursorState?.query ?? providedQuery).trim();
  const lookupTargetPath = cursorState ? null : getLookupTargetPath(input.lookup_target);

  if (cursorState && input.lookup_target !== undefined) {
    invalidKnowledgeLookup("search_knowledge cursor cannot be combined with lookup_target");
  }

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
    cursorState?.limit ?? input.limit ?? DEFAULT_LOOKUP_LIMIT,
    MAX_LOOKUP_LIMIT,
  );
  const resolvedOffset = cursorState?.offset ?? 0;
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
      return compareStrings(left.entry.path, right.entry.path);
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

function snapshotSearchKnowledgeInput(
  input: ProjectKnowledgeLookupInput,
): Readonly<ProjectKnowledgeLookupInput> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    invalidKnowledgeLookup("search_knowledge input must be an object");
  }

  let keys: string[];
  let value: Record<string, unknown>;
  try {
    keys = Object.keys(input);
    value = {
      project_reference: Reflect.get(input, "project_reference"),
      query: Reflect.get(input, "query"),
      cursor: Reflect.get(input, "cursor"),
      lookup_target: Reflect.get(input, "lookup_target"),
      limit: Reflect.get(input, "limit"),
      shard_count: Reflect.get(input, "shard_count"),
      shard_index: Reflect.get(input, "shard_index"),
    };
  } catch {
    invalidKnowledgeLookup("search_knowledge input could not be read");
  }

  const unknownKey = keys.find((key) => !SEARCH_KNOWLEDGE_INPUT_KEYS.has(key));
  if (unknownKey) invalidKnowledgeLookup("search_knowledge input contains an unknown field");

  const optionalString = (raw: unknown, label: string, maximum: number): string | undefined => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "string") invalidKnowledgeLookup(`${label} must be a string`);
    if (raw.length > maximum) invalidKnowledgeLookup(`${label} exceeds ${maximum} characters`);
    return raw;
  };
  const optionalPositiveInteger = (
    raw: unknown,
    label: string,
    maximum = Number.MAX_SAFE_INTEGER,
  ): number | undefined => {
    if (raw === undefined) return undefined;
    if (typeof raw !== "number") invalidKnowledgeLookup(`${label} must be a number`);
    if (!Number.isSafeInteger(raw) || raw <= 0) {
      invalidKnowledgeLookup(`${label} must be a positive integer`);
    }
    if (raw > maximum) invalidKnowledgeLookup(`${label} must not exceed ${maximum}`);
    return raw;
  };

  let shardIndex: number | undefined;
  if (value.shard_index !== undefined) {
    if (typeof value.shard_index !== "number") {
      invalidKnowledgeLookup("search_knowledge shard_index must be a number");
    }
    if (!Number.isSafeInteger(value.shard_index) || value.shard_index < 0) {
      invalidKnowledgeLookup("search_knowledge shard_index must be a non-negative integer");
    }
    shardIndex = value.shard_index;
  }
  const lookupTargetPath = getLookupTargetPath(value.lookup_target);

  return Object.freeze({
    project_reference: optionalString(
      value.project_reference,
      "search_knowledge project_reference",
      MAX_KNOWLEDGE_IDENTIFIER_CHARS,
    ),
    query: optionalString(value.query, "search_knowledge query", MAX_LOOKUP_QUERY_CHARS),
    cursor: optionalString(value.cursor, "search_knowledge cursor", MAX_LOOKUP_CURSOR_CHARS),
    lookup_target: lookupTargetPath ? Object.freeze({ path: lookupTargetPath }) : undefined,
    limit: optionalPositiveInteger(value.limit, "search_knowledge limit"),
    shard_count: optionalPositiveInteger(
      value.shard_count,
      "search_knowledge shard_count",
      MAX_LOOKUP_SHARDS,
    ),
    shard_index: shardIndex,
  });
}

/**
 * Normalize and bound a knowledge query before retrieval.
 *
 * @param query Query text to normalize.
 * @param maxChars Maximum returned characters. Defaults to 500.
 */
export function normalizeKnowledgeQuery(
  query: string,
  maxChars: number = DEFAULT_QUERY_MAX_CHARS,
): string {
  if (typeof query !== "string") invalidKnowledgeArgument("Knowledge query must be a string");
  if (query.length > MAX_KNOWLEDGE_QUERY_CHARS) {
    invalidKnowledgeArgument(
      `Knowledge query exceeds ${MAX_KNOWLEDGE_QUERY_CHARS} characters`,
    );
  }
  validatePositiveInteger(maxChars, "maxQueryChars", MAX_KNOWLEDGE_QUERY_CHARS);
  return query.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/**
 * Format search results into a deterministic prompt context block.
 *
 * @param results Ranked RAG results to format in their existing order.
 */
export function formatKnowledgeContext(results: RagSearchResult[]): string {
  return results
    .map((result) => `[${result.title}] (score: ${result.score.toFixed(2)})\n${result.text}`)
    .join("\n\n---\n\n");
}

/**
 * Search the active OKF knowledge manifest with the same input and output
 * shape locally and in Veryfront Cloud.
 *
 * @param input Query, cursor, shard, or explicit document target.
 * @param config Local paths and retrieval configuration.
 * @param context Optional trusted hosted project context and cancellation signal.
 */
export async function searchProjectKnowledge(
  input: ProjectKnowledgeLookupInput,
  config: ProjectKnowledgeConfig = {},
  context?: ToolExecutionContext,
): Promise<ProjectKnowledgeLookupOutput> {
  const stableInput = snapshotSearchKnowledgeInput(input);
  const stableConfig = snapshotProjectKnowledgeConfig(config);
  const manifest = await getProjectKnowledgeManifest(stableConfig, context);
  return lookupKnowledgeManifest(manifest, stableInput);
}

/** Create a project knowledge tool that uses local or active hosted content. */
export function createSearchKnowledgeTool(
  options: CreateSearchKnowledgeToolOptions = {},
): SearchKnowledgeTool {
  const values = snapshotProperties(options, "Search knowledge tool options", [
    ...PROJECT_KNOWLEDGE_CONFIG_KEYS,
    "id",
    "description",
  ]);
  const id = values.id === undefined ? "search_knowledge" : values.id;
  const description = values.description;
  const stableConfig = snapshotProjectKnowledgeConfig(values);
  if (typeof id !== "string") {
    invalidKnowledgeArgument("Tool id must be a non-empty string");
  }
  const resolvedDescription = description ??
    "Retrieve a compact, cursor-based slice of project knowledge, or a specific document by lookup target.";
  if (typeof resolvedDescription !== "string") {
    invalidKnowledgeArgument("Tool description must be a non-empty string");
  }

  return tool<ProjectKnowledgeLookupInput, ProjectKnowledgeLookupOutput>({
    id,
    description: resolvedDescription,
    inputSchema: SEARCH_KNOWLEDGE_INPUT_SCHEMA,
    execute: (input, context) => searchProjectKnowledge(input, stableConfig, context),
  });
}

/**
 * Create a project knowledge helper backed by the configured RAG store.
 *
 * The helper snapshots configuration at creation time. Indexed file sources
 * use bounded, relative identifiers instead of machine-absolute paths.
 */
export function projectKnowledge(config: ProjectKnowledgeConfig = {}): ProjectKnowledge {
  const stableConfig = snapshotProjectKnowledgeConfig(config);
  const store: RagStore = ragStore({
    model: stableConfig.model,
    backend: stableConfig.backend,
    branch: stableConfig.branch,
    contentDir: resolveProjectPath(
      stableConfig.projectDir,
      stableConfig.contentDir ?? DEFAULT_CONTENT_DIR,
    ),
    storagePath: resolveProjectPath(
      stableConfig.projectDir,
      stableConfig.storagePath ?? DEFAULT_STORAGE_PATH,
    ),
    contentExtensions: stableConfig.contentExtensions,
  });

  async function index(): Promise<void> {
    await store.indexContentDir();
  }

  async function search(
    query: string,
    options?: RagSearchOptions,
  ): Promise<RagSearchResult[]> {
    const normalizedQuery = normalizeKnowledgeQuery(query, stableConfig.maxQueryChars);
    if (!normalizedQuery) return [];
    return store.search(normalizedQuery, {
      topK: options?.topK ?? stableConfig.topK ?? DEFAULT_TOP_K,
      threshold: options?.threshold ?? stableConfig.threshold,
    });
  }

  return {
    index,
    lookup(input: ProjectKnowledgeLookupInput): Promise<ProjectKnowledgeLookupOutput> {
      return searchProjectKnowledge(input, stableConfig);
    },
    async retrieve(
      query: string,
      options?: ProjectKnowledgeRetrieveOptions,
    ): Promise<ProjectKnowledgeResult> {
      const normalizedQuery = normalizeKnowledgeQuery(
        query,
        options?.maxQueryChars ?? stableConfig.maxQueryChars,
      );
      if (!normalizedQuery) return { query: "", matches: [], context: "" };

      const matches = await store.search(normalizedQuery, {
        topK: options?.topK ?? stableConfig.topK ?? DEFAULT_TOP_K,
        threshold: options?.threshold ?? stableConfig.threshold,
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

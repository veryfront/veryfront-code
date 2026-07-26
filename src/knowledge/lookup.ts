/**
 * Bounded local and hosted OKF knowledge lookup.
 *
 * @module knowledge/lookup
 */

import { INPUT_VALIDATION_FAILED, VeryfrontError } from "#veryfront/errors";
import { base64urlEncodeBytes, MAX_PATH_LENGTH } from "#veryfront/utils";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
} from "#veryfront/utils/project-identity.ts";
import { isNotFoundError, readDir, readTextFile, stat } from "#veryfront/platform/compat/index.ts";
import { extractMapping } from "#veryfront/compat/std/front-matter-yaml.ts";
import { isAbsolute, join, relative } from "#veryfront/platform/compat/path/index.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { VeryfrontApiClient } from "#veryfront/platform/adapters/veryfront-api-client/client.ts";
import { resolveVeryfrontApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { tool } from "#veryfront/tool/factory.ts";
import type { JsonSchema } from "#veryfront/tool/schema/index.ts";
import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import {
  DEFAULT_CONTENT_DIR,
  DEFAULT_QUERY_MAX_CHARS,
  MAX_QUERY_CHARS,
  normalizeProjectKnowledgeConfig,
  normalizeSearchKnowledgeToolOptions,
  type ResolvedProjectKnowledgeConfig,
} from "./config.ts";
import { normalizeKnowledgeQuery } from "./query.ts";
import type {
  CreateSearchKnowledgeToolOptions,
  ProjectKnowledgeConfig,
  ProjectKnowledgeLookupFrontmatterField,
  ProjectKnowledgeLookupInput,
  ProjectKnowledgeLookupItem,
  ProjectKnowledgeLookupOutput,
  SearchKnowledgeTool,
} from "./types.ts";

const DEFAULT_LOOKUP_LIMIT = 8;
const MAX_LOOKUP_LIMIT = 12;
const MAX_LOOKUP_SHARD_COUNT = 256;
const MAX_LOOKUP_CURSOR_CODE_UNITS = 2_048;
const MAX_LOOKUP_QUERY_TOKENS = 16;
const MAX_MANIFEST_FILES = 10_000;
const MAX_MANIFEST_DIRECTORY_ENTRIES = 20_000;
const MAX_HOSTED_FILE_PAGES = 100;
const MAX_KNOWLEDGE_DOCUMENT_BYTES = 1024 * 1024;
const MAX_KNOWLEDGE_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_FRONTMATTER_FIELDS = 6;
const MAX_SEARCHABLE_FRONTMATTER_FIELDS = 64;
const MAX_FRONTMATTER_DEPTH = 16;
const MAX_FRONTMATTER_NODES = 1_024;
const MAX_FRONTMATTER_KEY_LENGTH = 128;
const MAX_FRONTMATTER_VALUE_LENGTH = 240;
const MAX_SEARCHABLE_FRONTMATTER_VALUE_LENGTH = 4_096;
const MAX_HOSTED_AUTH_TOKEN_CODE_UNITS = 16_384;
const KNOWLEDGE_LOOKUP_CURSOR_VERSION = 1;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const utf8Encoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const FRONTMATTER_FIELD_PRIORITY = [
  "title",
  "name",
  "description",
  "summary",
  "source",
  "source_type",
  "added",
] as const;

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
      minLength: 1,
      maxLength: MAX_PATH_LENGTH,
      description: "Project reference; hosted calls must match request scope.",
    },
    query: {
      type: "string",
      maxLength: DEFAULT_QUERY_MAX_CHARS,
      description: "Knowledge query to match against OKF frontmatter.",
    },
    cursor: {
      type: "string",
      maxLength: MAX_LOOKUP_CURSOR_CODE_UNITS,
      pattern: CURSOR_PATTERN.source,
      description: "Cursor from a previous search_knowledge response.",
    },
    lookup_target: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: MAX_PATH_LENGTH },
        { type: "object", additionalProperties: true, maxProperties: 16 },
      ],
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
      maximum: MAX_LOOKUP_SHARD_COUNT,
      description: "Optional shard count for splitting large manifests.",
    },
    shard_index: {
      type: "integer",
      minimum: 0,
      maximum: MAX_LOOKUP_SHARD_COUNT - 1,
      description: "Zero-based shard index.",
    },
  },
  additionalProperties: false,
};

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function trimLeadingSlash(path: string): string {
  return toPosixPath(path).replace(/^\/+/, "");
}

function normalizeManifestPath(path: string, label = "knowledge manifest path"): string {
  const normalized = trimLeadingSlash(path.trim())
    .replace(/^(?:\.\/)+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.length > MAX_PATH_LENGTH ||
    hasProjectIdentityControlCharacters(normalized) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `${label} must be a bounded canonical relative path`,
    });
  }
  return normalized;
}

function resolveProjectPath(projectDir: string | undefined, path: string): string {
  if (!projectDir || isAbsolute(path)) return path;
  return join(projectDir, path);
}

function buildHostedManifestPath(contentDir: string, filePath: string): string | null {
  const normalizedPath = normalizeManifestPath(
    filePath,
    "Hosted knowledge file path",
  );
  const normalizedContentDir = normalizeManifestPath(
    contentDir,
    "Hosted knowledge contentDir",
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
    const normalizedContentDir = normalizeManifestPath(
      contentDir,
      "Project knowledge contentDir",
    );
    return normalizeManifestPath(
      `${normalizedContentDir}/${relativeToContent}`,
      "Project knowledge document path",
    );
  }

  if (config.projectDir) {
    return normalizeManifestPath(
      toPosixPath(relative(config.projectDir, absolutePath)),
      "Project knowledge document path",
    );
  }

  return normalizeManifestPath(
    relativeToContent,
    "Project knowledge document path",
  );
}

async function collectMarkdownFiles(
  dir: string,
  signal?: AbortSignal,
): Promise<string[]> {
  signal?.throwIfAborted();
  try {
    const info = await stat(dir);
    if (!info.isDirectory) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Project knowledge contentDir must be a directory",
      });
    }
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }

  const files: string[] = [];
  const pendingDirectories = [dir];
  let entryCount = 0;

  while (pendingDirectories.length > 0) {
    signal?.throwIfAborted();
    const directory = pendingDirectories.pop()!;
    for await (const entry of readDir(directory)) {
      signal?.throwIfAborted();
      entryCount += 1;
      if (entryCount > MAX_MANIFEST_DIRECTORY_ENTRIES) {
        throw INPUT_VALIDATION_FAILED.create({
          detail:
            `Project knowledge traversal exceeds ${MAX_MANIFEST_DIRECTORY_ENTRIES} directory entries`,
        });
      }

      const entryPath = join(directory, entry.name);
      if (entry.isDirectory) {
        pendingDirectories.push(entryPath);
      } else if (entry.isFile && entry.name.endsWith(".md")) {
        files.push(entryPath);
        if (files.length > MAX_MANIFEST_FILES) {
          throw INPUT_VALIDATION_FAILED.create({
            detail: `Project knowledge manifest exceeds ${MAX_MANIFEST_FILES} documents`,
          });
        }
      }
    }
  }

  return files;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/(\p{Script=Latin})\p{Mark}+/gu, "$1")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}]+/gu, " ")
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

type CanonicalFrontmatterValue =
  | string
  | number
  | boolean
  | null
  | CanonicalFrontmatterValue[]
  | { [key: string]: CanonicalFrontmatterValue };

interface FrontmatterTraversalState {
  nodes: number;
  active: Set<object>;
}

function snapshotFrontmatterValue(
  value: unknown,
  depth: number,
  state: FrontmatterTraversalState,
): CanonicalFrontmatterValue {
  state.nodes += 1;
  if (depth > MAX_FRONTMATTER_DEPTH || state.nodes > MAX_FRONTMATTER_NODES) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Project knowledge frontmatter exceeds structural limits",
    });
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Project knowledge frontmatter numbers must be finite",
      });
    }
    return value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (!value || typeof value !== "object" || state.active.has(value)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: state.active.has(value as object)
        ? "Project knowledge frontmatter must be acyclic"
        : "Project knowledge frontmatter must contain data-only values",
    });
  }

  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        ownKeys.length !== length + 1 ||
        ownKeys.some((key) => typeof key === "symbol") ||
        !ownKeys.includes("length")
      ) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Project knowledge frontmatter arrays must be dense data-only arrays",
        });
      }
      const result: CanonicalFrontmatterValue[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
        if (
          !descriptor ||
          !("value" in descriptor) ||
          descriptor.enumerable !== true
        ) {
          throw INPUT_VALIDATION_FAILED.create({
            detail: "Project knowledge frontmatter arrays must contain data properties",
          });
        }
        result.push(
          snapshotFrontmatterValue(descriptor.value, depth + 1, state),
        );
      }
      return result;
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Project knowledge frontmatter must contain plain objects",
      });
    }
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length > MAX_FRONTMATTER_NODES ||
      ownKeys.some((key) => typeof key === "symbol")
    ) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Project knowledge frontmatter exceeds structural limits",
      });
    }

    const result: { [key: string]: CanonicalFrontmatterValue } = {};
    for (const key of ownKeys as string[]) {
      if (
        key.length === 0 ||
        key.length > MAX_FRONTMATTER_KEY_LENGTH ||
        hasProjectIdentityControlCharacters(key)
      ) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Project knowledge frontmatter contains an invalid field name",
        });
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Project knowledge frontmatter objects must contain data properties",
        });
      }
      Object.defineProperty(result, key, {
        value: snapshotFrontmatterValue(
          descriptor.value,
          depth + 1,
          state,
        ),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}

function collapseFrontmatterValue(
  value: unknown,
  state: FrontmatterTraversalState,
): string | null {
  const canonical = snapshotFrontmatterValue(value, 0, state);
  if (canonical === null) return null;
  let stringValue: string;
  if (typeof canonical === "string") {
    stringValue = canonical;
  } else if (
    typeof canonical === "number" ||
    typeof canonical === "boolean"
  ) {
    stringValue = String(canonical);
  } else if (Array.isArray(canonical)) {
    stringValue = canonical
      .map((item) => {
        if (item === null) return "";
        if (
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
        ) {
          return String(item);
        }
        return JSON.stringify(item);
      })
      .filter((item) => item.length > 0)
      .join(", ");
  } else {
    stringValue = JSON.stringify(canonical);
  }
  const collapsed = stringValue.replace(/\s+/gu, " ").trim();
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

  return stableCompare(left.key, right.key);
}

function collectFrontmatter(
  frontmatter: Record<string, unknown>,
): ProjectKnowledgeLookupFrontmatterField[] {
  const entries = Object.entries(frontmatter);
  if (entries.length > MAX_SEARCHABLE_FRONTMATTER_FIELDS) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Project knowledge frontmatter exceeds ${MAX_SEARCHABLE_FRONTMATTER_FIELDS} fields`,
    });
  }

  const traversalState: FrontmatterTraversalState = {
    nodes: 0,
    active: new Set<object>(),
  };
  return entries
    .map(([key, rawValue]) => {
      if (
        key.length === 0 ||
        key.length > MAX_FRONTMATTER_KEY_LENGTH ||
        hasProjectIdentityControlCharacters(key)
      ) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Project knowledge frontmatter contains an invalid field name",
        });
      }
      const value = collapseFrontmatterValue(rawValue, traversalState);
      return value
        ? {
          key,
          value: value.slice(0, MAX_SEARCHABLE_FRONTMATTER_VALUE_LENGTH),
        }
        : null;
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
    return normalizeManifestPath(lookupTarget, "search_knowledge lookup_target");
  }
  if (!lookupTarget || typeof lookupTarget !== "object" || Array.isArray(lookupTarget)) {
    return null;
  }

  const record = lookupTarget as Record<string, unknown>;
  for (const key of ["path", "source", "id", "documentCode", "document_code"]) {
    const descriptor = Reflect.getOwnPropertyDescriptor(record, key);
    if (!descriptor) continue;
    if (!("value" in descriptor)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "search_knowledge lookup_target must contain data properties",
      });
    }
    const value = descriptor.value;
    if (typeof value === "string" && value.trim()) {
      return normalizeManifestPath(value, "search_knowledge lookup_target");
    }
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
  return base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(state)));
}

function decodeCursor(cursor: string): ProjectKnowledgeLookupCursorState {
  try {
    const padded = cursor.replace(/-/g, "+").replace(/_/g, "/").padEnd(
      Math.ceil(cursor.length / 4) * 4,
      "=",
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed = JSON.parse(fatalUtf8Decoder.decode(bytes)) as unknown;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Reflect.getPrototypeOf(parsed) !== Object.prototype
    ) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid cursor payload" });
    }

    const record = parsed as Record<string, unknown>;
    if (
      Reflect.ownKeys(record).length !== 6 ||
      record.version !== KNOWLEDGE_LOOKUP_CURSOR_VERSION ||
      typeof record.query !== "string" ||
      record.query.length === 0 ||
      normalizeKnowledgeQuery(record.query) !== record.query ||
      !Number.isSafeInteger(record.offset) ||
      (record.offset as number) < 0 ||
      (record.offset as number) > MAX_MANIFEST_FILES ||
      !Number.isSafeInteger(record.limit) ||
      (record.limit as number) < 1 ||
      (record.limit as number) > MAX_LOOKUP_LIMIT ||
      !Number.isSafeInteger(record.shardCount) ||
      (record.shardCount as number) < 1 ||
      (record.shardCount as number) > MAX_LOOKUP_SHARD_COUNT ||
      !Number.isSafeInteger(record.shardIndex) ||
      (record.shardIndex as number) < 0 ||
      (record.shardIndex as number) >= (record.shardCount as number)
    ) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid cursor payload" });
    }

    const state: ProjectKnowledgeLookupCursorState = {
      version: KNOWLEDGE_LOOKUP_CURSOR_VERSION,
      query: record.query,
      offset: record.offset as number,
      limit: record.limit as number,
      shardCount: record.shardCount as number,
      shardIndex: record.shardIndex as number,
    };
    if (encodeCursor(state) !== cursor) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid cursor encoding" });
    }
    return state;
  } catch {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid knowledge lookup cursor" });
  }
}

function normalizeKnowledgeLookupCursor(cursor: unknown): string | undefined {
  if (cursor === undefined || cursor === null) return undefined;
  if (typeof cursor !== "string") {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid knowledge lookup cursor" });
  }

  const normalizedCursor = cursor.trim();
  if (normalizedCursor.length === 0) return undefined;
  if (
    normalizedCursor.length > MAX_LOOKUP_CURSOR_CODE_UNITS ||
    !CURSOR_PATTERN.test(normalizedCursor)
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid knowledge lookup cursor" });
  }
  return normalizedCursor;
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
    matchedFields: [...matchedFields].sort(stableCompare),
  };
}

function parseKnowledgeDocument(
  path: string,
  content: string,
): ProjectKnowledgeManifestEntry {
  let parsedFrontmatter: Record<string, unknown>;
  try {
    parsedFrontmatter = extractMapping(content).attrs;
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Invalid frontmatter in project knowledge document ${path}`,
    });
  }
  if (
    !parsedFrontmatter ||
    typeof parsedFrontmatter !== "object" ||
    Array.isArray(parsedFrontmatter)
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Invalid frontmatter in project knowledge document ${path}`,
    });
  }

  return {
    path,
    content,
    ...sanitizeFrontmatter(parsedFrontmatter),
  };
}

async function readLocalKnowledgeDocument(
  filePath: string,
  manifestPath: string,
  signal?: AbortSignal,
): Promise<{ content: string; bytes: number }> {
  signal?.throwIfAborted();
  let fileInfo: Awaited<ReturnType<typeof stat>>;
  try {
    fileInfo = await stat(filePath);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Unable to read project knowledge document ${manifestPath}`,
    });
  }
  if (!fileInfo.isFile) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Project knowledge document is not a file: ${manifestPath}`,
    });
  }
  if (fileInfo.size > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw INPUT_VALIDATION_FAILED.create({
      detail:
        `Project knowledge document ${manifestPath} exceeds ${MAX_KNOWLEDGE_DOCUMENT_BYTES} bytes`,
    });
  }

  let content: string;
  try {
    content = await readTextFile(filePath);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Unable to read project knowledge document ${manifestPath}`,
    });
  }
  signal?.throwIfAborted();
  const bytes = utf8Encoder.encode(content).byteLength;
  if (bytes > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw INPUT_VALIDATION_FAILED.create({
      detail:
        `Project knowledge document ${manifestPath} exceeds ${MAX_KNOWLEDGE_DOCUMENT_BYTES} bytes`,
    });
  }
  return { content, bytes };
}

function addUniqueManifestEntry(
  manifest: ProjectKnowledgeManifestEntry[],
  paths: Set<string>,
  entry: ProjectKnowledgeManifestEntry,
): void {
  if (paths.has(entry.path)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Project knowledge manifest contains duplicate path ${entry.path}`,
    });
  }
  paths.add(entry.path);
  manifest.push(entry);
}

async function getProjectKnowledgeManifest(
  config: ResolvedProjectKnowledgeConfig,
  context: ToolExecutionContext | undefined,
  requestedProjectReference: string | undefined,
): Promise<ProjectKnowledgeManifestEntry[]> {
  context?.abortSignal?.throwIfAborted();
  const hostedManifest = await getHostedProjectKnowledgeManifest(
    config,
    context,
    requestedProjectReference,
  );
  if (hostedManifest) return hostedManifest;

  const contentDir = resolveProjectPath(
    config.projectDir,
    config.contentDir ?? DEFAULT_CONTENT_DIR,
  );
  let collectedFiles: string[];
  try {
    collectedFiles = await collectMarkdownFiles(contentDir, context?.abortSignal);
  } catch (error) {
    if (
      error instanceof VeryfrontError ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw error;
    }
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Unable to read project knowledge content directory",
    });
  }
  const files = collectedFiles
    .map((file) => ({
      file,
      manifestPath: buildManifestPath(config, file),
    }))
    .sort((left, right) => stableCompare(left.manifestPath, right.manifestPath));

  const manifest: ProjectKnowledgeManifestEntry[] = [];
  const manifestPaths = new Set<string>();
  let totalBytes = 0;
  for (const { file, manifestPath } of files) {
    context?.abortSignal?.throwIfAborted();
    const document = await readLocalKnowledgeDocument(
      file,
      manifestPath,
      context?.abortSignal,
    );
    totalBytes += document.bytes;
    if (totalBytes > MAX_KNOWLEDGE_MANIFEST_BYTES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: `Project knowledge manifest exceeds ${MAX_KNOWLEDGE_MANIFEST_BYTES} UTF-8 bytes`,
      });
    }
    addUniqueManifestEntry(
      manifest,
      manifestPaths,
      parseKnowledgeDocument(manifestPath, document.content),
    );
  }

  return manifest;
}

function requireHostedContextString(
  value: unknown,
  label: string,
  maximum = MAX_PATH_LENGTH,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `search_knowledge ${label} must be a bounded non-empty canonical string`,
    });
  }
  return value;
}

function optionalHostedContextString(
  explicit: unknown,
  fallback: unknown,
  label: string,
): string | null {
  const value = explicit === undefined ? fallback : explicit;
  if (value === undefined || value === null) return null;
  return requireHostedContextString(value, label);
}

function getHostedKnowledgeContext(context?: ToolExecutionContext): HostedKnowledgeContext | null {
  const requestContext = getCurrentRequestContext();
  const rawAuthToken = context?.authToken === undefined ? requestContext?.token : context.authToken;
  const rawProjectSlug = context?.projectSlug === undefined
    ? requestContext?.projectSlug
    : context.projectSlug;
  const rawProjectId = context?.projectId === undefined
    ? requestContext?.projectId
    : context.projectId;

  const hasHostedIdentity = rawAuthToken !== undefined ||
    rawProjectSlug !== undefined ||
    rawProjectId !== undefined ||
    requestContext !== null ||
    (
      context?.productionMode !== undefined &&
      context.productionMode !== false
    ) ||
    context?.releaseId !== undefined ||
    context?.branch !== undefined ||
    context?.environmentName !== undefined;
  if (!hasHostedIdentity) return null;

  const authToken = requireHostedContextString(
    rawAuthToken,
    "authToken",
    MAX_HOSTED_AUTH_TOKEN_CODE_UNITS,
  );
  const projectSlug = rawProjectSlug === undefined
    ? undefined
    : requireHostedContextString(rawProjectSlug, "projectSlug");
  const projectId = rawProjectId === undefined
    ? undefined
    : requireHostedContextString(rawProjectId, "projectId");
  const projectRef = projectSlug ?? projectId;
  if (!projectRef) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge hosted context requires a project identity",
    });
  }

  const rawProductionMode = context?.productionMode === undefined
    ? requestContext?.productionMode
    : context.productionMode;
  if (
    rawProductionMode !== undefined &&
    typeof rawProductionMode !== "boolean"
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge productionMode must be a boolean",
    });
  }
  const productionMode = rawProductionMode ?? false;
  const releaseId = optionalHostedContextString(
    context?.releaseId,
    requestContext?.releaseId,
    "releaseId",
  );
  const branch = optionalHostedContextString(
    context?.branch,
    requestContext?.branch,
    "branch",
  );
  const environmentName = optionalHostedContextString(
    context?.environmentName,
    requestContext?.environmentName,
    "environmentName",
  );

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
    apiBaseUrl: resolveVeryfrontApiBaseUrlFromHostEnv(),
    apiToken: hostedContext.authToken,
    proxyMode: true,
    projectId: hostedContext.projectId,
    projectSlug: hostedContext.projectRef,
  });

  if (hostedContext.productionMode && hostedContext.releaseId) {
    client.setContext({ type: "release", version: hostedContext.releaseId });
  } else if (hostedContext.productionMode && hostedContext.environmentName) {
    client.setContext({ type: "environment", name: hostedContext.environmentName });
  } else if (hostedContext.productionMode) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge production knowledge lookup requires releaseId or environmentName",
    });
  } else {
    if (hostedContext.branch) {
      client.setContext({ type: "branch", name: hostedContext.branch });
    }
  }

  return client;
}

async function getHostedProjectKnowledgeManifest(
  config: ResolvedProjectKnowledgeConfig,
  context: ToolExecutionContext | undefined,
  requestedProjectReference: string | undefined,
): Promise<ProjectKnowledgeManifestEntry[] | null> {
  const hostedContext = getHostedKnowledgeContext(context);
  if (!hostedContext) return null;
  if (
    requestedProjectReference !== undefined &&
    requestedProjectReference !== hostedContext.projectSlug &&
    requestedProjectReference !== hostedContext.projectId
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge project_reference does not match request scope",
    });
  }

  const contentDir = config.contentDir ?? DEFAULT_CONTENT_DIR;
  if (isAbsolute(contentDir)) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "Hosted project knowledge contentDir must be project-relative",
    });
  }
  const client = createHostedKnowledgeClient(hostedContext);
  const contentPath = `${
    normalizeManifestPath(
      contentDir,
      "Hosted knowledge contentDir",
    )
  }/`;
  const manifest: ProjectKnowledgeManifestEntry[] = [];
  const manifestPaths = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;
  let fileCount = 0;
  let totalBytes = 0;
  do {
    context?.abortSignal?.throwIfAborted();
    pageCount += 1;
    const page = await client.listFiles({
      cursor,
      limit: 100,
      path: contentPath,
      signal: context?.abortSignal,
      sortBy: "path",
      sortOrder: "asc",
    });
    context?.abortSignal?.throwIfAborted();
    for (const file of page.files) {
      context?.abortSignal?.throwIfAborted();
      fileCount += 1;
      if (fileCount > MAX_MANIFEST_FILES) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: `Hosted project knowledge manifest exceeds ${MAX_MANIFEST_FILES} files`,
        });
      }

      const manifestPath = buildHostedManifestPath(contentDir, file.path);
      if (!manifestPath) continue;
      if (typeof file.content !== "string") {
        throw INPUT_VALIDATION_FAILED.create({
          detail: `Hosted project knowledge document has no content: ${manifestPath}`,
        });
      }

      const documentBytes = utf8Encoder.encode(file.content).byteLength;
      if (documentBytes > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
        throw INPUT_VALIDATION_FAILED.create({
          detail:
            `Project knowledge document ${manifestPath} exceeds ${MAX_KNOWLEDGE_DOCUMENT_BYTES} bytes`,
        });
      }
      totalBytes += documentBytes;
      if (totalBytes > MAX_KNOWLEDGE_MANIFEST_BYTES) {
        throw INPUT_VALIDATION_FAILED.create({
          detail:
            `Hosted project knowledge manifest exceeds ${MAX_KNOWLEDGE_MANIFEST_BYTES} UTF-8 bytes`,
        });
      }

      addUniqueManifestEntry(
        manifest,
        manifestPaths,
        parseKnowledgeDocument(manifestPath, file.content),
      );
    }

    const nextCursor = page.page_info.next;
    if (nextCursor === null) break;
    if (!isCanonicalOpaqueProjectIdentifier(nextCursor)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Hosted project knowledge returned an invalid pagination cursor",
      });
    }
    if (seenCursors.has(nextCursor)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "Hosted project knowledge returned a repeated pagination cursor",
      });
    }
    if (pageCount >= MAX_HOSTED_FILE_PAGES) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: `Hosted project knowledge listing exceeds ${MAX_HOSTED_FILE_PAGES} pages`,
      });
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (true);

  return manifest.sort((left, right) => stableCompare(left.path, right.path));
}

function lookupKnowledgeManifest(
  manifest: ProjectKnowledgeManifestEntry[],
  input: ProjectKnowledgeLookupInput,
): ProjectKnowledgeLookupOutput {
  const normalizedCursor = normalizeKnowledgeLookupCursor(input.cursor);
  const cursorState = normalizedCursor ? decodeCursor(normalizedCursor) : null;
  const providedQuery = input.query ?? "";
  const resolvedQuery = cursorState?.query ?? providedQuery;
  const lookupTargetPath = cursorState ? null : getLookupTargetPath(input.lookup_target);

  if (!resolvedQuery && !lookupTargetPath) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "search_knowledge requires a non-empty query" });
  }

  if (cursorState && providedQuery && providedQuery !== cursorState.query) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "search_knowledge cursor query mismatch" });
  }
  if (
    cursorState &&
    (
      (input.limit !== undefined && input.limit !== cursorState.limit) ||
      (
        input.shard_count !== undefined &&
        input.shard_count !== cursorState.shardCount
      ) ||
      (
        input.shard_index !== undefined &&
        input.shard_index !== cursorState.shardIndex
      )
    )
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge cursor pagination options mismatch",
    });
  }

  const resolvedShardCount = cursorState?.shardCount ?? input.shard_count ?? 1;
  const resolvedShardIndex = cursorState?.shardIndex ?? input.shard_index ?? 0;

  if (lookupTargetPath) {
    if (input.shard_count !== undefined || input.shard_index !== undefined) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "search_knowledge lookup_target cannot be combined with sharding",
      });
    }
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

  const resolvedLimit = cursorState?.limit ?? input.limit ?? DEFAULT_LOOKUP_LIMIT;
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
      return stableCompare(left.entry.path, right.entry.path);
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
      self: normalizedCursor ?? null,
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
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    (
      Reflect.getPrototypeOf(input) !== Object.prototype &&
      Reflect.getPrototypeOf(input) !== null
    )
  ) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "search_knowledge input must be an object" });
  }

  const allowedKeys = new Set([
    "project_reference",
    "query",
    "cursor",
    "lookup_target",
    "limit",
    "shard_count",
    "shard_index",
  ]);
  const value: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "search_knowledge input contains an unsupported field",
      });
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: "search_knowledge input must contain enumerable data properties",
      });
    }
    value[key] = descriptor.value;
  }

  const projectReference = value.project_reference;
  if (
    projectReference !== undefined &&
    !isCanonicalOpaqueProjectIdentifier(projectReference)
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge project_reference must be a bounded canonical identifier",
    });
  }

  const query = value.query;
  if (query !== undefined && typeof query !== "string") {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge query must be a string",
    });
  }
  let normalizedQuery: string | undefined;
  try {
    normalizedQuery = query === undefined
      ? undefined
      : normalizeKnowledgeQuery(query, MAX_QUERY_CHARS);
  } catch {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge query exceeds the supported input limit",
    });
  }
  if (
    normalizedQuery !== undefined &&
    normalizedQuery.length > DEFAULT_QUERY_MAX_CHARS
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail:
        `search_knowledge query must not exceed ${DEFAULT_QUERY_MAX_CHARS} normalized code units`,
    });
  }
  if (
    normalizedQuery &&
    tokenize(normalizedQuery).length > MAX_LOOKUP_QUERY_TOKENS
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail:
        `search_knowledge query exceeds ${MAX_LOOKUP_QUERY_TOKENS} distinct searchable tokens`,
    });
  }

  const cursor = normalizeKnowledgeLookupCursor(value.cursor);
  if (cursor !== undefined) decodeCursor(cursor);

  const requireLookupInteger = (
    candidate: unknown,
    label: string,
    minimum: number,
    maximum: number,
  ): number | undefined => {
    if (candidate === undefined) return undefined;
    if (
      typeof candidate !== "number" ||
      !Number.isSafeInteger(candidate) ||
      candidate < minimum ||
      candidate > maximum
    ) {
      throw INPUT_VALIDATION_FAILED.create({
        detail:
          `search_knowledge ${label} must be a safe integer between ${minimum} and ${maximum}`,
      });
    }
    return candidate;
  };

  const limit = requireLookupInteger(value.limit, "limit", 1, MAX_LOOKUP_LIMIT);
  const shardCount = requireLookupInteger(
    value.shard_count,
    "shard_count",
    1,
    MAX_LOOKUP_SHARD_COUNT,
  );
  const shardIndex = requireLookupInteger(
    value.shard_index,
    "shard_index",
    0,
    (shardCount ?? 1) - 1,
  );

  const lookupTarget = value.lookup_target;
  if (
    lookupTarget !== undefined &&
    typeof lookupTarget !== "string" &&
    (
      !lookupTarget ||
      typeof lookupTarget !== "object" ||
      Array.isArray(lookupTarget) ||
      Reflect.ownKeys(lookupTarget).length > 16
    )
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge lookup_target must be a string or bounded object",
    });
  }

  if (cursor !== undefined && lookupTarget !== undefined) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge cursor cannot be combined with lookup_target",
    });
  }

  const lookupTargetPath = lookupTarget === undefined ? null : getLookupTargetPath(lookupTarget);
  if (lookupTarget !== undefined && !lookupTargetPath) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge lookup_target does not contain a canonical path",
    });
  }
  if (!normalizedQuery && cursor === undefined && !lookupTargetPath) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge requires a non-empty query",
    });
  }

  return {
    project_reference: projectReference as string | undefined,
    query: normalizedQuery,
    cursor,
    lookup_target: lookupTargetPath ?? lookupTarget,
    limit,
    shard_count: shardCount,
    shard_index: shardIndex,
  };
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
  let normalizedInput: ProjectKnowledgeLookupInput;
  try {
    normalizedInput = coerceSearchKnowledgeInput(input);
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    throw INPUT_VALIDATION_FAILED.create({
      detail: "search_knowledge input must be a bounded data-only object",
    });
  }
  const resolvedConfig = normalizeProjectKnowledgeConfig(config);
  context?.abortSignal?.throwIfAborted();
  const manifest = await getProjectKnowledgeManifest(
    resolvedConfig,
    context,
    normalizedInput.project_reference,
  );
  context?.abortSignal?.throwIfAborted();
  return lookupKnowledgeManifest(manifest, normalizedInput);
}

/** Create a local tool with the same id and response shape as hosted `search_knowledge`. */
export function createSearchKnowledgeTool(
  options: CreateSearchKnowledgeToolOptions = {},
): SearchKnowledgeTool {
  const { id, description, config } = normalizeSearchKnowledgeToolOptions(
    options,
  );

  return tool<ProjectKnowledgeLookupInput, ProjectKnowledgeLookupOutput>({
    id,
    description: description ??
      "Retrieve a compact, cursor-based slice of project knowledge, or a specific document by lookup target.",
    inputSchema: SEARCH_KNOWLEDGE_INPUT_SCHEMA,
    execute: (input, context) => searchProjectKnowledge(input, config, context),
  });
}

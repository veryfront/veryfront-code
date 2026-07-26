import {
  requirePositiveSafeInteger,
  requireUnitInterval,
} from "#veryfront/embedding/validation.ts";
import type { RagSearchOptions } from "#veryfront/embedding/index.ts";
import { hasProjectIdentityControlCharacters } from "#veryfront/utils/project-identity.ts";
import type { CreateSearchKnowledgeToolOptions, ProjectKnowledgeConfig } from "./types.ts";

export const DEFAULT_CONTENT_DIR = "knowledge";
export const DEFAULT_STORAGE_PATH = "data/knowledge-index.json";
export const DEFAULT_TOP_K = 3;
export const DEFAULT_QUERY_MAX_CHARS = 500;
export const MAX_QUERY_CHARS = 4_096;
export const MAX_RAW_QUERY_CODE_UNITS = 64 * 1024;
const MAX_CONFIG_PATH_CODE_UNITS = 4_096;
const MAX_CONFIG_STRING_CODE_UNITS = 4_096;
const MAX_CONTENT_EXTENSIONS = 32;
const MAX_SEARCH_TOP_K = 100;
const RAG_BACKENDS = new Set(["auto", "local-json", "veryfront-cloud"]);
const PROJECT_KNOWLEDGE_CONFIG_KEYS = new Set([
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
]);
const SEARCH_KNOWLEDGE_TOOL_OPTION_KEYS = new Set([
  ...PROJECT_KNOWLEDGE_CONFIG_KEYS,
  "id",
  "description",
]);
const PROJECT_KNOWLEDGE_SEARCH_OPTION_KEYS = new Set([
  "topK",
  "threshold",
  "abortSignal",
]);
const PROJECT_KNOWLEDGE_RETRIEVE_OPTION_KEYS = new Set([
  ...PROJECT_KNOWLEDGE_SEARCH_OPTION_KEYS,
  "maxQueryChars",
]);
const MAX_TOOL_ID_CODE_UNITS = 256;
const MAX_TOOL_DESCRIPTION_CODE_UNITS = 16 * 1024;

export type ResolvedProjectKnowledgeConfig = Readonly<ProjectKnowledgeConfig>;

class ProjectKnowledgeConfigError extends TypeError {}

function snapshotProjectKnowledgeConfig(
  value: object,
  allowedKeys: ReadonlySet<string> = PROJECT_KNOWLEDGE_CONFIG_KEYS,
  label = "Project knowledge config",
): Record<string, unknown> {
  try {
    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ProjectKnowledgeConfigError(
        `${label} must be a plain object`,
      );
    }

    const snapshot: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (
        typeof key !== "string" ||
        !allowedKeys.has(key)
      ) {
        throw new ProjectKnowledgeConfigError(
          `${label} contains an unsupported field`,
        );
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        throw new ProjectKnowledgeConfigError(
          `${label} must contain enumerable data properties`,
        );
      }
      Object.defineProperty(snapshot, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return snapshot;
  } catch (error) {
    if (error instanceof ProjectKnowledgeConfigError) throw error;
    throw new ProjectKnowledgeConfigError(
      `${label} must be a bounded data-only object`,
    );
  }
}

function optionalCanonicalString(
  value: unknown,
  label: string,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    hasProjectIdentityControlCharacters(value)
  ) {
    throw new TypeError(`${label} must be a bounded non-empty canonical string`);
  }
  return value;
}

function optionalContentExtensions(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TypeError(
      `Project knowledge contentExtensions must be an array with at most ${MAX_CONTENT_EXTENSIONS} entries`,
    );
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  const ownKeys = Reflect.ownKeys(value);
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_CONTENT_EXTENSIONS ||
    ownKeys.length !== length + 1 ||
    ownKeys.some((key) => typeof key === "symbol") ||
    !ownKeys.includes("length")
  ) {
    throw new TypeError(
      `Project knowledge contentExtensions must be a dense data-only array with at most ${MAX_CONTENT_EXTENSIONS} entries`,
    );
  }

  const extensions: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index++) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.enumerable !== true
    ) {
      throw new TypeError(
        "Project knowledge contentExtensions must contain enumerable data properties",
      );
    }
    const extension = optionalCanonicalString(
      descriptor.value,
      `Project knowledge contentExtensions[${index}]`,
      32,
    );
    if (!extension?.startsWith(".")) {
      throw new TypeError(
        `Project knowledge contentExtensions[${index}] must start with "."`,
      );
    }
    if (seen.has(extension)) {
      throw new TypeError(
        `Project knowledge contentExtensions contains duplicate entry "${extension}"`,
      );
    }
    seen.add(extension);
    extensions.push(extension);
  }
  return extensions;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw new TypeError(`${label} must be a number`);
  }
  return value;
}

/**
 * Validate and detach public knowledge configuration from caller mutation.
 *
 * The returned object contains only known data properties and a cloned
 * extension list, so asynchronous lookup cannot observe later config changes.
 */
export function normalizeProjectKnowledgeConfig(
  value: ProjectKnowledgeConfig | undefined,
): ResolvedProjectKnowledgeConfig {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project knowledge config must be an object");
  }

  const snapshot = snapshotProjectKnowledgeConfig(value);
  const {
    projectDir,
    contentDir,
    storagePath,
    contentExtensions,
    model,
    backend,
    branch,
    topK,
    threshold,
    maxQueryChars,
  } = snapshot;

  if (
    backend !== undefined &&
    (typeof backend !== "string" || !RAG_BACKENDS.has(backend))
  ) {
    throw new TypeError("Project knowledge backend is not supported");
  }
  const normalizedBackend = backend as ProjectKnowledgeConfig["backend"];
  const normalizedTopK = optionalNumber(topK, "Project knowledge topK");
  const normalizedThreshold = optionalNumber(
    threshold,
    "Project knowledge threshold",
  );
  const normalizedMaxQueryChars = optionalNumber(
    maxQueryChars,
    "Project knowledge maxQueryChars",
  );

  return Object.freeze({
    projectDir: optionalCanonicalString(
      projectDir,
      "Project knowledge projectDir",
      MAX_CONFIG_PATH_CODE_UNITS,
    ),
    contentDir: optionalCanonicalString(
      contentDir,
      "Project knowledge contentDir",
      MAX_CONFIG_PATH_CODE_UNITS,
    ),
    storagePath: optionalCanonicalString(
      storagePath,
      "Project knowledge storagePath",
      MAX_CONFIG_PATH_CODE_UNITS,
    ),
    contentExtensions: optionalContentExtensions(contentExtensions),
    model: optionalCanonicalString(
      model,
      "Project knowledge model",
      MAX_CONFIG_STRING_CODE_UNITS,
    ),
    backend: normalizedBackend,
    branch: optionalCanonicalString(
      branch,
      "Project knowledge branch",
      MAX_CONFIG_STRING_CODE_UNITS,
    ),
    topK: normalizedTopK === undefined ? undefined : requirePositiveSafeInteger(
      normalizedTopK,
      "Project knowledge topK",
      MAX_SEARCH_TOP_K,
    ),
    threshold: normalizedThreshold === undefined ? undefined : requireUnitInterval(
      normalizedThreshold,
      "Project knowledge threshold",
    ),
    maxQueryChars: normalizedMaxQueryChars === undefined ? undefined : requirePositiveSafeInteger(
      normalizedMaxQueryChars,
      "Project knowledge maxQueryChars",
      MAX_QUERY_CHARS,
    ),
  });
}

export interface ResolvedSearchKnowledgeToolOptions {
  readonly id: string;
  readonly description?: string;
  readonly config: ResolvedProjectKnowledgeConfig;
}

/** Validate tool metadata and detach its knowledge config from caller mutation. */
export function normalizeSearchKnowledgeToolOptions(
  value: CreateSearchKnowledgeToolOptions | undefined,
): ResolvedSearchKnowledgeToolOptions {
  if (value === undefined) {
    return {
      id: "search_knowledge",
      config: normalizeProjectKnowledgeConfig(undefined),
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("search_knowledge tool options must be an object");
  }

  const snapshot = snapshotProjectKnowledgeConfig(
    value,
    SEARCH_KNOWLEDGE_TOOL_OPTION_KEYS,
    "search_knowledge tool options",
  );
  const id = snapshot.id === undefined ? "search_knowledge" : optionalCanonicalString(
    snapshot.id,
    "search_knowledge tool id",
    MAX_TOOL_ID_CODE_UNITS,
  )!;
  const description = snapshot.description === undefined ? undefined : optionalCanonicalString(
    snapshot.description,
    "search_knowledge tool description",
    MAX_TOOL_DESCRIPTION_CODE_UNITS,
  );
  const config: Record<string, unknown> = {};
  for (const key of PROJECT_KNOWLEDGE_CONFIG_KEYS) {
    if (!Object.hasOwn(snapshot, key)) continue;
    Object.defineProperty(config, key, {
      value: snapshot[key],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return Object.freeze({
    id,
    description,
    config: normalizeProjectKnowledgeConfig(
      config as ProjectKnowledgeConfig,
    ),
  });
}

export interface ResolvedProjectKnowledgeCallOptions {
  readonly topK: number;
  readonly threshold?: number;
  readonly maxQueryChars: number;
  readonly abortSignal?: AbortSignal;
}

/** Validate and snapshot per-call search/retrieve options before store I/O. */
export function normalizeProjectKnowledgeCallOptions(
  value: RagSearchOptions | { maxQueryChars?: number } | undefined,
  config: ResolvedProjectKnowledgeConfig,
  allowMaxQueryChars: boolean,
): ResolvedProjectKnowledgeCallOptions {
  let snapshot: Record<string, unknown> = {};
  if (value !== undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Project knowledge call options must be an object");
    }
    snapshot = snapshotProjectKnowledgeConfig(
      value,
      allowMaxQueryChars
        ? PROJECT_KNOWLEDGE_RETRIEVE_OPTION_KEYS
        : PROJECT_KNOWLEDGE_SEARCH_OPTION_KEYS,
      "Project knowledge call options",
    );
  }

  const requestedTopK = optionalNumber(
    snapshot.topK,
    "Project knowledge topK",
  );
  const requestedThreshold = optionalNumber(
    snapshot.threshold,
    "Project knowledge threshold",
  );
  const requestedMaxQueryChars = optionalNumber(
    snapshot.maxQueryChars,
    "Project knowledge maxQueryChars",
  );
  const abortSignal = snapshot.abortSignal;
  if (
    abortSignal !== undefined &&
    !(abortSignal instanceof AbortSignal)
  ) {
    throw new TypeError(
      "Project knowledge abortSignal must be an AbortSignal",
    );
  }

  return Object.freeze({
    topK: requirePositiveSafeInteger(
      requestedTopK ?? config.topK ?? DEFAULT_TOP_K,
      "Project knowledge topK",
      MAX_SEARCH_TOP_K,
    ),
    threshold: requestedThreshold === undefined ? config.threshold : requireUnitInterval(
      requestedThreshold,
      "Project knowledge threshold",
    ),
    maxQueryChars: requirePositiveSafeInteger(
      requestedMaxQueryChars ??
        config.maxQueryChars ??
        DEFAULT_QUERY_MAX_CHARS,
      "Project knowledge maxQueryChars",
      MAX_QUERY_CHARS,
    ),
    abortSignal: abortSignal as AbortSignal | undefined,
  });
}

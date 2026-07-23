import { isAbsolute, join, normalize, relative } from "#veryfront/compat/path";
import type { VeryfrontConfig } from "#veryfront/config";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import { TRIGGER_CONFIG_INVALID, VeryfrontError } from "#veryfront/errors";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { isValidTriggerId } from "./validation.ts";

const TRIGGER_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"] as const;
const TRIGGER_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
  "*.test.*",
  "*.spec.*",
] as const;
const MAX_TRIGGER_FILES = 10_000;
const MAX_MODULE_EXPORTS = 256;
const MAX_PROJECT_DIR_LENGTH = 4_096;
const MAX_TRIGGER_DIR_LENGTH = 1_024;
const MAX_SOURCE_PATH_LENGTH = 4_096;

/** Source-defined trigger categories supported by discovery. */
export type SourceTriggerKind = "schedule" | "webhook";

/** Stable classification for a source-trigger discovery failure. */
export type SourceTriggerDiscoveryErrorCode =
  | "parse_error"
  | "invalid_definition"
  | "dynamic_definition"
  | "duplicate_source_id"
  | "unsupported_target"
  | "manual_conflict"
  | "discovery_limit_exceeded";

/** Sanitized failure reported while discovering one source-defined trigger. */
export interface SourceTriggerDiscoveryError {
  /** Error discriminator. */
  kind: "source_trigger_discovery_error";
  /** Definition category being discovered. */
  sourceKind: SourceTriggerKind;
  /** Project-relative source path. */
  sourcePath: string;
  /** Canonical definition ID, when one was read safely. */
  sourceId?: string;
  /** Stable machine-readable failure classification. */
  code: SourceTriggerDiscoveryErrorCode;
  /** Sanitized user-actionable failure message. */
  message: string;
  /** Bounded, non-sensitive diagnostic fields. */
  details?: Record<string, unknown>;
}

/** Definitions and contained failures returned by source-trigger discovery. */
export interface SourceTriggerDiscoveryResult<T> {
  /** Valid definitions, ordered by source path. */
  items: T[];
  /** Contained discovery failures. */
  errors: SourceTriggerDiscoveryError[];
}

/** Shared options for discovering source-defined schedules or webhooks. */
export interface TriggerDiscoveryOptions {
  /** Project root used to resolve local source paths. */
  projectDir: string;
  /** Runtime adapter used for filesystem and module operations. */
  adapter: RuntimeAdapter;
  /** Resolved Veryfront project configuration. */
  config?: VeryfrontConfig;
  /** Project-relative definition directory. */
  triggerDir: string;
  /** Definition category to discover. */
  sourceKind: SourceTriggerKind;
  /** Cancels discovery before another file is loaded. */
  signal?: AbortSignal;
}

/** Minimum contract required from a discovered trigger definition. */
export interface TriggerDefinitionWithId {
  /** Canonical source-trigger identifier. */
  id: string;
}

interface DiscoverySnapshot<T extends TriggerDefinitionWithId> {
  projectDir: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig | undefined;
  triggerDir: string;
  sourceKind: SourceTriggerKind;
  signal: AbortSignal | undefined;
  validate: (value: unknown) => value is T;
  normalizeDefinition: ((value: unknown) => T) | undefined;
}

function invalidOptions(detail: string): never {
  throw TRIGGER_CONFIG_INVALID.create({ detail });
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    invalidOptions("Trigger discovery options are required.");
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) {
      invalidOptions(`Trigger discovery options.${key} must be a data property.`);
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidOptions("Trigger discovery options could not be inspected safely.");
  }
}

function hasUnsafePathCharacters(value: string): boolean {
  return hasUnsafeControlCharacters(value) || value.includes("\u061C");
}

function normalizeTriggerDir(value: unknown): string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > MAX_TRIGGER_DIR_LENGTH ||
    hasUnsafePathCharacters(value) || isAbsolute(value)
  ) {
    invalidOptions("Trigger discovery triggerDir must be a bounded project-relative path.");
  }
  const segments = value.split(/[\\/]/);
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === "." || segment === ".." || segment.length > 255
    )
  ) {
    invalidOptions("Trigger discovery triggerDir must not contain empty or relative segments.");
  }
  return normalize(value).replaceAll("\\", "/");
}

function snapshotDiscoveryOptions<T extends TriggerDefinitionWithId>(
  value: TriggerDiscoveryOptions & {
    validate: (candidate: unknown) => candidate is T;
    normalizeDefinition?: (candidate: unknown) => T;
  },
): DiscoverySnapshot<T> {
  const projectDir = readOwnDataProperty(value, "projectDir");
  const adapter = readOwnDataProperty(value, "adapter");
  const config = readOwnDataProperty(value, "config");
  const triggerDir = normalizeTriggerDir(readOwnDataProperty(value, "triggerDir"));
  const sourceKind = readOwnDataProperty(value, "sourceKind");
  const signal = readOwnDataProperty(value, "signal");
  const validate = readOwnDataProperty(value, "validate");
  const normalizeDefinition = readOwnDataProperty(value, "normalizeDefinition");

  if (
    typeof projectDir !== "string" || projectDir.length === 0 ||
    projectDir.length > MAX_PROJECT_DIR_LENGTH || hasUnsafePathCharacters(projectDir)
  ) {
    invalidOptions("Trigger discovery projectDir must be a bounded non-empty path.");
  }
  if (!adapter || typeof adapter !== "object") {
    invalidOptions("Trigger discovery adapter is required.");
  }
  if (config !== undefined && (!config || typeof config !== "object")) {
    invalidOptions("Trigger discovery config must be an object when provided.");
  }
  if (sourceKind !== "schedule" && sourceKind !== "webhook") {
    invalidOptions("Trigger discovery sourceKind must be schedule or webhook.");
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    invalidOptions("Trigger discovery signal must be an AbortSignal.");
  }
  if (typeof validate !== "function") {
    invalidOptions("Trigger discovery validate must be a function.");
  }
  if (normalizeDefinition !== undefined && typeof normalizeDefinition !== "function") {
    invalidOptions("Trigger discovery normalizeDefinition must be a function when provided.");
  }

  return {
    projectDir,
    adapter: adapter as RuntimeAdapter,
    config: config as VeryfrontConfig | undefined,
    triggerDir,
    sourceKind,
    signal,
    validate: validate as (candidate: unknown) => candidate is T,
    normalizeDefinition: normalizeDefinition as ((candidate: unknown) => T) | undefined,
  };
}

function readConfiguredFsType(config: VeryfrontConfig | undefined): unknown {
  if (config === undefined) return undefined;
  const fs = readOwnDataProperty(config, "fs");
  if (fs === undefined) return undefined;
  return readOwnDataProperty(fs, "type");
}

function resolveTriggerBaseDir(
  projectDir: string,
  triggerDir: string,
  config?: VeryfrontConfig,
): string {
  const fsType = readConfiguredFsType(config) ?? "local";
  if (
    fsType !== "local" && fsType !== "memory" && fsType !== "github" &&
    fsType !== "veryfront-api"
  ) {
    invalidOptions("Trigger discovery config.fs.type is not supported.");
  }
  return fsType === "github" || fsType === "veryfront-api"
    ? triggerDir
    : join(projectDir, triggerDir);
}

function createError(input: {
  sourceKind: SourceTriggerKind;
  sourcePath: string;
  sourceId?: string;
  code: SourceTriggerDiscoveryErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): SourceTriggerDiscoveryError {
  const details = input.details === undefined ? undefined : Object.freeze({ ...input.details });
  return Object.freeze({
    kind: "source_trigger_discovery_error" as const,
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    code: input.code,
    message: input.message,
    ...(details === undefined ? {} : { details }),
  });
}

function sourcePathFor(filePath: string, baseDir: string, triggerDir: string): string {
  const childPath = relative(baseDir, filePath).replaceAll("\\", "/");
  if (
    childPath === "" || childPath === ".." || childPath.startsWith("../") ||
    isAbsolute(childPath) || hasUnsafePathCharacters(childPath) ||
    childPath.length > MAX_SOURCE_PATH_LENGTH - triggerDir.length - 1
  ) {
    throw new TypeError("Trigger discovery received an unsafe source path.");
  }
  return `${triggerDir}/${childPath}`;
}

function isTriggerDefinitionFile(filePath: string): boolean {
  return !/\.d\.(?:ts|tsx)$/i.test(filePath);
}

async function collectTriggerFiles(
  baseDir: string,
  adapter: RuntimeAdapter,
  signal: AbortSignal | undefined,
): Promise<{ files: Array<{ path: string }>; limitExceeded: boolean }> {
  const files: Array<{ path: string }> = [];
  let limitExceeded = false;
  for await (
    const file of discoverFiles({
      baseDir,
      extensions: TRIGGER_FILE_EXTENSIONS,
      recursive: true,
      ignorePatterns: TRIGGER_IGNORE_PATTERNS,
      adapter,
    })
  ) {
    signal?.throwIfAborted();
    if (!isTriggerDefinitionFile(file.path)) continue;
    if (files.length >= MAX_TRIGGER_FILES) {
      limitExceeded = true;
      break;
    }
    files.push({ path: file.path });
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return { files, limitExceeded };
}

function sourceKindLabel(sourceKind: SourceTriggerKind): string {
  return sourceKind === "schedule" ? "Schedule" : "Webhook";
}

function readModuleExport(module: Record<string, unknown>, key: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(module, key);
    return descriptor && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeCandidate<T>(
  value: unknown,
  validate: (candidate: unknown) => candidate is T,
  normalizeDefinition: ((candidate: unknown) => T) | undefined,
): T | undefined {
  try {
    const candidate = normalizeDefinition?.(value) ?? value;
    return validate(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function extractTriggerExports<T>(
  module: Record<string, unknown>,
  validate: (value: unknown) => value is T,
  normalizeDefinition: ((value: unknown) => T) | undefined,
): Array<{ exportName: string; definition: T }> | null {
  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(module);
  } catch {
    return null;
  }
  if (keys.length > MAX_MODULE_EXPORTS) return null;
  for (const key of keys) {
    if (typeof key === "string") continue;
    try {
      if (Object.getOwnPropertyDescriptor(module, key)?.enumerable) return null;
    } catch {
      return null;
    }
  }
  const exportNames = keys.filter((key): key is string => typeof key === "string").sort();
  const orderedNames = exportNames.includes("default")
    ? ["default", ...exportNames.filter((name) => name !== "default")]
    : exportNames;
  const exports: Array<{ exportName: string; definition: T }> = [];
  const seenValues = new Set<unknown>();

  for (const key of orderedNames) {
    const value = readModuleExport(module, key);
    if (seenValues.has(value)) continue;
    const definition = normalizeCandidate(
      value,
      validate,
      normalizeDefinition,
    );
    if (definition === undefined) continue;
    seenValues.add(value);
    exports.push({ exportName: key, definition });
  }
  return exports;
}

function readDefinitionId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "id");
    return descriptor && "value" in descriptor && isValidTriggerId(descriptor.value)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Discover validated source-trigger definitions from one project directory.
 *
 * Invalid files are returned as sanitized errors. Invalid call options and
 * cancellation reject the operation.
 */
export async function discoverSourceTriggers<T extends TriggerDefinitionWithId>(
  input: TriggerDiscoveryOptions & {
    validate: (value: unknown) => value is T;
    normalizeDefinition?: (value: unknown) => T;
  },
): Promise<SourceTriggerDiscoveryResult<T>> {
  const options = snapshotDiscoveryOptions(input);
  const {
    projectDir,
    adapter,
    config,
    triggerDir,
    sourceKind,
    signal,
    validate,
    normalizeDefinition,
  } = options;
  const baseDir = resolveTriggerBaseDir(projectDir, triggerDir, config);
  const items: T[] = [];
  const errors: SourceTriggerDiscoveryError[] = [];
  const seenIds = new Map<string, string>();

  try {
    signal?.throwIfAborted();
    const dirExists = await adapter.fs.exists.call(adapter.fs, baseDir);
    signal?.throwIfAborted();
    if (!dirExists) return { items, errors };

    const discovery = await collectTriggerFiles(baseDir, adapter, signal);
    if (discovery.limitExceeded) {
      errors.push(createError({
        sourceKind,
        sourcePath: triggerDir,
        code: "discovery_limit_exceeded",
        message: `${
          sourceKindLabel(sourceKind)
        } discovery supports at most ${MAX_TRIGGER_FILES} files.`,
      }));
    }

    for (const file of discovery.files) {
      let sourcePath = triggerDir;
      try {
        sourcePath = sourcePathFor(file.path, baseDir, triggerDir);
        signal?.throwIfAborted();
        const module = await importDiscoveryModule(file.path, { adapter, projectDir }) as Record<
          string,
          unknown
        >;
        signal?.throwIfAborted();
        const triggerExports = extractTriggerExports(module, validate, normalizeDefinition);

        if (!triggerExports || triggerExports.length === 0) {
          errors.push(createError({
            sourceKind,
            sourcePath,
            code: "invalid_definition",
            message: `File must export a valid ${sourceKind} definition.`,
          }));
          continue;
        }

        for (const triggerExport of triggerExports) {
          const sourceId = readDefinitionId(triggerExport.definition);
          if (!sourceId) {
            errors.push(createError({
              sourceKind,
              sourcePath,
              code: "invalid_definition",
              message: `File must export a valid ${sourceKind} definition.`,
            }));
            continue;
          }

          const existingPath = seenIds.get(sourceId);
          if (existingPath) {
            errors.push(createError({
              sourceKind,
              sourcePath,
              sourceId,
              code: "duplicate_source_id",
              message: `Duplicate ${sourceKind} id "${sourceId}".`,
              details: { firstSourcePath: existingPath },
            }));
            continue;
          }

          seenIds.set(sourceId, sourcePath);
          items.push(triggerExport.definition);
        }
      } catch {
        if (signal?.aborted) signal.throwIfAborted();
        errors.push(createError({
          sourceKind,
          sourcePath,
          code: "parse_error",
          message: `Unable to load ${sourceKind} definition.`,
        }));
      }
    }

    return { items, errors };
  } catch {
    if (signal?.aborted) signal.throwIfAborted();
    errors.push(createError({
      sourceKind,
      sourcePath: triggerDir,
      code: "parse_error",
      message: `Unable to discover ${sourceKind} definitions.`,
    }));
    return { items, errors };
  }
}

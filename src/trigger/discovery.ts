import { join } from "#veryfront/compat/path";
import type { VeryfrontConfig } from "#veryfront/config";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import { TRIGGER_CONFIG_INVALID, VeryfrontError } from "#veryfront/errors";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/index.ts";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";

const MAX_PROJECT_DISCOVERY_DIRECTORIES = 100;

const TRIGGER_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const TRIGGER_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
  "*.test.*",
  "*.spec.*",
] as const;

/** Source definition families handled by shared trigger discovery. */
export type SourceTriggerKind = "schedule" | "webhook";

/** Stable failure categories emitted while discovering source triggers. */
export type SourceTriggerDiscoveryErrorCode =
  | "parse_error"
  | "invalid_definition"
  | "dynamic_definition"
  | "duplicate_source_id"
  | "unsupported_target"
  | "manual_conflict";

/** Structured failure produced while discovering one source definition. */
export interface SourceTriggerDiscoveryError {
  /** Stable discriminator for structured source discovery failures. */
  kind: "source_trigger_discovery_error";
  /** Definition kind being discovered. */
  sourceKind: SourceTriggerKind;
  /** Source path that produced the failure. */
  sourcePath: string;
  /** Definition id when it could be safely determined. */
  sourceId?: string;
  /** Machine-readable discovery failure category. */
  code: SourceTriggerDiscoveryErrorCode;
  /** Human-readable, safe error description. */
  message: string;
  /** Structured diagnostic context such as every ambiguous source path. */
  details?: Record<string, unknown>;
}

/** Deterministic source trigger discovery result. */
export interface SourceTriggerDiscoveryResult<T> {
  /** Unique, normalized definitions in deterministic id order. */
  items: T[];
  /** Deterministically ordered source failures. */
  errors: SourceTriggerDiscoveryError[];
}

interface TriggerDiscoveryBaseOptions {
  /** Project root used to resolve local source paths and module imports. */
  projectDir: string;
  /** Runtime-specific filesystem and module execution adapter. */
  adapter: RuntimeAdapter;
  /** Optional project configuration, including virtual filesystem mode. */
  config?: VeryfrontConfig;
  /** Source definition kind used in diagnostics. */
  sourceKind: SourceTriggerKind;
  /** Explicit host-owned capability for a trusted local or dedicated runtime. */
  allowHostProjectCodeExecution?: boolean;
}

/** Shared filesystem, directory, and source-kind options for trigger discovery. */
export type TriggerDiscoveryOptions =
  & TriggerDiscoveryBaseOptions
  & (
    | {
      /** One source directory relative to the project or virtual filesystem root. */
      triggerDir: string;
      triggerDirs?: never;
    }
    | {
      triggerDir?: never;
      /** Multiple source directories searched as one deterministic namespace. */
      triggerDirs: readonly string[];
    }
  );

/** Minimum contract required for source trigger de-duplication. */
export interface TriggerDefinitionWithId {
  /** Canonical source trigger identifier. */
  id: string;
}

/** Validation and normalization contract for source trigger discovery. */
export type SourceTriggerDiscoveryOptions<T extends TriggerDefinitionWithId> =
  & TriggerDiscoveryOptions
  & {
    /** Reject module exports that are not definitions of the expected kind. */
    validate: (value: unknown) => value is T;
    /** Copy and normalize a validated definition before returning it. */
    normalize?: (value: T) => T;
  };

function invalidDiscoveryConfiguration(detail: string, cause?: unknown): never {
  throw TRIGGER_CONFIG_INVALID.create({
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function normalizeTriggerDirectory(value: unknown): string {
  try {
    if (
      typeof value !== "string" || value.length === 0 ||
      value.length > MAX_PATH_LENGTH_CHARS || containsControlCharacter(value) ||
      /^file:\/\//i.test(value)
    ) {
      throw new TypeError("invalid source directory");
    }
    const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "");
    if (
      normalized.length === 0 || normalized.startsWith("/") ||
      /^[A-Za-z]:/.test(normalized) ||
      normalized.split("/").some((segment) =>
        segment.length === 0 || segment === "." || segment === ".."
      )
    ) {
      throw new TypeError("source directory escapes the project");
    }
    return normalized;
  } catch (error) {
    invalidDiscoveryConfiguration("Trigger source directory is invalid.", error);
  }
}

function normalizeTriggerDirectoriesUnsafe(
  triggerDir: unknown,
  triggerDirs: unknown,
): string[] {
  if (triggerDir !== undefined && triggerDirs !== undefined) {
    invalidDiscoveryConfiguration(
      "Trigger discovery accepts either triggerDir or triggerDirs, not both.",
    );
  }
  if (triggerDir !== undefined) {
    return [normalizeTriggerDirectory(triggerDir)];
  }
  if (!Array.isArray(triggerDirs)) {
    invalidDiscoveryConfiguration(
      "Trigger discovery requires a source directory or directory collection.",
    );
  }
  if (Reflect.getPrototypeOf(triggerDirs) !== Array.prototype) {
    invalidDiscoveryConfiguration(
      "Trigger source directories must be a plain array.",
    );
  }

  const lengthDescriptor = Reflect.getOwnPropertyDescriptor(
    triggerDirs,
    "length",
  );
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_PROJECT_DISCOVERY_DIRECTORIES
  ) {
    invalidDiscoveryConfiguration(
      `Trigger discovery accepts at most ${MAX_PROJECT_DISCOVERY_DIRECTORIES} source directories.`,
    );
  }

  const allowedKeys = new Set<PropertyKey>(["length"]);
  for (let index = 0; index < length; index++) {
    allowedKeys.add(String(index));
  }
  if (Reflect.ownKeys(triggerDirs).some((key) => !allowedKeys.has(key))) {
    invalidDiscoveryConfiguration(
      "Trigger source directories must not define custom properties.",
    );
  }

  const normalizedDirectories: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index++) {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      triggerDirs,
      String(index),
    );
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    ) {
      invalidDiscoveryConfiguration(
        `Trigger source directories[${index}] must be an enumerable data property.`,
      );
    }
    const normalized = normalizeTriggerDirectory(descriptor.value);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      normalizedDirectories.push(normalized);
    }
  }
  return normalizedDirectories;
}

function normalizeTriggerDirectories(
  triggerDir: unknown,
  triggerDirs: unknown,
): string[] {
  try {
    return normalizeTriggerDirectoriesUnsafe(triggerDir, triggerDirs);
  } catch (error) {
    if (
      error instanceof VeryfrontError &&
      error.slug === TRIGGER_CONFIG_INVALID.slug
    ) {
      throw error;
    }
    invalidDiscoveryConfiguration(
      "Trigger source directories are invalid.",
      error,
    );
  }
}

function validateDiscoveryProjectDir(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    containsControlCharacter(value)
  ) {
    invalidDiscoveryConfiguration(
      `Trigger project directory must be a non-empty path of at most ${MAX_PATH_LENGTH_CHARS} characters without control characters.`,
    );
  }
}

function resolveTriggerBaseDir(
  projectDir: string,
  triggerDir: string,
  config?: VeryfrontConfig,
): string {
  const fsType = config?.fs?.type ?? "local";
  return fsType === "github" || fsType === "veryfront-api"
    ? triggerDir
    : join(projectDir, triggerDir);
}

function toErrorMessage(error: unknown): string {
  return snapshotThrowableDiagnostic(error);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createError(input: {
  sourceKind: SourceTriggerKind;
  sourcePath: string;
  sourceId?: string;
  code: SourceTriggerDiscoveryErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): SourceTriggerDiscoveryError {
  return {
    kind: "source_trigger_discovery_error",
    sourceKind: input.sourceKind,
    sourcePath: input.sourcePath,
    ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    code: input.code,
    message: input.message,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

async function collectTriggerFiles(baseDir: string, adapter: RuntimeAdapter) {
  const files = await collectFiles({
    baseDir,
    extensions: [...TRIGGER_FILE_EXTENSIONS],
    recursive: true,
    ignorePatterns: [...TRIGGER_IGNORE_PATTERNS],
    adapter,
  });
  return files.sort((left, right) =>
    compareText(left.path.replaceAll("\\", "/"), right.path.replaceAll("\\", "/"))
  );
}

type TriggerExportSelection<T> =
  | { kind: "missing" }
  | { kind: "selected"; exportName: string; definition: T }
  | { kind: "ambiguous"; exportNames: string[] };

function selectTriggerExport<T>(
  module: Record<string, unknown>,
  validate: (value: unknown) => value is T,
): TriggerExportSelection<T> {
  const candidates: Array<{ exportNames: string[]; definition: T }> = [];

  function addCandidate(exportName: string, value: unknown): void {
    if (!validate(value)) return;
    const alias = candidates.find((candidate) => Object.is(candidate.definition, value));
    if (alias) {
      alias.exportNames.push(exportName);
      return;
    }
    candidates.push({ exportNames: [exportName], definition: value });
  }

  addCandidate("default", module.default);
  for (
    const [exportName, value] of Object.entries(module).sort(([left], [right]) =>
      compareText(left, right)
    )
  ) {
    if (exportName !== "default") addCandidate(exportName, value);
  }

  if (candidates.length === 0) return { kind: "missing" };
  if (candidates.length > 1) {
    return {
      kind: "ambiguous",
      exportNames: candidates.flatMap((candidate) => candidate.exportNames).sort(compareText),
    };
  }

  const candidate = candidates[0]!;
  return {
    kind: "selected",
    exportName: candidate.exportNames.includes("default") ? "default" : candidate.exportNames[0]!,
    definition: candidate.definition,
  };
}

/**
 * Discover, validate, normalize, and deterministically de-duplicate source
 * trigger definitions.
 */
export async function discoverSourceTriggers<T extends TriggerDefinitionWithId>(
  options: SourceTriggerDiscoveryOptions<T>,
): Promise<SourceTriggerDiscoveryResult<T>> {
  const {
    projectDir,
    adapter,
    config,
    triggerDir,
    triggerDirs,
    sourceKind,
    validate,
    normalize = (value: T): T => value,
    allowHostProjectCodeExecution,
  } = options;
  validateDiscoveryProjectDir(projectDir);
  if (sourceKind !== "schedule" && sourceKind !== "webhook") {
    invalidDiscoveryConfiguration("Trigger source kind must be schedule or webhook.");
  }
  if (typeof validate !== "function" || typeof normalize !== "function") {
    invalidDiscoveryConfiguration(
      "Trigger discovery requires callable validation and normalization contracts.",
    );
  }
  const baseDirs = normalizeTriggerDirectories(triggerDir, triggerDirs).map(
    (directory) => resolveTriggerBaseDir(projectDir, directory, config),
  );
  const candidates: Array<{ definition: T; sourcePath: string }> = [];
  const errors: SourceTriggerDiscoveryError[] = [];
  const seenSourcePaths = new Set<string>();

  for (const baseDir of baseDirs) {
    try {
      const dirExists = await adapter.fs.exists(baseDir);
      if (!dirExists) continue;

      const files = await collectTriggerFiles(baseDir, adapter);
      for (const file of files) {
        const sourcePathKey = file.path.replaceAll("\\", "/");
        if (seenSourcePaths.has(sourcePathKey)) continue;
        seenSourcePaths.add(sourcePathKey);
        try {
          const module = await importDiscoveryModule(file.path, {
            adapter,
            projectDir,
            allowHostProjectCodeExecution,
          }) as Record<string, unknown>;
          const triggerExport = selectTriggerExport(module, validate);

          if (triggerExport.kind === "missing") {
            errors.push(createError({
              sourceKind,
              sourcePath: file.path,
              code: "invalid_definition",
              message: `File must export a valid ${sourceKind} definition.`,
            }));
            continue;
          }
          if (triggerExport.kind === "ambiguous") {
            errors.push(createError({
              sourceKind,
              sourcePath: file.path,
              code: "invalid_definition",
              message: `File exports multiple distinct ${sourceKind} definitions: ${
                triggerExport.exportNames.join(", ")
              }. Export exactly one definition.`,
              details: { exportNames: [...triggerExport.exportNames] },
            }));
            continue;
          }

          let definition: T;
          try {
            definition = normalize(triggerExport.definition);
          } catch (error) {
            errors.push(createError({
              sourceKind,
              sourcePath: file.path,
              sourceId: triggerExport.definition.id,
              code: "invalid_definition",
              message: toErrorMessage(error),
            }));
            continue;
          }

          candidates.push({ definition, sourcePath: file.path });
        } catch (error) {
          errors.push(createError({
            sourceKind,
            sourcePath: file.path,
            code: "parse_error",
            message: toErrorMessage(error),
          }));
        }
      }
    } catch (error) {
      errors.push(createError({
        sourceKind,
        sourcePath: baseDir,
        code: "parse_error",
        message: toErrorMessage(error),
      }));
    }
  }
  return finalizeDiscoveryResult(candidates, errors, sourceKind);
}

function finalizeDiscoveryResult<T extends TriggerDefinitionWithId>(
  candidates: Array<{ definition: T; sourcePath: string }>,
  errors: SourceTriggerDiscoveryError[],
  sourceKind: SourceTriggerKind,
): SourceTriggerDiscoveryResult<T> {
  const candidatesById = new Map<string, Array<{ definition: T; sourcePath: string }>>();
  for (const candidate of candidates) {
    const matches = candidatesById.get(candidate.definition.id) ?? [];
    matches.push(candidate);
    candidatesById.set(candidate.definition.id, matches);
  }

  const items: T[] = [];
  for (const [sourceId, matches] of candidatesById) {
    if (matches.length === 1) {
      items.push(matches[0]!.definition);
      continue;
    }

    const sourcePaths = matches.map((match) => match.sourcePath).sort(compareText);
    for (const sourcePath of sourcePaths) {
      errors.push(createError({
        sourceKind,
        sourcePath,
        sourceId,
        code: "duplicate_source_id",
        message: `Duplicate ${sourceKind} id "${sourceId}" was declared by: ${
          sourcePaths.join(", ")
        }.`,
        details: { sourcePaths: [...sourcePaths] },
      }));
    }
  }

  items.sort((left, right) => compareText(left.id, right.id));
  errors.sort((left, right) =>
    compareText(left.sourcePath, right.sourcePath) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  );
  return { items, errors };
}

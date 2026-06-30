import { join } from "@std/path";
import type { VeryfrontConfig } from "#veryfront/config";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";

const TRIGGER_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const TRIGGER_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
  "*.test.*",
  "*.spec.*",
] as const;

export type SourceTriggerKind = "schedule" | "webhook";

export type SourceTriggerDiscoveryErrorCode =
  | "parse_error"
  | "invalid_definition"
  | "dynamic_definition"
  | "duplicate_source_id"
  | "unsupported_target"
  | "manual_conflict";

export interface SourceTriggerDiscoveryError {
  kind: "source_trigger_discovery_error";
  sourceKind: SourceTriggerKind;
  sourcePath: string;
  sourceId?: string;
  code: SourceTriggerDiscoveryErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface SourceTriggerDiscoveryResult<T> {
  items: T[];
  errors: SourceTriggerDiscoveryError[];
}

export interface TriggerDiscoveryOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  triggerDir: string;
  sourceKind: SourceTriggerKind;
}

export interface TriggerDefinitionWithId {
  id: string;
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
  return error instanceof Error ? error.message : String(error);
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
  return await collectFiles({
    baseDir,
    extensions: [...TRIGGER_FILE_EXTENSIONS],
    recursive: true,
    ignorePatterns: [...TRIGGER_IGNORE_PATTERNS],
    adapter,
  });
}

function extractTriggerExport<T>(
  module: Record<string, unknown>,
  validate: (value: unknown) => value is T,
): { exportName: string; definition: T } | null {
  if (validate(module.default)) {
    return { exportName: "default", definition: module.default };
  }

  for (const [exportName, value] of Object.entries(module)) {
    if (exportName === "default") continue;
    if (validate(value)) return { exportName, definition: value };
  }

  return null;
}

export async function discoverSourceTriggers<T extends TriggerDefinitionWithId>(
  options: TriggerDiscoveryOptions & {
    validate: (value: unknown) => value is T;
  },
): Promise<SourceTriggerDiscoveryResult<T>> {
  const { projectDir, adapter, config, triggerDir, sourceKind, validate } = options;
  const baseDir = resolveTriggerBaseDir(projectDir, triggerDir, config);
  const items: T[] = [];
  const errors: SourceTriggerDiscoveryError[] = [];
  const seenIds = new Map<string, string>();

  try {
    const dirExists = await adapter.fs.exists(baseDir);
    if (!dirExists) return { items, errors };

    const files = await collectTriggerFiles(baseDir, adapter);
    for (const file of files) {
      try {
        const module = await importDiscoveryModule(file.path, {
          adapter,
          projectDir,
        }) as Record<string, unknown>;
        const triggerExport = extractTriggerExport(module, validate);

        if (!triggerExport) {
          errors.push(createError({
            sourceKind,
            sourcePath: file.path,
            code: "invalid_definition",
            message: `File must export a valid ${sourceKind} definition.`,
          }));
          continue;
        }

        const existingPath = seenIds.get(triggerExport.definition.id);
        if (existingPath) {
          errors.push(createError({
            sourceKind,
            sourcePath: file.path,
            sourceId: triggerExport.definition.id,
            code: "duplicate_source_id",
            message: `Duplicate ${sourceKind} id "${triggerExport.definition.id}".`,
            details: { firstSourcePath: existingPath },
          }));
          continue;
        }

        seenIds.set(triggerExport.definition.id, file.path);
        items.push(triggerExport.definition);
      } catch (error) {
        errors.push(createError({
          sourceKind,
          sourcePath: file.path,
          code: "parse_error",
          message: toErrorMessage(error),
        }));
      }
    }

    return { items, errors };
  } catch (error) {
    errors.push(createError({
      sourceKind,
      sourcePath: baseDir,
      code: "parse_error",
      message: toErrorMessage(error),
    }));
    return { items, errors };
  }
}

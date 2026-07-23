/**
 * Eval discovery for project-local eval definitions.
 */

import { join } from "@std/path";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import { isEvalDefinition } from "./factory.ts";
import type { EvalDefinition } from "./types.ts";
import { formatEvalPublicError } from "./validation.ts";

const EVAL_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;
const EVAL_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
  "*.test.*",
  "*.spec.*",
] as const;

/** Eval definition discovered from project source. */
export interface DiscoveredEval {
  id: string;
  name: string;
  filePath: string;
  exportName: string;
  definition: EvalDefinition;
}

/** Loader used to import an eval source module during discovery. */
export type EvalModuleLoader = (
  filePath: string,
  options: { adapter: RuntimeAdapter; projectDir: string },
) => Promise<Record<string, unknown>>;

/** Options for project-local eval discovery. */
export interface EvalDiscoveryOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  evalsDir?: string;
  /** @internal Override source loading for tests and custom runtimes. */
  moduleLoader?: EvalModuleLoader;
}

/** Result returned by eval discovery. */
export interface EvalDiscoveryResult {
  evals: DiscoveredEval[];
  errors: Array<{ filePath: string; error: string }>;
}

function resolveEvalsBaseDir(
  projectDir: string,
  evalsDir: string,
  config?: VeryfrontConfig,
): string {
  const fsType = config?.fs?.type ?? "local";
  return fsType === "github" || fsType === "veryfront-api" ? evalsDir : join(projectDir, evalsDir);
}

function toErrorMessage(error: unknown): string {
  return formatEvalPublicError(error);
}

function stripEvalExtension(relativePath: string): string {
  return relativePath
    .replace(/\.(ts|tsx|js|jsx)$/, "")
    .replace(/\.eval$/, "");
}

function stripFileProtocol(path: string): string {
  if (!path.startsWith("file://")) return path;
  return decodeURIComponent(new URL(path).pathname);
}

/** Derive the stable `eval:<path>` ID for an eval file. */
export function deriveEvalId(filePath: string, evalsDir: string): string {
  let relative = stripFileProtocol(filePath);
  const normalizedDir = stripFileProtocol(evalsDir);
  const dirPrefix = normalizedDir.endsWith("/") ? normalizedDir : `${normalizedDir}/`;
  if (relative.startsWith(dirPrefix)) {
    relative = relative.slice(dirPrefix.length);
  }
  return `eval:${stripEvalExtension(relative)}`;
}

function extractEvalExport(
  module: Record<string, unknown>,
): { exportName: string; definition: EvalDefinition } | null {
  const defaultExport = module.default;
  if (isEvalDefinition(defaultExport)) {
    return { exportName: "default", definition: defaultExport };
  }

  for (const [exportName, value] of Object.entries(module)) {
    if (exportName === "default") continue;
    if (!isEvalDefinition(value)) continue;
    return { exportName, definition: value };
  }

  return null;
}

async function collectEvalFiles(
  baseDir: string,
  adapter: RuntimeAdapter,
): Promise<Awaited<ReturnType<typeof collectFiles>>> {
  return await collectFiles({
    baseDir,
    extensions: [...EVAL_FILE_EXTENSIONS],
    recursive: true,
    ignorePatterns: [...EVAL_IGNORE_PATTERNS],
    adapter,
  });
}

async function loadEvalFromFile(
  filePath: string,
  fallbackId: string,
  adapter: RuntimeAdapter,
  projectDir: string,
  moduleLoader: EvalModuleLoader,
): Promise<DiscoveredEval | null> {
  const module = await moduleLoader(filePath, {
    adapter,
    projectDir,
  });
  const evalExport = extractEvalExport(module);
  if (!evalExport) return null;

  const id = evalExport.definition.id || fallbackId;
  const definition = {
    ...evalExport.definition,
    id,
    name: evalExport.definition.name || id,
    source: {
      filePath,
      exportName: evalExport.exportName,
    },
  };

  return {
    id,
    name: definition.name,
    filePath,
    exportName: evalExport.exportName,
    definition,
  };
}

/** Discover eval definitions from a project eval directory. */
export async function discoverEvals(
  options: EvalDiscoveryOptions,
): Promise<EvalDiscoveryResult> {
  const {
    projectDir,
    adapter,
    config,
    evalsDir = "evals",
    moduleLoader = importDiscoveryModule,
  } = options;

  const evals: DiscoveredEval[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];
  const evalIds = new Set<string>();
  const baseDir = resolveEvalsBaseDir(projectDir, evalsDir, config);

  try {
    if (!await adapter.fs.exists(baseDir)) {
      return { evals, errors };
    }

    const files = await collectEvalFiles(baseDir, adapter);
    for (const file of files) {
      try {
        const evalItem = await loadEvalFromFile(
          file.path,
          deriveEvalId(file.path, baseDir),
          adapter,
          projectDir,
          moduleLoader,
        );
        if (evalItem) {
          if (evalIds.has(evalItem.id)) {
            errors.push({
              filePath: file.path,
              error: `Duplicate eval id "${evalItem.id}"`,
            });
          } else {
            evalIds.add(evalItem.id);
            evals.push(evalItem);
          }
        }
      } catch (error) {
        errors.push({ filePath: file.path, error: toErrorMessage(error) });
      }
    }
  } catch (error) {
    errors.push({ filePath: baseDir, error: toErrorMessage(error) });
  }

  return { evals, errors };
}

/** Discover and return one eval definition by ID. */
export async function findEvalById(
  evalId: string,
  options: EvalDiscoveryOptions,
): Promise<DiscoveredEval | null> {
  const result = await discoverEvals(options);
  return result.evals.find((item) => item.id === evalId) ?? null;
}

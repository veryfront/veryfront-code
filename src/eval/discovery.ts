/**
 * Eval discovery for project-local eval definitions.
 */

import { join } from "#veryfront/compat/path";
import type { VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform";
import { importDiscoveryModule } from "#veryfront/discovery/module-import.ts";
import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import { isEvalDefinition } from "./factory.ts";
import type { EvalDefinition } from "./types.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { sanitizeBoundedDiagnosticText } from "#veryfront/errors/diagnostic-policy.ts";
import { redactPathFromText } from "#veryfront/utils/logger/redact.ts";
import { EVAL_LOAD_FAILED, EVAL_NOT_FOUND } from "#veryfront/errors/error-registry/agent.ts";

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
  options: {
    adapter: RuntimeAdapter;
    projectDir: string;
    allowHostProjectCodeExecution?: boolean;
  },
) => Promise<Record<string, unknown>>;

/** Options for project-local eval discovery. */
export interface EvalDiscoveryOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  evalsDir?: string;
  /** Explicit host-owned capability for a trusted local or dedicated runtime. */
  allowHostProjectCodeExecution?: boolean;
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
  return error instanceof Error ? error.message : String(error);
}

function stripEvalExtension(relativePath: string): string {
  return relativePath
    .replace(/\.(ts|tsx|js|jsx)$/, "")
    .replace(/\.eval$/, "");
}

function stripFileProtocol(path: string): string {
  const stripped = path.startsWith("file://") ? decodeURIComponent(new URL(path).pathname) : path;
  return stripped.replaceAll("\\", "/").replace(/^\/([A-Za-z]:\/)/, "$1");
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
  allowHostProjectCodeExecution?: boolean,
): Promise<DiscoveredEval | null> {
  const module = await moduleLoader(filePath, {
    adapter,
    projectDir,
    allowHostProjectCodeExecution,
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
    allowHostProjectCodeExecution,
  } = options;

  const evals: DiscoveredEval[] = [];
  const errors: Array<{ filePath: string; error: string }> = [];
  const baseDir = resolveEvalsBaseDir(projectDir, evalsDir, config);

  try {
    if (!await adapter.fs.exists(baseDir)) {
      return { evals, errors };
    }

    const files = await collectEvalFiles(baseDir, adapter);
    for (const file of [...files].sort((left, right) => compareStrings(left.path, right.path))) {
      try {
        const evalItem = await loadEvalFromFile(
          file.path,
          deriveEvalId(file.path, baseDir),
          adapter,
          projectDir,
          moduleLoader,
          allowHostProjectCodeExecution,
        );
        if (evalItem) evals.push(evalItem);
      } catch (error) {
        errors.push({ filePath: file.path, error: toErrorMessage(error) });
      }
    }
  } catch (error) {
    errors.push({ filePath: baseDir, error: toErrorMessage(error) });
  }

  const evalsById = new Map<string, DiscoveredEval[]>();
  for (const evalItem of evals) {
    const matches = evalsById.get(evalItem.id) ?? [];
    matches.push(evalItem);
    evalsById.set(evalItem.id, matches);
  }

  const uniqueEvals: DiscoveredEval[] = [];
  for (const [id, matches] of evalsById) {
    if (matches.length === 1) {
      uniqueEvals.push(matches[0]!);
      continue;
    }
    const paths = matches.map((item) => item.filePath).sort(compareStrings);
    for (const filePath of paths) {
      errors.push({
        filePath,
        error: `Duplicate eval id "${id}" was declared by: ${paths.join(", ")}`,
      });
    }
  }

  uniqueEvals.sort((left, right) =>
    compareStrings(left.id, right.id) || compareStrings(left.filePath, right.filePath)
  );
  errors.sort((left, right) =>
    compareStrings(left.filePath, right.filePath) || compareStrings(left.error, right.error)
  );
  return { evals: uniqueEvals, errors };
}

/** Discover and return one eval definition by ID. */
export async function findEvalById(
  evalId: string,
  options: EvalDiscoveryOptions,
): Promise<DiscoveredEval | null> {
  const result = await discoverEvals(options);
  return result.evals.find((item) => item.id === evalId) ?? null;
}

/** Remove trailing `/` characters without a backtracking regular expression. */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

function projectRoot(projectDir: string): string {
  return stripTrailingSlashes(stripFileProtocol(projectDir));
}

function toProjectRelativePath(path: string, projectDir: string): string {
  const normalized = stripFileProtocol(path);
  const root = projectRoot(projectDir);
  if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
  return normalized.replace(/^\/+/, "");
}

const MACHINE_PATH_PATTERN =
  /file:\/\/[^\s'"`()<>]+|\b[A-Za-z]:[\\/][^\s'"`()<>]*|(?<![\w.:/\\-])\/[^\s'"`()<>]+/g;

/**
 * Make error text safe to return: the project root becomes project-relative, in
 * any separator, case or `file:` URL form, and any other absolute path or file
 * URL (for example a transpiler temp module) is redacted.
 */
function withoutMachinePaths(text: string, projectDir: string): string {
  const root = projectRoot(projectDir);
  const relative = root && root !== "." ? redactPathFromText(text, `${root}/`, "") : text;
  return relative.replace(MACHINE_PATH_PATTERN, "<absolute-path>");
}

/** Read the first entry of the evals directory, so a listing failure is not silent. */
async function readEvalsDirError(
  baseDir: string,
  adapter: RuntimeAdapter,
): Promise<string | undefined> {
  try {
    if (!await adapter.fs.exists(baseDir)) return undefined;
    const listing = adapter.fs.readDir(baseDir)[Symbol.asyncIterator]();
    try {
      await listing.next();
    } finally {
      await listing.return?.();
    }
    return undefined;
  } catch (error) {
    return toErrorMessage(error);
  }
}

/**
 * Discover and return one eval definition by ID, or throw an error that says why not.
 *
 * Discovery skips an eval file that fails to load, so `findEvalById` alone cannot
 * tell a missing file from a broken one. This throws `eval-load-failed` when the
 * ID points at a file that exists but does not load, or that more than one file
 * declares, and `eval-not-found` otherwise. Messages use project-relative paths.
 */
export async function resolveEvalById(
  evalId: string,
  options: EvalDiscoveryOptions,
): Promise<DiscoveredEval> {
  const evalsDir = options.evalsDir ?? "evals";
  const baseDir = resolveEvalsBaseDir(options.projectDir, evalsDir, options.config);
  const { evals, errors } = await discoverEvals(options);
  const found = evals.find((item) => item.id === evalId);
  if (found) return found;

  const duplicates = errors
    .filter((entry) => entry.error.startsWith(`Duplicate eval id "${evalId}" `))
    .map((entry) => toProjectRelativePath(entry.filePath, options.projectDir));
  if (duplicates.length > 0) {
    throw EVAL_LOAD_FAILED.create({
      detail: `Eval ${evalId} is declared by more than one file: ${
        duplicates.join(", ")
      }. Give each eval a unique id, then run the eval again.`,
      context: { evalId, filePaths: duplicates },
    });
  }

  // collectFiles skips a directory it cannot list, so check the evals directory itself.
  const directoryError = errors.find((entry) => entry.filePath === baseDir)?.error ??
    await readEvalsDirError(baseDir, options.adapter);
  if (directoryError !== undefined) {
    const cause = sanitizeBoundedDiagnosticText(
      withoutMachinePaths(directoryError, options.projectDir),
    ).replace(/\.$/, "");
    throw EVAL_LOAD_FAILED.create({
      detail:
        `Eval ${evalId} could not be loaded because the evals directory could not be read: ${cause}. Fix the cause, then run the eval again.`,
      context: { evalId },
    });
  }

  const fileError = errors.find((entry) =>
    entry.filePath !== baseDir && deriveEvalId(entry.filePath, baseDir) === evalId
  );
  if (fileError) {
    const filePath = toProjectRelativePath(fileError.filePath, options.projectDir);
    const cause = sanitizeBoundedDiagnosticText(
      withoutMachinePaths(fileError.error, options.projectDir),
    ).replace(/\.$/, "");
    throw EVAL_LOAD_FAILED.create({
      detail:
        `Eval ${evalId} failed to load from ${filePath}: ${cause}. Fix the file, then run the eval again.`,
      context: { evalId, filePath },
    });
  }

  const name = evalId.startsWith("eval:") ? evalId.slice("eval:".length) : evalId;
  const expectedPath = `${stripTrailingSlashes(evalsDir)}/${name}.eval.ts`;
  throw EVAL_NOT_FOUND.create({
    detail:
      `Eval not found: ${evalId}. Veryfront looks for it in ${expectedPath} (or a .tsx, .js or .jsx file at that path), exported with evalAgent, evalTool or evalDataset. Ensure the file is in the source this run uses, or use the ID that the evals list shows.`,
    context: { evalId, expectedPath },
  });
}

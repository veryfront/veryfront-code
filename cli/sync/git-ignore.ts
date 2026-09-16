/**
 * Git ignore resolution for sync.
 *
 * Push, deploy, and pull defer to Git for which local files are ignored, so
 * every Git ignore source applies: `.gitignore` at any level,
 * `.git/info/exclude`, and `core.excludesFile`. Parsing `.gitignore` directly
 * would miss the last two, which is where local tooling (for example
 * Conductor's `.context/`) registers its scratch directories.
 */

import { env } from "#cli/process-env";
import { runCommand } from "#cli/process-command";
import { cliLogger, logWarning } from "#cli/utils";
import { isNotFoundError, lstat } from "veryfront/fs";
import { dirname, join, relative, resolve } from "veryfront/platform/path";
import { hasGitMetadata } from "../shared/deployment-provenance.ts";
import { isJsonMode, streamJsonLine } from "../shared/json-output.ts";

const GIT_IGNORE_TIMEOUT_MS = 30_000;

/** Keep each `git check-ignore` command line well under the Windows limit. */
const CHECK_IGNORE_ARGUMENT_BUDGET = 24_000;

export const IGNORED_PROJECT_DIRECTORY_WARNING_CODE = "git-ignore-rules-not-applied";

export const IGNORED_PROJECT_DIRECTORY_WARNING =
  "Project directory is ignored by the enclosing Git repository; Git ignore rules were not " +
  "applied. Default ignores and .vfignore still apply.";

/** Process, filesystem, and output seams, replaceable so the rules unit test hermetically. */
export interface GitIgnoreDependencies {
  runCommand: typeof runCommand;
  hasGitMetadata: (directory: string) => Promise<boolean>;
  pathExists: (path: string) => Promise<boolean>;
  isSymlink: (path: string) => Promise<boolean>;
  warnIgnoredProjectDirectory: (projectDir: string) => void;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymlink;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

const warnedIgnoredProjectDirectories = new Set<string>();

/**
 * Report, once per directory, that Git ignore rules were skipped. JSON mode
 * gets a structured warning line, so automation can tell that files the
 * enclosing repository ignores may be uploaded.
 */
function warnIgnoredProjectDirectory(projectDir: string): void {
  if (warnedIgnoredProjectDirectories.has(projectDir)) return;
  warnedIgnoredProjectDirectories.add(projectDir);
  if (isJsonMode()) {
    streamJsonLine({
      type: "warning",
      code: IGNORED_PROJECT_DIRECTORY_WARNING_CODE,
      message: IGNORED_PROJECT_DIRECTORY_WARNING,
    });
    return;
  }
  logWarning(IGNORED_PROJECT_DIRECTORY_WARNING);
}

const defaultDependencies: GitIgnoreDependencies = {
  runCommand,
  hasGitMetadata,
  pathExists,
  isSymlink,
  warnIgnoredProjectDirectory,
};

function gitIgnoreUnavailableError(cause?: unknown): Error {
  return new Error(
    "Could not read Git ignore rules for this project. Ensure Git can inspect the project checkout and try again.",
    cause === undefined ? undefined : { cause },
  );
}

type GitIgnoreRun =
  | { kind: "output"; stdout: string; code: number }
  | { kind: "no-repository" }
  | { kind: "submodule-path"; pathspec: string; submodule: string };

const SUBMODULE_PATHSPEC_ERROR = /Pathspec '(.+)' is in submodule '(.+)'/;

/**
 * Run one Git ignore query from `directory`.
 *
 * `acceptedFailureCodes` lists exit codes that are answers rather than errors
 * (`git check-ignore` exits 1 when nothing is ignored). Outside a repository,
 * or when Git is missing and no repository surrounds the directory, the query
 * reports `no-repository`. Any other failure inside a repository throws, so
 * sync never silently treats ignored files as project source.
 */
async function runGitIgnoreQuery(
  directory: string,
  args: string[],
  dependencies: GitIgnoreDependencies,
  acceptedFailureCodes: readonly number[] = [],
): Promise<GitIgnoreRun> {
  const gitEnv = env();
  for (const key of Object.keys(gitEnv)) {
    if (key.startsWith("GIT_")) delete gitEnv[key];
  }

  let result;
  try {
    result = await dependencies.runCommand("git", {
      args,
      cwd: directory,
      clearEnv: true,
      env: gitEnv,
      capture: true,
      timeoutMs: GIT_IGNORE_TIMEOUT_MS,
    });
  } catch (error) {
    // Git is not installed or could not start. That only matters when there
    // is a repository whose ignore rules we would otherwise skip.
    if (!(await dependencies.hasGitMetadata(directory))) return { kind: "no-repository" };
    cliLogger.debug("Failed to run git for ignore rules:", error);
    throw gitIgnoreUnavailableError(error);
  }

  if (result.outputTruncated) {
    cliLogger.debug("git output for ignore rules was truncated");
    throw gitIgnoreUnavailableError();
  }
  if (result.success || acceptedFailureCodes.includes(result.code)) {
    return { kind: "output", stdout: result.stdout ?? "", code: result.code };
  }
  const submodulePath = SUBMODULE_PATHSPEC_ERROR.exec(result.stderr ?? "");
  if (submodulePath) {
    return { kind: "submodule-path", pathspec: submodulePath[1]!, submodule: submodulePath[2]! };
  }
  if (/not a git repository/i.test(result.stderr ?? "")) return { kind: "no-repository" };
  if (!(await dependencies.hasGitMetadata(directory))) return { kind: "no-repository" };
  cliLogger.debug("git for ignore rules failed:", result.stderr);
  throw gitIgnoreUnavailableError();
}

const C_STYLE_ESCAPES: Readonly<Record<string, number>> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/** Undo Git's C-style quoting of a path it prints outside `-z` mode. */
export function unquoteGitPath(line: string): string {
  if (line.length < 2 || !line.startsWith('"') || !line.endsWith('"')) return line;
  const characters = [...line.slice(1, -1)];
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!;
    if (character !== "\\") {
      bytes.push(...encoder.encode(character));
      continue;
    }
    const next = characters[index + 1] ?? "";
    const octal = characters.slice(index + 1, index + 4).join("");
    if (/^[0-3][0-7]{2}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8));
      index += 3;
    } else if (next in C_STYLE_ESCAPES) {
      bytes.push(C_STYLE_ESCAPES[next]!);
      index += 1;
    } else {
      bytes.push(...encoder.encode(character));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Find the leading part of a `./`-prefixed argument that names the submodule
 * Git reported, whose path Git gives relative to the repository root.
 */
function submoduleArgumentRoot(pathspec: string, submodule: string): string | null {
  const segments = pathspec.split("/");
  for (let length = 1; length < segments.length; length++) {
    const candidate = segments.slice(0, length).join("/");
    if (candidate === `./${submodule}` || candidate.endsWith(`/${submodule}`)) return candidate;
  }
  return null;
}

interface NestedRepositoryContext {
  /** Project-relative path of the nested repository. */
  path: string;
  context: GitIgnoreContext;
}

const GITLINK_ENTRY = /^160000 [0-9a-f]+ \d+\t(.+)$/;

/**
 * Load the Git ignore context of every repository nested below `projectDir`:
 * checked-out submodules, and Git repositories that are not registered as
 * submodules. The enclosing repository lists an untracked nested repository as
 * one directory entry, but lists its files one by one when the directory also
 * holds files the enclosing repository tracks, so every directory above an
 * untracked path is probed for a `.git` boundary.
 */
async function loadNestedRepositories(
  baseDir: string,
  projectDir: string,
  dependencies: GitIgnoreDependencies,
): Promise<NestedRepositoryContext[]> {
  const candidates = new Set<string>();
  const index = await runGitIgnoreQuery(baseDir, ["ls-files", "--stage", "-z"], dependencies);
  if (index.kind !== "output") return [];
  for (const entry of index.stdout.split("\0")) {
    const path = GITLINK_ENTRY.exec(entry)?.[1];
    if (path) candidates.add(path);
  }
  const untracked = await runGitIgnoreQuery(
    baseDir,
    ["ls-files", "--others", "--exclude-standard", "-z"],
    dependencies,
  );
  if (untracked.kind !== "output") return [];
  for (const entry of untracked.stdout.split("\0")) {
    if (!entry) continue;
    const isDirectoryEntry = entry.endsWith("/");
    const segments = entry.replace(/\/+$/, "").split("/");
    // Git lists paths below the query directory; anything else is not a
    // nested repository location.
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      continue;
    }
    const depth = isDirectoryEntry ? segments.length : segments.length - 1;
    for (let length = 1; length <= depth; length++) {
      candidates.add(segments.slice(0, length).join("/"));
    }
  }

  const found: string[] = [];
  for (const path of [...candidates].sort((left, right) => left.length - right.length)) {
    // An inner repository is resolved by the outer nested repository's context.
    if (found.some((outer) => path.startsWith(`${outer}/`))) continue;
    if (await dependencies.pathExists(join(projectDir, path, ".git"))) found.push(path);
  }

  const repositories: NestedRepositoryContext[] = [];
  for (const path of found) {
    repositories.push({
      path,
      context: await loadGitIgnoreContext(join(projectDir, path), dependencies),
    });
  }
  // Longest paths first so an inner repository wins over its parent.
  return repositories.sort((left, right) => right.path.length - left.path.length);
}

/** Git ignore rules resolved for one project directory. */
export interface GitIgnoreContext {
  /**
   * Untracked local paths Git ignores, relative to the project directory. A
   * directory Git ignores in full is listed once, without a trailing slash, and
   * stands for everything beneath it. Tracked files are never listed.
   */
  readonly ignoredPaths: readonly string[];
  /**
   * Return the given project-relative paths Git's rules match, whether or not
   * they exist locally. Sync uses this for remote paths. Tracked paths are never
   * reported.
   */
  checkPaths(paths: Iterable<string>): Promise<string[]>;
}

const DISABLED_CONTEXT: GitIgnoreContext = {
  ignoredPaths: [],
  checkPaths: () => Promise.resolve([]),
};

function toPosix(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * Resolve Git's ignore rules for `projectDir`: `.gitignore` at any level,
 * `.git/info/exclude`, and `core.excludesFile`.
 *
 * Git is queried from the nearest existing directory, so a pull into a
 * directory it has not created yet still honours the enclosing repository.
 * Outside a repository, nothing is ignored. When the enclosing repository
 * ignores the project directory itself, Git rules are not applied at all, with
 * one warning, rather than hiding the whole project. Any other Git failure
 * inside a repository throws.
 */
export async function loadGitIgnoreContext(
  projectDir: string,
  dependencies: GitIgnoreDependencies = defaultDependencies,
): Promise<GitIgnoreContext> {
  const resolvedProjectDir = resolve(projectDir);
  let baseDir = resolvedProjectDir;
  while (!(await dependencies.pathExists(baseDir))) {
    const parent = dirname(baseDir);
    if (parent === baseDir) return DISABLED_CONTEXT;
    baseDir = parent;
  }
  const relativeProjectDir = toPosix(relative(baseDir, resolvedProjectDir));
  const prefix = relativeProjectDir === "." ? "" : relativeProjectDir;
  const baseArgument = (path: string) => `./${prefix ? `${prefix}/` : ""}${path}`;

  // `./` names the directory itself; the trailing slash lets directory-only
  // rules such as `generated/` match a directory that does not exist yet.
  const rootCheck = await runGitIgnoreQuery(
    baseDir,
    ["check-ignore", "--quiet", baseArgument("")],
    dependencies,
    [1],
  );
  if (rootCheck.kind === "no-repository") return DISABLED_CONTEXT;
  if (rootCheck.kind !== "output") throw gitIgnoreUnavailableError();
  if (rootCheck.code === 0) {
    dependencies.warnIgnoredProjectDirectory(resolvedProjectDir);
    return DISABLED_CONTEXT;
  }

  let ignoredPaths: string[] = [];
  if (!prefix) {
    const listing = await runGitIgnoreQuery(
      baseDir,
      // `ls-files` prints paths relative to its working directory and limits
      // the listing to it, which matches the relative paths sync scans.
      ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
      dependencies,
    );
    if (listing.kind === "no-repository") return DISABLED_CONTEXT;
    if (listing.kind !== "output") throw gitIgnoreUnavailableError();
    ignoredPaths = listing.stdout
      .split("\0")
      .map((path) => path.replace(/\/+$/, ""))
      .filter((path) => path.length > 0 && path !== ".");
  }

  // The enclosing repository's listing and `check-ignore` stop at a submodule
  // or nested repository, but sync still reads the files beneath it. Resolve
  // each one against its own Git context.
  const nestedRepositories = prefix ? [] : await loadNestedRepositories(
    baseDir,
    resolvedProjectDir,
    dependencies,
  );
  for (const repository of nestedRepositories) {
    ignoredPaths.push(
      ...repository.context.ignoredPaths.map((path) => `${repository.path}/${path}`),
    );
  }

  // Git refuses a path beyond a local symbolic link. Sync never reads through
  // such a link, so a remote path beneath one is left to the defaults and
  // `.vfignore` rather than failing the whole query.
  const symlinkedDirectories = new Map<string, Promise<boolean>>();
  function isBeneathSymlink(path: string): Promise<boolean> {
    if (prefix) return Promise.resolve(false);
    const segments = path.split("/");
    const checks: Promise<boolean>[] = [];
    for (let length = 1; length < segments.length; length++) {
      const directory = segments.slice(0, length).join("/");
      let check = symlinkedDirectories.get(directory);
      if (!check) {
        check = dependencies.isSymlink(join(resolvedProjectDir, directory));
        symlinkedDirectories.set(directory, check);
      }
      checks.push(check);
    }
    return Promise.all(checks).then((results) => results.some(Boolean));
  }

  async function checkPaths(paths: Iterable<string>): Promise<string[]> {
    const ownCandidates: string[] = [];
    const ignored: string[] = [];
    const nestedCandidates = new Map<NestedRepositoryContext, string[]>();
    for (const path of new Set(paths)) {
      if (!path || await isBeneathSymlink(path)) continue;
      const repository = nestedRepositories.find((entry) => path.startsWith(`${entry.path}/`));
      if (!repository) {
        ownCandidates.push(path);
        continue;
      }
      const grouped = nestedCandidates.get(repository) ?? [];
      grouped.push(path.slice(repository.path.length + 1));
      nestedCandidates.set(repository, grouped);
    }
    for (const [repository, grouped] of nestedCandidates) {
      for (const path of await repository.context.checkPaths(grouped)) {
        ignored.push(`${repository.path}/${path}`);
      }
    }
    ignored.push(...await checkOwnPaths(ownCandidates));
    return ignored;
  }

  async function checkOwnPaths(candidates: readonly string[]): Promise<string[]> {
    if (candidates.length === 0) return [];

    const batches: string[][] = [];
    let batch: string[] = [];
    let batchLength = 0;
    for (const path of candidates) {
      // `./` keeps Git from reading a leading `:` as pathspec magic or a
      // leading `-` as an option.
      const argument = baseArgument(path);
      if (batch.length > 0 && batchLength + argument.length > CHECK_IGNORE_ARGUMENT_BUDGET) {
        batches.push(batch);
        batch = [];
        batchLength = 0;
      }
      batch.push(argument);
      batchLength += argument.length + 1;
    }
    batches.push(batch);

    const outputPrefix = baseArgument("");
    const ignored: string[] = [];
    for (let arguments_ of batches) {
      let run = await runGitIgnoreQuery(
        baseDir,
        ["-c", "core.quotePath=false", "check-ignore", ...arguments_],
        dependencies,
        [1],
      );
      // Git refuses the whole query when a path lies in a submodule that is
      // not checked out (checked-out ones were routed above). No local files
      // exist there, so drop that submodule's paths and ask again.
      while (run.kind === "submodule-path") {
        const { pathspec } = run;
        const submoduleRoot = submoduleArgumentRoot(pathspec, run.submodule);
        const remaining = arguments_.filter((argument) =>
          argument !== pathspec &&
          !(submoduleRoot && argument.startsWith(`${submoduleRoot}/`))
        );
        if (remaining.length === arguments_.length) throw gitIgnoreUnavailableError();
        arguments_ = remaining;
        if (arguments_.length === 0) break;
        run = await runGitIgnoreQuery(
          baseDir,
          ["-c", "core.quotePath=false", "check-ignore", ...arguments_],
          dependencies,
          [1],
        );
      }
      if (run.kind === "submodule-path") continue;
      if (run.kind === "no-repository") return [];
      if (run.code === 1) continue;
      for (const line of run.stdout.split("\n")) {
        if (!line) continue;
        const path = unquoteGitPath(line);
        if (path.startsWith(outputPrefix)) ignored.push(path.slice(outputPrefix.length));
      }
    }
    return ignored;
  }

  return { ignoredPaths, checkPaths };
}

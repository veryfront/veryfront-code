import { dirname, isAbsolute, join, relative } from "#std/path";

export interface ExtensionCheckInvocation {
  command: string;
  args: string[];
  cwd: string;
}

export interface ExtensionCheckResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ExtensionCheckRunner = (
  invocation: ExtensionCheckInvocation,
) => Promise<ExtensionCheckResult>;

export interface ExtensionWorkspaceCheckSummary {
  members: number;
  entrypoints: number;
}

function exportedTypeScriptTargets(value: unknown, path = "exports"): string[] {
  if (typeof value === "string") {
    if (/[*?\[\]{}]/.test(value)) {
      throw new Error(
        `extension export globs are not supported at ${path}: ${value}`,
      );
    }
    return /\.(?:ts|tsx|mts|cts)$/.test(value) ? [value] : [];
  }
  if (value === null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      exportedTypeScriptTargets(entry, `${path}[${index}]`)
    );
  }
  if (!value || typeof value !== "object") {
    throw new Error(`invalid extension export branch at ${path}`);
  }
  return Object.entries(value).flatMap(([key, entry]) =>
    exportedTypeScriptTargets(entry, `${path}.${key}`)
  );
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  const content = await Deno.readTextFile(path);
  const value = JSON.parse(content);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value as Record<string, unknown>;
}

async function defaultRunner(
  invocation: ExtensionCheckInvocation,
): Promise<ExtensionCheckResult> {
  const output = await new Deno.Command(invocation.command, {
    args: invocation.args,
    cwd: invocation.cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

function diagnosticText(result: ExtensionCheckResult): string {
  return [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join(
    "\n",
  );
}

function normalizedMember(raw: string): string | undefined {
  const canonical = raw.replace(/^\.\//, "");
  if (/^extensions\/[^/]+$/.test(canonical)) return canonical;
  if (raw.includes("extensions/") || canonical.startsWith("extensions")) {
    throw new Error(
      `workspace member must be a canonical direct extensions child: ${raw}`,
    );
  }
  return undefined;
}

function isCanonicalContainedExportTarget(target: string): boolean {
  if (
    !target.startsWith("./") || isAbsolute(target) || target.includes("\\") ||
    target.includes("%") || target.includes("?") || target.includes("#")
  ) {
    return false;
  }
  const base = new URL("file:///extension-workspace/");
  const resolved = new URL(target, base);
  return resolved.protocol === "file:" &&
    resolved.pathname === `${base.pathname}${target.slice(2)}`;
}

async function requireRegularContainedFile(
  path: string,
  containmentRoot: string,
  missingMessage: string,
  invalidMessage: string,
): Promise<string> {
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) throw new Error(missingMessage);
    throw error;
  }
  if (!stat.isFile || stat.isSymlink) throw new Error(invalidMessage);
  const realPath = await Deno.realPath(path);
  if (
    realPath !== containmentRoot && !realPath.startsWith(`${containmentRoot}/`)
  ) {
    throw new Error(invalidMessage);
  }
  return realPath;
}

/** Check every exported TypeScript entrypoint for every extension workspace. */
export async function checkExtensionWorkspaces(
  options: { root?: string; runner?: ExtensionCheckRunner } = {},
): Promise<ExtensionWorkspaceCheckSummary> {
  const root = options.root ?? Deno.cwd();
  const rootRealPath = await Deno.realPath(root);
  const rootConfig = await readJson(join(root, "deno.json"));
  const workspace = Array.isArray(rootConfig.workspace)
    ? rootConfig.workspace
    : [];
  const members: string[] = [];
  const seenMembers = new Set<string>();
  for (const entry of workspace) {
    if (typeof entry !== "string") {
      throw new Error("workspace members must be strings");
    }
    const member = normalizedMember(entry);
    if (!member) continue;
    if (seenMembers.has(member)) {
      throw new Error(`duplicate extension workspace member: ${member}`);
    }
    seenMembers.add(member);
    members.push(member);
  }
  members.sort();
  if (members.length === 0) {
    throw new Error("root workspace has zero extension members");
  }

  const extensionsPath = join(root, "extensions");
  const extensionsStat = await Deno.lstat(extensionsPath);
  if (!extensionsStat.isDirectory || extensionsStat.isSymlink) {
    throw new Error(
      "extensions workspace root must be a non-symlink directory",
    );
  }
  const extensionsRealPath = await Deno.realPath(extensionsPath);
  if (
    dirname(extensionsRealPath) !== rootRealPath ||
    extensionsRealPath !== join(rootRealPath, "extensions")
  ) {
    throw new Error("extensions workspace root escapes repository root");
  }

  if (rootConfig.lock === false) {
    throw new Error("extension checks require a workspace-root lockfile");
  }
  const rawLockPath = rootConfig.lock === undefined
    ? "deno.lock"
    : typeof rootConfig.lock === "string"
    ? rootConfig.lock
    : (() => {
      throw new Error("extension checks require a workspace-root lockfile");
    })();
  if (
    isAbsolute(rawLockPath) || rawLockPath.includes("\\") ||
    rawLockPath.split("/").includes("..")
  ) {
    throw new Error(
      "extension lockfile path must remain inside the workspace root",
    );
  }
  const lockPath = await requireRegularContainedFile(
    join(root, rawLockPath),
    rootRealPath,
    "extension checks require a workspace-root lockfile",
    "extension lockfile must be a contained regular non-symlink file",
  );

  const runner = options.runner ?? defaultRunner;
  let totalEntrypoints = 0;
  for (const member of members) {
    const memberDirectory = join(root, member);
    const memberStat = await Deno.lstat(memberDirectory);
    if (!memberStat.isDirectory || memberStat.isSymlink) {
      throw new Error(
        `extension workspace member must be a direct non-symlink directory: ${member}`,
      );
    }
    const memberRealPath = await Deno.realPath(memberDirectory);
    if (dirname(memberRealPath) !== extensionsRealPath) {
      throw new Error(
        `extension workspace member must be a direct non-symlink directory: ${member}`,
      );
    }
    const manifestPath = join(memberDirectory, "deno.json");
    const manifestRealPath = await requireRegularContainedFile(
      manifestPath,
      memberRealPath,
      `extension manifest is missing: ${member}`,
      `extension manifest must be a contained regular file: ${member}`,
    );
    const manifest = await readJson(manifestPath);
    const entrypoints = [
      ...new Set(exportedTypeScriptTargets(manifest.exports)),
    ]
      .map((entrypoint) => {
        if (
          !isCanonicalContainedExportTarget(entrypoint) ||
          entrypoint.split("/").includes("..")
        ) {
          throw new Error(
            `extension export escapes workspace: ${member}: ${entrypoint}`,
          );
        }
        const target = isAbsolute(entrypoint)
          ? entrypoint
          : join(memberDirectory, entrypoint);
        const fromMember = relative(memberDirectory, target).replaceAll(
          "\\",
          "/",
        );
        if (fromMember === ".." || fromMember.startsWith("../")) {
          throw new Error(
            `extension export escapes workspace: ${member}: ${entrypoint}`,
          );
        }
        return target;
      })
      .sort();
    if (entrypoints.length === 0) {
      throw new Error(
        `extension workspace has zero exported TypeScript entrypoints: ${member}`,
      );
    }
    const checkedEntrypoints: string[] = [];
    for (const entrypoint of entrypoints) {
      const rawEntrypoint = `./${
        relative(memberDirectory, entrypoint).replaceAll("\\", "/")
      }`;
      checkedEntrypoints.push(
        await requireRegularContainedFile(
          entrypoint,
          memberRealPath,
          `extension export is missing: ${member}: ${rawEntrypoint}`,
          `extension export must be a regular file contained in its workspace: ${member}: ${rawEntrypoint}`,
        ),
      );
    }
    totalEntrypoints += entrypoints.length;
    const result = await runner({
      command: Deno.execPath(),
      args: [
        "check",
        `--config=${manifestRealPath}`,
        "--frozen",
        `--lock=${lockPath}`,
        ...checkedEntrypoints,
      ],
      cwd: rootRealPath,
    });
    const diagnostics = diagnosticText(result);
    if (diagnostics.includes("No matching files found")) {
      throw new Error(
        `extension typecheck produced zero-file warning for ${member}: ${diagnostics}`,
      );
    }
    if (result.code !== 0) {
      throw new Error(
        `extension typecheck failed for ${member} (exit ${result.code}): ${
          diagnostics || "no diagnostics"
        }`,
      );
    }
  }
  if (totalEntrypoints === 0) {
    throw new Error(
      "extension workspace check found zero exported TypeScript entrypoints",
    );
  }
  return { members: members.length, entrypoints: totalEntrypoints };
}

if (import.meta.main) {
  try {
    const result = await checkExtensionWorkspaces();
    console.log(
      `Extension typecheck: checked ${result.entrypoints} entrypoints across ${result.members} workspaces.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

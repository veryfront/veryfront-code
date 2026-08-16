import { dirname, join, relative } from "#veryfront/compat/path";
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";

function rejectUnconfinedReadScope(): never {
  throw SECURITY_VIOLATION.create({
    detail: "Worker read scope contains a symlink outside its allowed roots",
  });
}

function directorySymlinkCanEscape(
  linkPath: string,
  targetPath: string,
  physicalRoots: readonly string[],
): boolean {
  for (const sourceRoot of physicalRoots) {
    if (!isWithinDirectory(sourceRoot, linkPath)) continue;
    const sourceRelativePath = relative(sourceRoot, linkPath);
    const parentSteps = sourceRelativePath === "."
      ? 0
      : sourceRelativePath.split("/").filter(Boolean).length;
    let targetAncestor = targetPath;
    for (let index = 0; index < parentSteps; index += 1) {
      targetAncestor = dirname(targetAncestor);
    }
    if (!physicalRoots.some((root) => isWithinDirectory(root, targetAncestor))) {
      return true;
    }
  }
  return false;
}

function assertSymlinkConfined(
  linkPath: string,
  physicalRoots: readonly string[],
): void {
  let target: string;
  let targetMetadata: Deno.FileInfo;
  try {
    target = Deno.realPathSync(linkPath);
    targetMetadata = Deno.statSync(target);
  } catch {
    rejectUnconfinedReadScope();
  }
  if (
    !physicalRoots.some((root) => isWithinDirectory(root, target)) ||
    (targetMetadata.isDirectory && directorySymlinkCanEscape(linkPath, target, physicalRoots))
  ) {
    rejectUnconfinedReadScope();
  }
}

/**
 * Reject scoped worker roots that contain a pre-existing symlink escape.
 *
 * Deno authorizes reads using the symlink location rather than its resolved
 * target. Project workers cannot create new symlinks because write access is
 * denied, so auditing the host-owned tree before startup closes that gap.
 */
export function assertWorkerReadScopeConfined(
  readScope: readonly string[] | boolean,
): void {
  if (!Array.isArray(readScope) || readScope.length === 0) return;

  const physicalRoots: string[] = [];
  for (const root of readScope) {
    try {
      physicalRoots.push(Deno.realPathSync(root));
    } catch (error) {
      // A missing optional support path grants nothing at startup. Project
      // workers cannot create it because their write permission is denied.
      if (isNotFoundError(error)) continue;
      rejectUnconfinedReadScope();
    }
  }

  const pending = [...new Set(physicalRoots)];
  const visitedDirectories = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    let metadata: Deno.FileInfo;
    try {
      metadata = Deno.lstatSync(current);
    } catch {
      rejectUnconfinedReadScope();
    }
    if (metadata.isSymlink) {
      assertSymlinkConfined(current, physicalRoots);
      continue;
    }
    if (!metadata.isDirectory) continue;

    if (visitedDirectories.has(current)) continue;
    visitedDirectories.add(current);

    try {
      for (const entry of Deno.readDirSync(current)) {
        const entryPath = join(current, entry.name);
        if (entry.isSymlink) {
          assertSymlinkConfined(entryPath, physicalRoots);
        } else if (entry.isDirectory) {
          pending.push(entryPath);
        }
      }
    } catch {
      rejectUnconfinedReadScope();
    }
  }
}

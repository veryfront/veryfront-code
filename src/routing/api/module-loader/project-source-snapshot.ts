import * as pathHelper from "#veryfront/compat/path";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { realPath } from "#veryfront/platform/compat/fs.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation.ts";
import { captureBoundedTextReader } from "#veryfront/platform/adapters/bounded-text-reader.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

interface ProjectBoundaryRoots {
  readonly configuredProject: string;
  /** Canonical source roots. Empty for adapter-only virtual projects. */
  readonly project: readonly string[];
  /** Canonical dependency roots explicitly owned by the project. */
  readonly dependencies: readonly string[];
}

export interface ProjectSourceFile {
  /** Logical path used for relative module resolution. */
  readonly logicalPath: string;
  /** Authorized path supplied to the adapter for I/O. */
  readonly readPath: string;
  readonly contents: string;
}

export interface ProjectSourceSnapshot {
  read(path: string): Promise<ProjectSourceFile>;
  readTextFile(path: string): Promise<string>;
  readTextFileWithinLimit(path: string, maximumBytes: number, label: string): Promise<string>;
}

export class ProjectBoundaryViolationError extends TypeError {
  override name = "ProjectBoundaryViolationError";
}

export function rethrowProjectBoundaryViolation(error: unknown): void {
  if (error instanceof ProjectBoundaryViolationError) throw error;
}

async function canonicalPathIfPresent(path: string): Promise<string | null> {
  try {
    return pathHelper.resolve(await realPath(path));
  } catch {
    return null;
  }
}

async function resolveProjectRoots(projectDir: string): Promise<ProjectBoundaryRoots> {
  const configuredProject = pathHelper.resolve(projectDir);
  const canonicalProject = await canonicalPathIfPresent(configuredProject);
  const project = canonicalProject ? [canonicalProject] : [];

  // A dependency root is trusted only when its canonical target remains inside
  // this project. A project node_modules symlink to another host directory must
  // not turn that directory into an authorized source root.
  const dependencyCandidates = new Set([
    pathHelper.join(configuredProject, "node_modules"),
    ...(canonicalProject ? [pathHelper.join(canonicalProject, "node_modules")] : []),
  ]);
  const dependencies: string[] = [];
  for (const candidate of dependencyCandidates) {
    const canonical = await canonicalPathIfPresent(candidate);
    if (
      canonical &&
      project.some((root) => isWithinDirectory(root, canonical)) &&
      !dependencies.includes(canonical)
    ) {
      dependencies.push(canonical);
    }
  }

  return Object.freeze({
    configuredProject,
    project: Object.freeze(project),
    dependencies: Object.freeze(dependencies),
  });
}

function isWithinProjectBoundary(path: string, roots: ProjectBoundaryRoots): boolean {
  return roots.project.some((root) => isWithinDirectory(root, path)) ||
    roots.dependencies.some((root) => isWithinDirectory(root, path));
}

function boundaryViolation(path: string): ProjectBoundaryViolationError {
  return new ProjectBoundaryViolationError(
    `Import escapes the project directory: ${path}. ` +
      `API routes may only import project files and project-owned dependencies.`,
  );
}

async function resolveAuthorizedReadPath(
  path: string,
  roots: ProjectBoundaryRoots,
): Promise<string> {
  const logicalPath = pathHelper.resolve(path);
  if (
    !isWithinDirectory(roots.configuredProject, logicalPath) &&
    !isWithinProjectBoundary(logicalPath, roots)
  ) {
    throw boundaryViolation(path);
  }

  const canonical = await canonicalPathIfPresent(logicalPath);
  // Adapter-only projects intentionally have no corresponding host path. Their
  // adapter remains authoritative, after lexical project containment above.
  if (canonical === null) return logicalPath;
  if (isWithinProjectBoundary(canonical, roots)) return canonical;
  throw boundaryViolation(path);
}

/**
 * Capture project source through one canonical, memoized read boundary.
 *
 * All host-backed reads use the authorized canonical path. Repeated consumers
 * (dependency discovery, bundling, and post-build rewriting) receive the same
 * immutable source bytes rather than reopening a path that may have changed.
 */
export async function createProjectSourceSnapshot(
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<ProjectSourceSnapshot> {
  const roots = await resolveProjectRoots(projectDir);
  const snapshots = new Map<string, Promise<string>>();

  async function read(path: string): Promise<ProjectSourceFile> {
    const logicalPath = pathHelper.resolve(path);
    const readPath = await resolveAuthorizedReadPath(logicalPath, roots);
    let contents = snapshots.get(readPath);
    if (!contents) {
      contents = adapter.fs.readFile(readPath);
      snapshots.set(readPath, contents);
    }

    return Object.freeze({
      logicalPath,
      readPath,
      contents: await contents,
    });
  }

  return Object.freeze({
    read,
    async readTextFile(path: string): Promise<string> {
      return (await read(path)).contents;
    },
    async readTextFileWithinLimit(
      path: string,
      maximumBytes: number,
      label: string,
    ): Promise<string> {
      const logicalPath = pathHelper.resolve(path);
      const readPath = await resolveAuthorizedReadPath(logicalPath, roots);
      const existing = snapshots.get(readPath);
      if (existing) {
        const contents = await existing;
        if (utf8ByteLength(contents, maximumBytes) > maximumBytes) {
          throw new TypeError(`${label} exceeds ${maximumBytes} bytes`);
        }
        return contents;
      }

      const boundedReader = captureBoundedTextReader(
        adapter.fs,
        "Project source snapshot",
      );
      const contents = boundedReader.readUtf8(
        readPath,
        maximumBytes,
        label,
      ).then((result) => result.content);
      snapshots.set(readPath, contents);
      try {
        return await contents;
      } catch (error) {
        if (snapshots.get(readPath) === contents) snapshots.delete(readPath);
        throw error;
      }
    },
  });
}

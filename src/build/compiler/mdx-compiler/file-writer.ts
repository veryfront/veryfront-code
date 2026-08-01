import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors";
import type { CompileOptions } from "./types.ts";
import {
  type BuildOutputOwnership,
  ensureOwnedBuildDescendant,
  resolveBuildOutputOwnership,
} from "../../production-build/build/build-publication.ts";

const fs = createFileSystem();

export interface CompileMDXFileDependencies {
  readonly ownedOutput?: {
    readonly output: BuildOutputOwnership;
    readonly fileSystem: FileSystem;
  };
}

function isContainedPath(basePath: string, candidatePath: string): boolean {
  const relativePath = relative(basePath, candidatePath);
  return relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith("../") &&
      !relativePath.startsWith("..\\") &&
      !isAbsolute(relativePath));
}

async function canonicalTargetPath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  try {
    return await realPath(absolutePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const suffix: string[] = [];
  let current = absolutePath;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Cannot resolve an existing ancestor for ${path}`);
    }
    suffix.unshift(basename(current));

    try {
      return resolve(await realPath(parent), ...suffix);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      current = parent;
    }
  }
}

async function assertContained(
  basePath: string,
  candidatePath: string,
  description: string,
): Promise<void> {
  const [canonicalBase, canonicalCandidate] = await Promise.all([
    canonicalTargetPath(basePath),
    canonicalTargetPath(candidatePath),
  ]);
  if (isContainedPath(canonicalBase, canonicalCandidate)) return;

  throw SECURITY_VIOLATION.create({
    detail: `${description} resolves outside its configured directory`,
  });
}

async function removeIfPresent(path: string, fileSystem: FileSystem): Promise<void> {
  try {
    await fileSystem.remove(path);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }
}

export async function writeCompiledFile(
  filePath: string,
  code: string,
  options: CompileOptions,
  dependencies: CompileMDXFileDependencies = {},
): Promise<string> {
  const ownedOutput = dependencies.ownedOutput;
  const fileSystem = ownedOutput?.fileSystem ?? fs;
  let outputPath: string;
  if (ownedOutput) {
    const relativeOutputPath = await getCompiledRelativeOutputPath(
      filePath,
      options.projectDir,
    );
    const portableRelativePath = relativeOutputPath.replaceAll("\\", "/");
    const relativeParent = dirname(portableRelativePath);
    const outputParent = relativeParent === "."
      ? resolveBuildOutputOwnership(ownedOutput.output, fileSystem)
      : await ensureOwnedBuildDescendant(
        ownedOutput.output,
        fileSystem,
        relativeParent,
      );
    outputPath = join(outputParent, basename(portableRelativePath));
  } else {
    outputPath = await getCompiledOutputPath(filePath, options);
    await fileSystem.mkdir(dirname(outputPath), { recursive: true });
  }
  const temporaryPath = join(
    dirname(outputPath),
    `.${basename(outputPath)}.tmp-${crypto.randomUUID()}`,
  );
  const rename = fileSystem.rename?.bind(fileSystem);
  if (!rename) {
    throw new Error("Atomic MDX output requires filesystem rename support");
  }

  let writeError: unknown;
  try {
    await fileSystem.writeTextFile(temporaryPath, code);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    writeError = error;
  }

  try {
    await removeIfPresent(temporaryPath, fileSystem);
  } catch (cleanupError) {
    if (writeError !== undefined) {
      throw new AggregateError(
        [writeError, cleanupError],
        `Failed to write and clean up compiled MDX output ${outputPath}`,
      );
    }
    throw cleanupError;
  }
  if (writeError !== undefined) throw writeError;

  return outputPath;
}

/** Resolve and validate the output path corresponding to one project MDX source. */
export async function getCompiledOutputPath(
  filePath: string,
  options: Pick<CompileOptions, "projectDir" | "outputDir">,
): Promise<string> {
  const sourceRelativePath = await getCompiledRelativeOutputPath(
    filePath,
    options.projectDir,
  );
  const outputDir = resolve(options.outputDir);
  const outputPath = resolve(outputDir, sourceRelativePath);
  await assertContained(outputDir, outputPath, "Compiled MDX output path");

  return outputPath;
}

async function getCompiledRelativeOutputPath(
  filePath: string,
  configuredProjectDir: string,
): Promise<string> {
  const projectDir = resolve(configuredProjectDir);
  const sourcePath = resolve(filePath);
  await assertContained(projectDir, sourcePath, "MDX source path");

  const sourceRelativePath = relative(projectDir, sourcePath);
  if (
    sourceRelativePath === "" ||
    sourceRelativePath === ".." ||
    sourceRelativePath.startsWith("../") ||
    sourceRelativePath.startsWith("..\\") ||
    isAbsolute(sourceRelativePath)
  ) {
    throw SECURITY_VIOLATION.create({
      detail: "MDX source path resolves outside the project directory",
    });
  }

  return sourceRelativePath.replace(/\.mdx$/i, ".js");
}

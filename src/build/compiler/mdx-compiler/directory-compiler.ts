import { bundlerLogger as logger } from "#veryfront/utils";
import { isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { compileMDXFile } from "./compiler.ts";
import type { CompileMDXFileDependencies } from "./file-writer.ts";
import type { CompileOptions, CompileResult } from "./types.ts";
import { pathExists, validateCompileOptions } from "./validator.ts";
import {
  createBuildPublication,
  resolveBuildOutputOwnership,
} from "../../production-build/build/build-publication.ts";
import { assertSafeBuildOutputDirectory } from "../../production-build/build/output-plan.ts";

const ADDITIONAL_MDX_SOURCE_DIRECTORIES = ["layouts", "providers"] as const;

export interface CompileAllMDXDependencies {
  readonly fs?: ReturnType<typeof createFileSystem>;
}

export async function compileAllMDX(
  options: CompileOptions,
  dependencies: CompileAllMDXDependencies = {},
): Promise<Map<string, CompileResult>> {
  validateCompileOptions(options);
  options.signal?.throwIfAborted();

  const fs = dependencies.fs ?? createFileSystem();
  await assertSafeBuildOutputDirectory(
    options.projectDir,
    options.outputDir,
    undefined,
    ADDITIONAL_MDX_SOURCE_DIRECTORIES,
  );
  options.signal?.throwIfAborted();
  const publication = await createBuildPublication(options.outputDir, false, { fs });
  if (publication.dryRun) {
    throw new TypeError("MDX publication unexpectedly entered dry-run mode");
  }
  const stagingDir = resolveBuildOutputOwnership(publication.outputOwnership, fs);
  let results: Map<string, CompileResult> | undefined;
  let compileError: unknown;

  try {
    options.signal?.throwIfAborted();
    const stagedResults = await compileProjectDirectories({
      ...options,
      outputDir: stagingDir,
    }, {
      ownedOutput: {
        output: publication.outputOwnership,
        fileSystem: fs,
      },
    });
    results = remapPublishedResults(
      stagedResults,
      stagingDir,
      publication.finalDir,
    );
    await publication.publish();
  } catch (error) {
    compileError = error;
  }

  let cleanupError: unknown;
  try {
    await publication.cleanup();
  } catch (error) {
    cleanupError = error;
  }

  if (compileError !== undefined) {
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [compileError, cleanupError],
        "MDX compilation failed and its staging output could not be cleaned up",
      );
    }
    throw compileError;
  }
  if (cleanupError !== undefined) throw cleanupError;
  if (!results) throw new Error("MDX compilation completed without producing a result");

  logger.info(`Compiled ${results.size} MDX files`);
  return results;
}

async function compileProjectDirectories(
  options: CompileOptions,
  dependencies: CompileMDXFileDependencies,
): Promise<Map<string, CompileResult>> {
  const results = new Map<string, CompileResult>();
  const failures: Error[] = [];
  const directories = ["pages", "layouts", "providers"];
  const adapter = await runtime.get();

  for (const dir of directories) {
    options.signal?.throwIfAborted();
    const fullPath = join(options.projectDir, dir);
    if (!(await pathExists(fullPath))) continue;
    const info = await adapter.fs.stat(fullPath);
    if (!info.isDirectory) {
      throw new TypeError(`MDX source location is not a directory: ${fullPath}`);
    }
    await compileMDXDirectory(
      fullPath,
      options,
      dependencies,
      results,
      failures,
      adapter,
    );
  }

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to compile ${failures.length} MDX file${failures.length === 1 ? "" : "s"}`,
    );
  }
  return results;
}

async function compileMDXDirectory(
  dir: string,
  options: CompileOptions,
  dependencies: CompileMDXFileDependencies,
  results: Map<string, CompileResult>,
  failures: Error[],
  adapter: Awaited<ReturnType<typeof runtime.get>>,
): Promise<void> {
  const files: string[] = [];
  for await (const file of discoverFiles({ baseDir: dir, extensions: [".mdx"], adapter })) {
    files.push(file.path);
  }
  files.sort((left, right) => left.localeCompare(right, "en-US"));

  for (const filePath of files) {
    options.signal?.throwIfAborted();
    try {
      const content = await adapter.fs.readFile(filePath);
      const result = await compileMDXFile(filePath, content, options, dependencies);
      results.set(filePath, result);
    } catch (error) {
      logger.error(`Failed to compile ${filePath}:`, error);
      failures.push(
        new Error(`Failed to compile MDX source ${filePath}`, {
          cause: error,
        }),
      );
    }
  }
}

function remapPublishedResults(
  results: ReadonlyMap<string, CompileResult>,
  stagingDir: string,
  finalDir: string,
): Map<string, CompileResult> {
  const published = new Map<string, CompileResult>();
  for (const [sourcePath, result] of results) {
    const relativePath = relative(stagingDir, result.outputPath);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith("../") ||
      relativePath.startsWith("..\\") ||
      isAbsolute(relativePath)
    ) {
      throw new Error(`Compiled MDX output escaped its staging directory: ${result.outputPath}`);
    }
    published.set(sourcePath, {
      ...result,
      outputPath: join(finalDir, relativePath),
    });
  }
  return published;
}

import { bundlerLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/compat/path/index.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { compileMDXFile } from "./compiler.ts";
import type { CompileOptions, CompileResult } from "./types.ts";
import { getMDXSourceDirectories, pathExists, validateCompileOptions } from "./validator.ts";
import { ensureError } from "#veryfront/errors";
import { relative } from "#veryfront/compat/path/index.ts";

/** Compile every discovered `.mdx` source and aggregate independent failures. */
export async function compileAllMDX(options: CompileOptions): Promise<Map<string, CompileResult>> {
  validateCompileOptions(options);
  const results = new Map<string, CompileResult>();
  const errors: Error[] = [];
  const directories = getMDXSourceDirectories(options);

  for (const dir of directories) {
    const fullPath = join(options.projectDir, dir);
    if (!(await pathExists(fullPath))) continue;
    await compileMDXDirectory(fullPath, options, results, errors);
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `Failed to compile ${errors.length} MDX file${errors.length === 1 ? "" : "s"}`,
    );
  }
  logger.info(`Compiled ${results.size} MDX files`);
  return results;
}

async function compileMDXDirectory(
  dir: string,
  options: CompileOptions,
  results: Map<string, CompileResult>,
  errors: Error[],
): Promise<void> {
  const adapter = await runtime.get();

  for await (const file of discoverFiles({ baseDir: dir, extensions: [".mdx"], adapter })) {
    try {
      const content = await adapter.fs.readFile(file.path);
      const result = await compileMDXFile(file.path, content, options);
      results.set(file.path, result);
    } catch (error) {
      const sourcePath = relative(options.projectDir, file.path);
      errors.push(
        new Error(`Failed to compile MDX source: ${sourcePath}`, {
          cause: ensureError(error),
        }),
      );
    }
  }
}

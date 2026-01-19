import { bundlerLogger as logger } from "#veryfront/utils";
import { join } from "#veryfront/platform/compat/path/index.ts";
import type { CompileOptions, CompileResult } from "./types.ts";
import { pathExists } from "./validator.ts";
import { compileMDXFile } from "./compiler.ts";
import { discoverFiles } from "#veryfront/utils/file-discovery.ts";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";

export async function compileAllMDX(options: CompileOptions): Promise<Map<string, CompileResult>> {
  const results = new Map<string, CompileResult>();

  const directories = ["pages", "layouts", "providers"];

  for (const dir of directories) {
    const fullPath = join(options.projectDir, dir);
    if (await pathExists(fullPath)) {
      await compileMDXDirectory(fullPath, options, results);
    }
  }

  logger.info(`Compiled ${results.size} MDX files`);

  return results;
}

export async function compileMDXDirectory(
  dir: string,
  options: CompileOptions,
  results: Map<string, CompileResult>,
): Promise<void> {
  const adapter = await getAdapter();
  for await (
    const file of discoverFiles({
      baseDir: dir,
      extensions: [".mdx"],
      adapter,
    })
  ) {
    try {
      const content = await adapter.fs.readFile(file.path);
      const result = await compileMDXFile(file.path, content, options);
      results.set(file.path, result);
    } catch (error) {
      logger.error(`Failed to compile ${file.path}:`, error);
    }
  }
}

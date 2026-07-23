import { dirname, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { CompileOptions } from "./types.ts";

const fs = createFileSystem();

export async function writeCompiledFile(
  filePath: string,
  code: string,
  options: CompileOptions,
): Promise<string> {
  const relativePath = relative(resolve(options.projectDir), resolve(filePath));
  if (
    relativePath === "" || relativePath.split(/[\\/]/)[0] === ".." || isAbsolute(relativePath)
  ) {
    throw new TypeError("MDX source path is outside projectDir");
  }
  if (!/\.mdx$/i.test(relativePath)) {
    throw new TypeError("MDX source path must end with .mdx");
  }

  const outputPath = join(
    options.outputDir,
    relativePath.replace(/\.mdx$/i, ".js"),
  );

  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeTextFile(outputPath, code);

  return outputPath;
}

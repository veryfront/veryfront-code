import { dirname, join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { CompileOptions } from "./types.ts";

const fs = createFileSystem();

export async function writeCompiledFile(
  filePath: string,
  code: string,
  options: CompileOptions,
): Promise<string> {
  const relativePath = filePath
    .replace(options.projectDir, "")
    .replace(/^\//, "");

  const outputPath = join(
    options.outputDir,
    relativePath.replace(".mdx", ".js"),
  );

  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeTextFile(outputPath, code);

  return outputPath;
}

import { dirname, join } from "../../../platform/compat/path/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import type { CompileOptions } from "./types.js";

const fs = createFileSystem();

export async function writeCompiledFile(
  filePath: string,
  code: string,
  options: CompileOptions,
): Promise<string> {
  const relativePath = filePath.replace(options.projectDir, "").replace(/^\//, "");
  const outputPath = join(options.outputDir, relativePath.replace(".mdx", ".js"));

  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeTextFile(outputPath, code);

  return outputPath;
}

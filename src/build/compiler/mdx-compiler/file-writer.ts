import { ensureDir } from "std/fs/mod.ts";
import { join, resolve } from "std/path/mod.ts";
import type { CompileOptions } from "./types.ts";

export async function writeCompiledFile(
  filePath: string,
  code: string,
  options: CompileOptions,
): Promise<string> {
  const relativePath = filePath.replace(options.projectDir, "").replace(/^\//, "");
  const outputPath = join(options.outputDir, relativePath.replace(".mdx", ".js"));

  await ensureDir(resolve(outputPath, ".."));
  await Deno.writeTextFile(outputPath, code);

  return outputPath;
}

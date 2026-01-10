import { join } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import { denoAdapter } from "@veryfront/platform/adapters/deno.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { TailwindProcessor } from "./processor.ts";
import { isTailwindV4File } from "./detector.ts";

export async function processTailwindCSS(
  options: TailwindProcessorOptions,
): Promise<TailwindProcessResult> {
  const processor = new TailwindProcessor(options);
  return await processor.process();
}

export async function processTailwindCSSInDirectory(
  projectDir: string,
  cssDir: string = "styles",
  outputDir: string = ".veryfront/css",
): Promise<TailwindProcessResult[]> {
  const results: TailwindProcessResult[] = [];
  const cssPath = join(projectDir, cssDir);
  const fs = createFileSystem();

  try {
    for await (const entry of fs.readDir(cssPath)) {
      if (entry.isFile && (entry.name.endsWith(".css"))) {
        const filePath = join(cssPath, entry.name);

        if (await isTailwindV4File(filePath, projectDir, denoAdapter)) {
          logger.info("Found Tailwind v4 file", { file: filePath });

          const result = await processTailwindCSS({
            projectDir,
            adapter: denoAdapter,
            inputFile: filePath,
            outputFile: join(projectDir, outputDir, entry.name),
          });

          results.push(result);
        }
      }
    }
  } catch (error) {
    logger.error("Error processing Tailwind CSS directory", error);
  }

  return results;
}

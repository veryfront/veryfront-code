import { join } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { TailwindProcessor } from "./processor.ts";
import { isTailwindV4File } from "./detector.ts";

export function processTailwindCSS(
  options: TailwindProcessorOptions,
): Promise<TailwindProcessResult> {
  const processor = new TailwindProcessor(options);
  return processor.process();
}

export async function processTailwindCSSInDirectory(
  projectDir: string,
  cssDir: string = "styles",
  outputDir: string = ".veryfront/css",
): Promise<TailwindProcessResult[]> {
  const results: TailwindProcessResult[] = [];
  const cssPath = join(projectDir, cssDir);
  const fs = createFileSystem();
  const adapter = await getAdapter();

  try {
    for await (const entry of fs.readDir(cssPath)) {
      if (entry.isFile && (entry.name.endsWith(".css"))) {
        const filePath = join(cssPath, entry.name);

        if (await isTailwindV4File(filePath, projectDir, adapter)) {
          logger.info("Found Tailwind v4 file", { file: filePath });

          const result = await processTailwindCSS({
            projectDir,
            adapter,
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

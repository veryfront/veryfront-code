import { join } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { TailwindProcessor } from "./processor.ts";
import { isTailwindV4File } from "./detector.ts";

export function processTailwindCSS(
  options: TailwindProcessorOptions,
): Promise<TailwindProcessResult> {
  return withSpan(
    "build.asset.processTailwindCSS",
    () => new TailwindProcessor(options).process(),
    {
      "tailwind.inputFile": options.inputFile,
      "tailwind.outputFile": options.outputFile ?? "",
    },
  );
}

export function processTailwindCSSInDirectory(
  projectDir: string,
  cssDir: string = "styles",
  outputDir: string = ".veryfront/css",
): Promise<TailwindProcessResult[]> {
  return withSpan(
    "build.asset.processTailwindCSSInDirectory",
    async () => {
      const results: TailwindProcessResult[] = [];
      const cssPath = join(projectDir, cssDir);
      const fs = createFileSystem();
      const adapter = await runtime.get();

      try {
        for await (const entry of fs.readDir(cssPath)) {
          if (!entry.isFile || !entry.name.endsWith(".css")) continue;

          const filePath = join(cssPath, entry.name);
          const isTailwind = await isTailwindV4File(filePath, projectDir, adapter);
          if (!isTailwind) continue;

          logger.info("Found Tailwind v4 file", { file: filePath });

          results.push(
            await processTailwindCSS({
              projectDir,
              adapter,
              inputFile: filePath,
              outputFile: join(projectDir, outputDir, entry.name),
            }),
          );
        }
      } catch (error) {
        logger.error("Error processing Tailwind CSS directory", error);
      }

      return results;
    },
    {
      "tailwind.projectDir": projectDir,
      "tailwind.cssDir": cssDir,
      "tailwind.outputDir": outputDir,
    },
  );
}

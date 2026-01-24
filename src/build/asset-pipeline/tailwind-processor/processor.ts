import { dirname } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";
import { countUtilities } from "./css-utils.ts";
import { processWithLightningCSS } from "./lightning-processor.ts";
import { createSecureFs } from "#veryfront/security";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export class TailwindProcessor {
  private options: TailwindProcessorOptions;

  constructor(options: TailwindProcessorOptions) {
    this.options = {
      content: autoDetectContentPaths(options.projectDir),
      minify: true,
      sourceMap: false,
      browserslist: ["defaults", "not IE 11"],
      ...options,
    };
  }

  process(): Promise<TailwindProcessResult> {
    return withSpan(
      "build.tailwind.process",
      async () => {
        const {
          inputFile,
          outputFile,
          content,
          minify,
          sourceMap,
          browserslist,
          projectDir,
          adapter,
        } = this.options;

        const secureFs = createSecureFs({
          baseDir: projectDir,
          adapter,
          context: "build",
          throwOnError: true,
        });

        logger.info("Processing Tailwind CSS v4...", { inputFile, outputFile });

        const inputCSS = await secureFs.readFile(inputFile);

        const isTailwind = await isTailwindV4File(inputFile, projectDir, adapter);
        if (!isTailwind) {
          logger.warn('File does not appear to be Tailwind v4 (@import "tailwindcss" not found)', {
            inputFile,
          });
        }

        const processedCSS = await processWithLightningCSS(inputCSS, {
          filename: inputFile,
          minify,
          sourceMap,
          browserslist,
        });

        const detectedUtilities = countUtilities(processedCSS);

        const result: TailwindProcessResult = {
          css: processedCSS,
          processedFiles: [inputFile, ...(content ?? [])],
          detectedUtilities,
        };

        if (!outputFile) return result;

        const dirPath = dirname(outputFile);
        await secureFs.mkdir(dirPath, { recursive: true });
        await secureFs.writeFile(outputFile, processedCSS);

        logger.info("Tailwind CSS processed successfully", {
          inputFile,
          outputFile,
          size: processedCSS.length,
          utilities: detectedUtilities,
        });

        return result;
      },
      {
        "build.tailwind.inputFile": this.options.inputFile,
        "build.tailwind.minify": this.options.minify ?? true,
      },
    );
  }
}

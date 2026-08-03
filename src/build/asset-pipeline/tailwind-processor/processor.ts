import { dirname, relative } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";
import { countUtilities } from "./css-utils.ts";
import { processWithCSSOptimization } from "./optimization-processor.ts";
import { createSecureFs } from "#veryfront/security";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isSafeCSSRelativePath } from "../css-optimizer/path-validation.ts";

export class TailwindProcessor {
  private options: TailwindProcessorOptions;

  constructor(options: TailwindProcessorOptions) {
    this.options = {
      content: autoDetectContentPaths(options.projectDir),
      minify: true,
      sourceMap: false,
      ...options,
    };
  }

  process(): Promise<TailwindProcessResult> {
    return withSpan(
      "build.tailwind.process",
      async (): Promise<TailwindProcessResult> => {
        const {
          inputFile,
          outputFile,
          content,
          minify,
          sourceMap,
          optimizationEngine,
          projectDir,
          adapter,
        } = this.options;

        const secureFs = createSecureFs({
          baseDir: projectDir,
          adapter,
          context: "build",
        });

        logger.info("Processing Tailwind CSS v4...", { inputFile, outputFile });

        const inputCSS = await secureFs.readFile(inputFile);

        const isTailwind = await isTailwindV4File(inputFile, projectDir, adapter);
        if (!isTailwind) {
          logger.warn('File does not appear to be Tailwind v4 (@import "tailwindcss" not found)', {
            inputFile,
          });
        }

        const sourcePath = relative(projectDir, inputFile).replaceAll("\\", "/")
          .normalize("NFC");
        if (!isSafeCSSRelativePath(sourcePath)) {
          throw new TypeError(
            "Tailwind batch input must have a safe project-relative path",
          );
        }
        const optimized = processWithCSSOptimization(inputCSS, {
          sourcePath,
          minify,
          sourceMap,
        }, optimizationEngine);
        const processedCSS = optimized.css;

        const detectedUtilities = countUtilities(processedCSS);

        const result: TailwindProcessResult = {
          css: processedCSS,
          ...(optimized.sourceMap === undefined ? {} : { sourceMap: optimized.sourceMap }),
          processedFiles: [inputFile, ...(content ?? [])],
          detectedUtilities,
        };

        if (!outputFile) {
          return result;
        }

        await secureFs.mkdir(dirname(outputFile), { recursive: true });
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

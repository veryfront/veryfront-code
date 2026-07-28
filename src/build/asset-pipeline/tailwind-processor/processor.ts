import { dirname, isAbsolute, resolve } from "#veryfront/compat/path/index.ts";
import { COMPILATION_ERROR, INITIALIZATION_ERROR } from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSecureFs, type SecureFs } from "#veryfront/security";
import { logger } from "#veryfront/utils";
import {
  extractCandidatesFromFiles,
  generateTailwindCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isContainedBuildPath } from "../../bundler/project-module-resolver.ts";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { autoDetectContentPaths, isTailwindV4File } from "./detector.ts";
import { collectTailwindSourceFiles } from "./source-collector.ts";

function projectPath(path: string, projectDir: string, label: string): string {
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(projectDir, path);
  if (
    absolutePath === projectDir ||
    !isContainedBuildPath(projectDir, absolutePath)
  ) {
    throw new TypeError(`${label} must resolve inside the Tailwind project`);
  }
  return absolutePath;
}

async function writeFileAtomically(
  secureFs: SecureFs,
  adapter: RuntimeAdapter,
  outputFile: string,
  content: string,
): Promise<void> {
  const rename = adapter.fs.rename?.bind(adapter.fs);
  if (!rename) {
    throw INITIALIZATION_ERROR.create({
      detail: "Atomic Tailwind output publication requires filesystem rename support",
    });
  }

  await secureFs.mkdir(dirname(outputFile), { recursive: true });
  const id = crypto.randomUUID();
  const stagedFile = `${outputFile}.veryfront-stage-${id}`;
  const backupFile = `${outputFile}.veryfront-backup-${id}`;
  const hadPreviousOutput = await secureFs.exists(outputFile);
  let movedPreviousOutput = false;

  try {
    await secureFs.writeFile(stagedFile, content);
    if (hadPreviousOutput) {
      await rename(outputFile, backupFile);
      movedPreviousOutput = true;
    }
    try {
      await rename(stagedFile, outputFile);
    } catch (error) {
      if (movedPreviousOutput) {
        try {
          await rename(backupFile, outputFile);
          movedPreviousOutput = false;
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Tailwind output publication failed and rollback was unsuccessful",
          );
        }
      }
      throw error;
    }

    if (movedPreviousOutput) {
      await secureFs.remove(backupFile);
      movedPreviousOutput = false;
    }
  } finally {
    if (await secureFs.exists(stagedFile)) {
      await secureFs.remove(stagedFile);
    }
    if (movedPreviousOutput && await secureFs.exists(backupFile)) {
      await secureFs.remove(backupFile);
    }
  }
}

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
          browserslist,
          adapter,
        } = this.options;
        if (!isAbsolute(this.options.projectDir)) {
          throw new TypeError("Tailwind projectDir must be an absolute path");
        }
        if (sourceMap) {
          throw new TypeError("Tailwind source maps are not supported by this build pipeline");
        }
        if (browserslist && browserslist.length > 0) {
          throw new TypeError(
            "Tailwind browserslist overrides are not supported by this build pipeline",
          );
        }

        const projectDir = resolve(this.options.projectDir);
        const resolvedInput = projectPath(inputFile, projectDir, "Tailwind input file");
        const resolvedOutput = outputFile
          ? projectPath(outputFile, projectDir, "Tailwind output file")
          : undefined;
        const secureFs = createSecureFs({
          baseDir: projectDir,
          adapter,
          context: "build",
          throwOnError: true,
          validationOptions: {
            followSymlinks: false,
          },
        });

        logger.info("Compiling Tailwind CSS v4", {
          inputFile: resolvedInput,
          outputFile: resolvedOutput,
        });

        const inputCSS = await secureFs.readFile(resolvedInput);
        if (!(await isTailwindV4File(resolvedInput, projectDir, adapter))) {
          throw COMPILATION_ERROR.create({
            detail: `Tailwind input ${JSON.stringify(inputFile)} does not import "tailwindcss"`,
          });
        }

        const sourceFiles = await collectTailwindSourceFiles({
          projectDir,
          patterns: content ?? [],
          adapter,
        });
        const candidates = extractCandidatesFromFiles(sourceFiles);
        const generated = await generateTailwindCSS(inputCSS, candidates, {
          minify: minify ?? true,
          buildMode: minify === false ? "development" : "production",
          projectSlug: projectDir,
        });
        if (generated.error) {
          throw COMPILATION_ERROR.create({
            detail: `Tailwind compilation failed: ${generated.error}`,
          });
        }
        if (candidates.size > 0 && generated.css.trim().length === 0) {
          throw COMPILATION_ERROR.create({
            detail: "Tailwind compilation returned empty CSS for non-empty utility candidates",
          });
        }

        const result: TailwindProcessResult = {
          css: generated.css,
          processedFiles: [
            resolvedInput,
            ...sourceFiles.map((file) => file.path),
          ],
          detectedUtilities: candidates.size,
        };

        if (resolvedOutput) {
          await writeFileAtomically(
            secureFs,
            adapter,
            resolvedOutput,
            generated.css,
          );
        }

        logger.info("Tailwind CSS compiled", {
          inputFile: resolvedInput,
          outputFile: resolvedOutput,
          size: generated.css.length,
          utilities: candidates.size,
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

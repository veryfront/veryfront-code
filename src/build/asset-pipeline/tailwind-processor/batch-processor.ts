import { isAbsolute, join, resolve } from "#veryfront/compat/path/index.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { isContainedBuildPath } from "../../bundler/project-module-resolver.ts";
import { createBuildPublication } from "../../production-build/build/build-publication.ts";
import {
  DEFAULT_TAILWIND_OUTPUT_DIRECTORY,
  DEFAULT_TAILWIND_SOURCE_DIRECTORY,
} from "./constants.ts";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { TailwindProcessor } from "./processor.ts";
import { isTailwindV4File } from "./detector.ts";

function containedProjectPath(
  projectDir: string,
  path: string,
  label: string,
): string {
  const resolvedPath = isAbsolute(path) ? resolve(path) : resolve(projectDir, path);
  if (
    resolvedPath === projectDir ||
    !isContainedBuildPath(projectDir, resolvedPath)
  ) {
    throw new TypeError(`${label} must resolve inside the project directory`);
  }
  return resolvedPath;
}

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
  cssDir: string = DEFAULT_TAILWIND_SOURCE_DIRECTORY,
  outputDir: string = DEFAULT_TAILWIND_OUTPUT_DIRECTORY,
): Promise<TailwindProcessResult[]> {
  return withSpan(
    "build.asset.processTailwindCSSInDirectory",
    async () => {
      const resolvedProjectDir = resolve(projectDir);
      const cssPath = containedProjectPath(
        resolvedProjectDir,
        cssDir,
        "Tailwind source directory",
      );
      const outputPath = containedProjectPath(
        resolvedProjectDir,
        outputDir,
        "Tailwind output directory",
      );
      if (
        isContainedBuildPath(cssPath, outputPath) ||
        isContainedBuildPath(outputPath, cssPath)
      ) {
        throw new TypeError("Tailwind source and output directories must not overlap");
      }

      const fs = createFileSystem();
      const adapter = await runtime.get();
      const entries = [];
      for await (const entry of fs.readDir(cssPath)) {
        entries.push(entry);
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));

      const selected: Array<{ name: string; path: string }> = [];
      const outputKeys = new Set<string>();
      for (const entry of entries) {
        if (entry.isSymlink && entry.name.toLowerCase().endsWith(".css")) {
          throw new TypeError(
            `Tailwind source files must not be symbolic links: ${entry.name}`,
          );
        }
        if (!entry.isFile || !entry.name.toLowerCase().endsWith(".css")) {
          continue;
        }

        const filePath = join(cssPath, entry.name);
        if (!(await isTailwindV4File(filePath, resolvedProjectDir, adapter))) {
          continue;
        }

        const collisionKey = entry.name.normalize("NFC").toLocaleLowerCase("en-US");
        if (outputKeys.has(collisionKey)) {
          throw new TypeError(
            `Tailwind output filename collision: ${JSON.stringify(entry.name)}`,
          );
        }
        outputKeys.add(collisionKey);
        selected.push({ name: entry.name, path: filePath });
      }

      const processed = await Promise.all(
        selected.map(async (entry) => ({
          name: entry.name,
          result: await processTailwindCSS({
            projectDir: resolvedProjectDir,
            adapter,
            inputFile: entry.path,
          }),
        })),
      );

      const publication = await createBuildPublication(outputPath, false);
      try {
        await fs.mkdir(publication.buildDir, { recursive: true });
        for (const entry of processed) {
          await fs.writeTextFile(
            join(publication.buildDir, entry.name),
            entry.result.css,
          );
        }
        await publication.publish();
      } finally {
        await publication.cleanup();
      }

      return processed.map((entry) => entry.result);
    },
    {
      "tailwind.projectDir": projectDir,
      "tailwind.cssDir": cssDir,
      "tailwind.outputDir": outputDir,
    },
  );
}

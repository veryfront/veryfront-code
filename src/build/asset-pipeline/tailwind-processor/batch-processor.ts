import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { TailwindProcessor } from "./processor.ts";
import { isTailwindV4File } from "./detector.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

function resolveWithin(projectDir: string, path: string, label: string): string {
  if (!path.trim()) throw new TypeError(`${label} must not be blank`);
  const target = resolve(projectDir, path);
  const relPath = relative(projectDir, target).replaceAll("\\", "/");
  if (isAbsolute(relPath) || relPath.split("/")[0] === "..") {
    throw new TypeError(`${label} must stay inside projectDir`);
  }
  return target;
}

export function processTailwindCSS(
  options: TailwindProcessorOptions,
): Promise<TailwindProcessResult> {
  return withSpan(
    "build.asset.processTailwindCSS",
    () => new TailwindProcessor(options).process(),
    {},
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
      if (!projectDir.trim()) throw new TypeError("projectDir must not be blank");
      const normalizedProjectDir = resolve(projectDir);
      const cssPath = resolveWithin(normalizedProjectDir, cssDir, "cssDir");
      const normalizedOutputDir = resolveWithin(normalizedProjectDir, outputDir, "outputDir");
      const outputRelativeToCSS = relative(cssPath, normalizedOutputDir).replaceAll("\\", "/");
      if (outputRelativeToCSS === "" || outputRelativeToCSS.split("/")[0] !== "..") {
        throw new TypeError("outputDir must not be equal to or inside cssDir");
      }
      const fs = createFileSystem();
      const adapter = await runtime.get();

      try {
        const cssEntries = [];
        for await (const entry of fs.readDir(cssPath)) {
          if (entry.isFile && entry.name.toLowerCase().endsWith(".css")) {
            cssEntries.push(entry.name);
          }
        }

        for (const name of cssEntries.sort()) {
          const filePath = join(cssPath, name);
          if (!(await isTailwindV4File(filePath, normalizedProjectDir, adapter))) continue;

          logger.info("Found Tailwind v4 file");

          results.push(
            await processTailwindCSS({
              projectDir: normalizedProjectDir,
              adapter,
              inputFile: filePath,
              outputFile: join(normalizedOutputDir, name),
            }),
          );
        }
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }

      return results;
    },
    {},
  );
}

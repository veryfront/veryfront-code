import { dirname, extname, isAbsolute, relative, resolve } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import type { TailwindProcessorOptions, TailwindProcessResult } from "./types.ts";
import { autoDetectContentPaths, hasTailwindV4Import } from "./detector.ts";
import { countUtilities } from "./css-utils.ts";
import { processWithLightningCSS } from "./lightning-processor.ts";
import { createSecureFs } from "#veryfront/security";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { globFiles } from "../../utils/asset-utils.ts";
import {
  extractCandidatesFromFiles,
  generateTailwindCSS,
} from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import {
  MAX_STYLE_SOURCE_FILE_BYTES,
  MAX_STYLE_SOURCE_FILES,
  MAX_STYLE_SOURCE_PATH_BYTES,
  MAX_STYLESHEET_BYTES,
  MAX_TOTAL_STYLE_SOURCE_BYTES,
  utf8ByteLength,
} from "#veryfront/html/styles-builder/resource-limits.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";
import type { BrowserTargets } from "../css-optimizer/types/index.ts";

interface NormalizedTailwindOptions extends TailwindProcessorOptions {
  projectDir: string;
  inputFile: string;
  content: string[];
  minify: boolean;
  sourceMap: boolean;
}

const MAX_CONTENT_PATTERNS = 256;
const MAX_CONTENT_SCAN_DEPTH = 64;
const MAX_CONTENT_SCAN_ENTRIES = MAX_STYLE_SOURCE_FILES * 4;

function isWithin(baseDir: string, target: string): boolean {
  const relPath = relative(baseDir, target).replaceAll("\\", "/");
  return relPath === "" || (!isAbsolute(relPath) && relPath.split("/")[0] !== "..");
}

function resolveWithin(baseDir: string, path: string, label: string): string {
  if (!path.trim()) throw new TypeError(`${label} must not be blank`);
  const target = resolve(baseDir, path);
  if (!isWithin(baseDir, target)) throw new TypeError(`${label} must stay inside projectDir`);
  return target;
}

function normalizeOptions(options: TailwindProcessorOptions): NormalizedTailwindOptions {
  if (!options.projectDir?.trim()) throw new TypeError("projectDir must not be blank");
  const projectDir = resolve(options.projectDir);
  const inputFile = resolveWithin(projectDir, options.inputFile, "inputFile");
  if (extname(inputFile).toLowerCase() !== ".css") {
    throw new TypeError("inputFile must use the .css extension");
  }
  const outputFile = options.outputFile
    ? resolveWithin(projectDir, options.outputFile, "outputFile")
    : undefined;
  if (outputFile === inputFile) throw new TypeError("outputFile must differ from inputFile");
  if (options.minify !== undefined && typeof options.minify !== "boolean") {
    throw new TypeError("minify must be a boolean");
  }
  if (options.sourceMap !== undefined && typeof options.sourceMap !== "boolean") {
    throw new TypeError("sourceMap must be a boolean");
  }
  if (options.sourceMap) {
    throw new TypeError("Tailwind source maps are not supported by this processor");
  }
  const rawContent = options.content ?? autoDetectContentPaths(projectDir);
  if (!Array.isArray(rawContent)) throw new TypeError("content must be an array");
  if (rawContent.length > MAX_CONTENT_PATTERNS) {
    throw new TypeError(`content must contain at most ${MAX_CONTENT_PATTERNS} patterns`);
  }
  const content = rawContent.map((pattern) => {
    if (typeof pattern !== "string" || !pattern.trim()) {
      throw new TypeError("content patterns must not be blank");
    }
    const staticPrefix = pattern.split(/[?*[{]/, 1)[0] || ".";
    resolveWithin(projectDir, staticPrefix, "content pattern");
    return isAbsolute(pattern) ? pattern : resolve(projectDir, pattern);
  });
  const browserslist = Array.isArray(options.browserslist)
    ? [...options.browserslist]
    : options.browserslist
    ? { ...(options.browserslist as BrowserTargets) }
    : undefined;

  return {
    ...options,
    projectDir,
    inputFile,
    outputFile,
    content: [...new Set(content)].sort(),
    minify: options.minify ?? true,
    sourceMap: false,
    browserslist,
  };
}

async function projectScope(projectDir: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectDir));
  return `build-${
    [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    )
  }`;
}

export class TailwindProcessor {
  private options: NormalizedTailwindOptions;
  private processingPromise: Promise<TailwindProcessResult> | null = null;

  constructor(options: TailwindProcessorOptions) {
    this.options = normalizeOptions(options);
  }

  process(): Promise<TailwindProcessResult> {
    if (this.processingPromise) return this.processingPromise;
    const promise = withSpan(
      "build.tailwind.process",
      async (): Promise<TailwindProcessResult> => {
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
          validationOptions: { followSymlinks: false },
        });

        logger.info("Processing Tailwind CSS v4");

        const inputInfo = await secureFs.stat(inputFile);
        if (!inputInfo.isFile || inputInfo.isSymlink) {
          throw new TypeError("Tailwind input must be a regular file");
        }
        if (!Number.isSafeInteger(inputInfo.size) || inputInfo.size < 0) {
          throw new TypeError("Tailwind input has an invalid size");
        }
        if (inputInfo.size > MAX_STYLESHEET_BYTES) {
          throw new TypeError("Tailwind input exceeds the stylesheet size limit");
        }
        const inputCSS = await secureFs.readFile(inputFile);
        if (utf8ByteLength(inputCSS) > MAX_STYLESHEET_BYTES) {
          throw new TypeError("Tailwind input exceeds the stylesheet size limit");
        }
        if (!hasTailwindV4Import(inputCSS)) {
          throw new TypeError('Tailwind CSS input must include @import "tailwindcss"');
        }

        const discoveredSources = new Map<string, number>();
        let discoveredBytes = 0;
        for (const pattern of content) {
          for (
            const path of await globFiles(pattern, {
              maxDepth: MAX_CONTENT_SCAN_DEPTH,
              maxScannedEntries: MAX_CONTENT_SCAN_ENTRIES,
              maxResults: MAX_STYLE_SOURCE_FILES,
            })
          ) {
            const resolvedPath = resolve(path);
            if (!isWithin(projectDir, resolvedPath)) {
              throw new TypeError("Matched content file must stay inside projectDir");
            }
            if (discoveredSources.has(resolvedPath)) continue;
            const projectRelativePath = relative(projectDir, resolvedPath).replaceAll("\\", "/");
            if (utf8ByteLength(projectRelativePath) > MAX_STYLE_SOURCE_PATH_BYTES) {
              throw new TypeError("Style source file path exceeds the size limit");
            }
            if (discoveredSources.size >= MAX_STYLE_SOURCE_FILES) {
              throw new TypeError("Style source file count exceeds the limit");
            }
            const info = await secureFs.stat(resolvedPath);
            if (!info.isFile || info.isSymlink) continue;
            if (!Number.isSafeInteger(info.size) || info.size < 0) {
              throw new TypeError("Style source file has an invalid size");
            }
            if (info.size > MAX_STYLE_SOURCE_FILE_BYTES) {
              throw new TypeError("Style source file exceeds the size limit");
            }
            if (discoveredBytes > MAX_TOTAL_STYLE_SOURCE_BYTES - info.size) {
              throw new TypeError("Style source files exceed the total size limit");
            }
            discoveredBytes += info.size;
            discoveredSources.set(resolvedPath, info.size);
          }
        }

        const sourceFiles = new Map<string, string>();
        let materializedBytes = 0;
        for (
          const [path, discoveredSize] of [...discoveredSources].sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          )
        ) {
          const fileContent = await secureFs.readFile(path);
          const actualSize = utf8ByteLength(fileContent);
          if (actualSize > MAX_STYLE_SOURCE_FILE_BYTES) {
            throw new TypeError("Style source file exceeds the size limit");
          }
          materializedBytes += Math.max(discoveredSize, actualSize);
          if (materializedBytes > MAX_TOTAL_STYLE_SOURCE_BYTES) {
            throw new TypeError("Style source files exceed the total size limit");
          }
          sourceFiles.set(path, fileContent);
        }
        const candidates = extractCandidatesFromFiles(
          [...sourceFiles].map(([path, fileContent]) => ({ path, content: fileContent })),
          { projectDir },
        );
        const generated = await generateTailwindCSS(inputCSS, candidates, {
          minify,
          environment: "production",
          buildMode: "production",
          projectSlug: await projectScope(projectDir),
        });
        if (generated.error) {
          throw COMPILATION_ERROR.create({ detail: generated.error });
        }

        const hasBrowserTargets = Array.isArray(browserslist)
          ? browserslist.length > 0
          : browserslist !== undefined && Object.keys(browserslist).length > 0;
        const processedCSS = hasBrowserTargets
          ? await processWithLightningCSS(generated.css, {
            filename: "tailwind.css",
            minify: false,
            sourceMap,
            browserslist,
          })
          : generated.css;

        const detectedUtilities = countUtilities(processedCSS);
        const toProjectRelativePath = (path: string) =>
          relative(projectDir, path).replaceAll("\\", "/");

        const result: TailwindProcessResult = {
          css: processedCSS,
          processedFiles: [
            toProjectRelativePath(inputFile),
            ...[...sourceFiles.keys()].sort().map(toProjectRelativePath),
          ],
          detectedUtilities,
        };

        if (!outputFile) {
          return result;
        }

        await secureFs.mkdir(dirname(outputFile), { recursive: true });
        await secureFs.writeFile(outputFile, processedCSS);

        logger.info("Tailwind CSS processed successfully", {
          size: processedCSS.length,
          utilities: detectedUtilities,
        });

        return result;
      },
      {
        "build.tailwind.minify": this.options.minify ?? true,
      },
    );
    this.processingPromise = promise;
    return promise.finally(() => {
      this.processingPromise = null;
    });
  }
}

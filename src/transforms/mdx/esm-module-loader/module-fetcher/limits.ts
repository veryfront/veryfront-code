/**
 * Admission limits for recursive MDX module resolution.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/limits
 */

/** Maximum unique modules admitted to one request-scoped dependency graph. */
export const MAX_MDX_MODULE_GRAPH_ENTRIES = 500;

/** Maximum static module dependencies accepted from one transformed file. */
export const MAX_MDX_MODULE_IMPORTS_PER_FILE = 500;

/** Bound independent top-level and JSX work without recursive semaphore deadlocks. */
export const MAX_MDX_MODULE_TRANSFORM_CONCURRENCY = 16;

/** Maximum UTF-8 source bytes accepted for one fetched module. */
export const MAX_MDX_MODULE_CODE_BYTES = 2 * 1024 * 1024;

const utf8Encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

export class ModuleGraphLimitError extends Error {
  constructor(normalizedPath: string) {
    super(
      `MDX module dependency graph exceeds ${MAX_MDX_MODULE_GRAPH_ENTRIES} unique modules while admitting "${normalizedPath}"`,
    );
    this.name = "ModuleGraphLimitError";
  }
}

export class ModuleImportLimitError extends Error {
  constructor(modulePath: string, count: number) {
    super(
      `MDX module "${modulePath}" has too many static dependencies (${count}, max ${MAX_MDX_MODULE_IMPORTS_PER_FILE})`,
    );
    this.name = "ModuleImportLimitError";
  }
}

export class ModuleSourceLimitError extends Error {
  /**
   * `modulePath` reaches error logs and compile-error output, so callers that
   * hold a local filesystem path must pass a redacted identity instead.
   *
   * `sizeBytes` is undefined when a strict bounded reader rejected the source
   * without ever measuring it: refusing to read past the ceiling is the point,
   * so the size is genuinely unknown rather than omitted.
   */
  constructor(modulePath: string, sizeBytes: number | undefined, maxBytes: number) {
    super(
      sizeBytes === undefined
        ? `MDX module "${modulePath}" exceeds the source-size limit (max ${maxBytes} bytes)`
        : `MDX module "${modulePath}" exceeds the source-size limit (${sizeBytes} bytes, max ${maxBytes})`,
    );
    this.name = "ModuleSourceLimitError";
  }
}

export function assertMdxModuleImportCount(modulePath: string, count: number): void {
  if (count > MAX_MDX_MODULE_IMPORTS_PER_FILE) {
    throw new ModuleImportLimitError(modulePath, count);
  }
}

export function assertMdxModuleSourceSize(modulePath: string, sizeBytes: number): void {
  if (sizeBytes > MAX_MDX_MODULE_CODE_BYTES) {
    throw new ModuleSourceLimitError(modulePath, sizeBytes, MAX_MDX_MODULE_CODE_BYTES);
  }
}

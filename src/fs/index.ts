/**
 * Public filesystem, path, and cwd utilities.
 *
 * @module fs
 *
 * @example File operations
 * ```ts
 * import { exists, mkdir, readTextFile, writeTextFile } from "veryfront/fs";
 *
 * const content = await readTextFile("./data/config.json");
 * await writeTextFile("./output/result.json", JSON.stringify(data));
 * await mkdir("./output", { recursive: true });
 * ```
 *
 * @example Path utilities
 * ```ts
 * import { join, resolve, dirname, basename, extname } from "veryfront/fs";
 *
 * const filePath = join("src", "pages", "index.tsx");
 * const dir = dirname(filePath); // "src/pages"
 * ```
 *
 * @example Working directory
 * ```ts
 * import { cwd, resolve } from "veryfront/fs";
 *
 * const configPath = resolve(cwd(), "veryfront.config.ts");
 * ```
 */

export {
  createFileSystem,
  exists,
  type FileSystem,
  mkdir,
  readDir,
  readTextFile,
  realPath,
  remove,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";
export {
  basename,
  dirname,
  extname,
  join,
  resolve,
} from "#veryfront/platform/compat/path/index.ts";

export { cwd } from "#veryfront/platform/compat/process.ts";

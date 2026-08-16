/**
 * Runtime-native filesystem, path, and cwd utilities.
 *
 * @module fs
 *
 * @remarks
 * ## Runtime boundary
 *
 * `veryfront/fs` delegates to the active runtime filesystem. It does not add a
 * project-root sandbox, block `.env` or other secret-file names, or validate
 * paths from untrusted input. Relative paths resolve from `cwd()`. Absolute
 * paths and `..` segments can reach any location that the runtime permits.
 *
 * Runtime permissions remain the outer boundary. Hosted project secrets are
 * supplied through request-owned environment data rather than `.env` files.
 * Isolated Pages route `ctx.fs` is a separate, read-only, project-confined
 * capability. Those protections do not change the contract of `veryfront/fs`.
 *
 * Use `validatePath` from `veryfront/security` with a trusted `baseDir` before
 * reading a user-influenced path. Physical validation follows symlinks when
 * the active filesystem exposes physical path semantics.
 *
 * @example File operations
 * ```ts
 * import { exists, mkdir, readTextFile, writeTextFile } from "veryfront/fs";
 *
 * const data = JSON.parse(await readTextFile("./data/config.json"));
 * await mkdir("./output", { recursive: true });
 * await writeTextFile("./output/result.json", JSON.stringify(data));
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
 *
 * @example Confine an untrusted path
 * ```ts
 * import { cwd, readTextFile, resolve } from "veryfront/fs";
 * import { validatePath } from "veryfront/security";
 *
 * const publicFilesDir = resolve(cwd(), "public-data");
 *
 * export async function readPublicFile(requestedPath: string): Promise<string> {
 *   const admitted = await validatePath(requestedPath, {
 *     baseDir: publicFilesDir,
 *     allowAbsolute: false,
 *     level: "strict",
 *   });
 *   if (!admitted.valid || !admitted.canonicalPath) {
 *     throw new Error("Invalid path");
 *   }
 *   return await readTextFile(admitted.canonicalPath);
 * }
 * ```
 */

export {
  createFileSystem,
  exists,
  type FileSystem,
  isNotFoundError,
  lstat,
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

export {
  FileSnapshotChangedError,
  isFileSnapshotChangedError,
} from "#veryfront/platform/adapters/file-snapshot-error.ts";

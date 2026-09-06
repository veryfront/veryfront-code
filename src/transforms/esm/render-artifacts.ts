import { isBuiltin } from "node:module";
import { basename, dirname, isAbsolute, join, resolve, toFileUrl } from "#veryfront/compat/path";
import { BUILD_FAILED, CACHE_ERROR, VeryfrontError } from "#veryfront/errors";
import { resolve as resolveContract } from "#veryfront/extensions/contracts.ts";
import type { ModuleLexer } from "#veryfront/extensions/bundler/module-lexer.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
  realPath,
} from "#veryfront/platform/compat/fs.ts";
import { assertCanonicalProjectRelativePath } from "#veryfront/utils/project-relative-path.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { isWellFormedString } from "#veryfront/utils/is-well-formed-string.ts";
import { initLexer } from "./lexer.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { isWithinDirectory } from "#veryfront/security/path-validation/normalization.ts";
import { resolveThroughExistingAncestor } from "#veryfront/security/path-validation/canonical.ts";

export interface RenderArtifactInput {
  files: readonly { path: string; source: string }[];
  entrypoints: readonly string[];
}

export interface RenderArtifactLimits {
  /** Files and nested directories, excluding the private publication root. */
  maxEntries: number;
  /** Combined UTF-8 paths and module contents, not a measurement of heap usage. */
  maxBytes: number;
}

type ArtifactFileSystem =
  & Pick<
    FileSystem,
    "makeTempDir" | "mkdir" | "createFileBytesExclusive" | "remove"
  >
  & { realPath(path: string): Promise<string> };

/** Replica-local publication. Distribute the input graph, never these local paths. */
export interface PreparedRenderArtifacts {
  /** Content identity only, never tenant identity or execution authority. */
  readonly id: string;
  readonly directory: string;
  readonly entrypointUrls: readonly string[];
  readonly fileCount: number;
  readonly entryCount: number;
  /** Accounted UTF-8 paths and module contents. */
  readonly byteLength: number;
}

const DIRECTORY_PREFIX = "vf-render-artifacts-";
const VIRTUAL_ROOT = "file:///__veryfront_render_artifacts__/";
const VIRTUAL_PATH = new URL(VIRTUAL_ROOT).pathname;

function requireArtifactPath(value: unknown): string {
  const path = assertCanonicalProjectRelativePath(value, "Render artifact path");
  if (
    !path.endsWith(".mjs") || !isWellFormedString(path) ||
    path.normalize("NFC") !== path || /[:<>"|?*]/.test(path) ||
    path.split("/").some((part) =>
      /[. ]$/.test(part) ||
      /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
    )
  ) {
    throw new TypeError("Render artifact paths must be portable .mjs paths");
  }
  return path;
}

function artifactUrl(path: string): URL {
  return new URL(path.split("/").map(encodeURIComponent).join("/"), VIRTUAL_ROOT);
}

function importedArtifact(specifier: string | undefined, importer: string): string | null {
  if (specifier?.startsWith("node:") && isBuiltin(specifier)) return null;
  if (!specifier || (!specifier.startsWith("./") && !specifier.startsWith("../"))) {
    throw BUILD_FAILED.create({
      detail: "Render artifacts contain an unresolved or external import",
    });
  }
  // Check depth before URL normalization erases traversal. File URLs strip
  // ASCII tabs/newlines, trim trailing C0/space, and recognize backslashes and
  // percent-encoded dots. Query and fragment text do not affect path depth.
  const normalized = specifier.replace(/[\t\n\r]/g, "");
  let end = normalized.length;
  while (end > 0 && normalized.charCodeAt(end - 1) <= 0x20) end--;
  const path = normalized.slice(0, end).split(/[?#]/, 1)[0]!.replaceAll("\\", "/");
  let depth = importer.split("/").length - 1;
  for (const segment of path.split("/")) {
    const dots = segment.replace(/%2e/gi, ".");
    if (dots === ".") continue;
    if (dots === "..") {
      if (depth === 0) {
        throw BUILD_FAILED.create({ detail: "Render artifact import escapes its graph" });
      }
      depth--;
    } else depth++;
  }
  const resolved = new URL(specifier, artifactUrl(importer));
  if (!resolved.pathname.startsWith(VIRTUAL_PATH) || /%2f|%5c/i.test(resolved.pathname)) {
    throw BUILD_FAILED.create({ detail: "Render artifact import escapes its graph" });
  }
  return decodeURIComponent(resolved.pathname.slice(VIRTUAL_PATH.length));
}

/**
 * Publish compiler-produced ESM chunks as one privately owned artifact set.
 *
 * Sources and entrypoints are snapshotted before asynchronous work. Every
 * declared static or literal dynamic import must resolve within the set or to
 * a runtime builtin. This does not bundle source, rewrite imports, or enforce
 * runtime permissions. The compiler and executor still own runtime capability
 * policy, including generated loader code and non-module filesystem access.
 *
 * Keep this owner until release succeeds, including after preparation fails.
 * Release only after its executor has stopped. The directory is outside the
 * disposable transform cache; its files must not participate in cache pruning.
 * Bound concurrent preparation and live generations separately at admission.
 */
export class RenderArtifacts {
  readonly #fs: ArtifactFileSystem;
  readonly #write: NonNullable<FileSystem["createFileBytesExclusive"]>;
  readonly #files = new Map<string, string>();
  readonly #entrypoints: readonly string[];
  readonly #fileCount: number;
  readonly #entryCount: number;
  readonly #byteLength: number;
  readonly #cacheRoot: string;
  #directory?: string;
  #preparing?: Promise<PreparedRenderArtifacts>;
  #releasing?: Promise<void>;
  #releaseRequested = false;

  constructor(
    input: RenderArtifactInput,
    limits: RenderArtifactLimits,
    fs: ArtifactFileSystem = Object.assign(createFileSystem(), { realPath }),
  ) {
    const maxEntries = limits.maxEntries;
    const maxBytes = limits.maxBytes;
    const files = input.files;
    const entrypoints = input.entrypoints;
    const fileCount = files?.length;
    const entrypointCount = entrypoints?.length;
    if (
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1
    ) throw new RangeError("Render artifact budgets must be positive safe integers");
    if (
      !Array.isArray(files) || !Number.isSafeInteger(fileCount) || fileCount < 1 ||
      fileCount > maxEntries
    ) {
      throw new RangeError("Render artifact graph exceeds its entry budget or is empty");
    }
    const write = fs.createFileBytesExclusive;
    if (!write) {
      throw new TypeError("Render artifact storage requires exclusive file creation");
    }
    this.#fs = {
      makeTempDir: fs.makeTempDir.bind(fs),
      mkdir: fs.mkdir.bind(fs),
      remove: fs.remove.bind(fs),
      realPath: fs.realPath.bind(fs),
    };
    this.#write = write.bind(fs);
    this.#cacheRoot = resolve(getCacheBaseDir());
    const paths = new Set<string>();
    let bytes = 0;
    for (let index = 0; index < fileCount; index++) {
      const file = files[index]!;
      const path = requireArtifactPath(file.path);
      const source = file.source;
      const key = path.toLowerCase();
      if (paths.has(key)) {
        throw new TypeError("Render artifact graph contains a path collision");
      }
      paths.add(key);
      bytes += utf8ByteLength(path, maxBytes - bytes);
      if (bytes > maxBytes) throw new RangeError("Render artifact graph exceeds its byte budget");
      bytes += utf8ByteLength(source, maxBytes - bytes);
      if (bytes > maxBytes) {
        throw new RangeError("Render artifact graph exceeds its byte budget");
      }
      if (!isWellFormedString(source)) {
        throw new TypeError("Render artifact source must be lossless UTF-8 text");
      }
      this.#files.set(path, source);
    }
    // The trailing separator keeps a file adjacent to its first descendant
    // after sorting, without retaining every ancestor prefix of deep paths.
    const namespaces = [...paths].map((path) => `${path}/`).sort(compareStrings);
    for (let index = 1; index < namespaces.length; index++) {
      if (namespaces[index]!.startsWith(namespaces[index - 1]!)) {
        throw new TypeError("Render artifact graph contains a path collision");
      }
    }
    // Count original spellings so the budget also covers case-sensitive
    // filesystems where A/ and a/ occupy separate directories.
    const originalNamespaces = [...this.#files.keys()].map((path) => `${path}/`).sort(
      compareStrings,
    );
    let entries = fileCount;
    let previous = "";
    for (const namespace of originalNamespaces) {
      let common = 0;
      while (common < previous.length && namespace[common] === previous[common]) common++;
      for (
        let slash = namespace.indexOf("/", common);
        slash !== -1 && slash < namespace.length - 1;
        slash = namespace.indexOf("/", slash + 1)
      ) {
        if (++entries > maxEntries) {
          throw new RangeError("Render artifact graph exceeds its entry budget");
        }
      }
      previous = namespace;
    }
    if (
      !Array.isArray(entrypoints) || !Number.isSafeInteger(entrypointCount) ||
      entrypointCount < 1 || entrypointCount > this.#files.size
    ) throw new TypeError("Render artifact entrypoints must name distinct files in the graph");
    const selected: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < entrypointCount; index++) {
      const path = entrypoints[index]!;
      if (!this.#files.has(path) || seen.has(path)) {
        throw new TypeError("Render artifact entrypoints must name distinct files in the graph");
      }
      seen.add(path);
      selected.push(path);
    }
    this.#entrypoints = selected;
    this.#fileCount = this.#files.size;
    this.#entryCount = entries;
    this.#byteLength = bytes;
  }

  prepare(): Promise<PreparedRenderArtifacts> {
    if (this.#releaseRequested) return Promise.reject(this.#releasedError());
    return this.#preparing ??= Promise.resolve().then(() => this.#prepare());
  }

  release(): Promise<void> {
    this.#releaseRequested = true;
    return this.#releasing ??= Promise.resolve().then(async () => {
      await this.#preparing?.catch(() => undefined);
      await this.#removeDirectory();
      this.#files.clear();
    }).catch((error) => {
      this.#releasing = undefined;
      throw error;
    });
  }

  #releasedError() {
    return CACHE_ERROR.create({ detail: "Render artifacts have been released" });
  }

  #assertOpen(): void {
    if (this.#releaseRequested) throw this.#releasedError();
  }

  async #prepare(): Promise<PreparedRenderArtifacts> {
    try {
      this.#assertOpen();
      const lexer = resolveContract<ModuleLexer>("ModuleLexer");
      const parse = lexer.parse.bind(lexer);
      await initLexer();
      const files = [...this.#files].sort(([a], [b]) => compareStrings(a, b));
      const manifest: [string, string][] = [];
      for (const [path, source] of files) {
        this.#assertOpen();
        for (const imported of parse(source)) {
          if (imported.d === -2) continue;
          const target = importedArtifact(imported.n, path);
          if (target !== null && !this.#files.has(target)) {
            throw BUILD_FAILED.create({
              detail: "Render artifact graph is missing an imported module",
            });
          }
        }
        manifest.push([path, await computeHash(source)]);
      }
      const id = await computeHash(
        JSON.stringify(["render-artifacts-v1", manifest, this.#entrypoints]),
      );
      this.#assertOpen();
      const directory = await this.#fs.makeTempDir({ prefix: DIRECTORY_PREFIX });
      if (!isAbsolute(directory) || !basename(directory).startsWith(DIRECTORY_PREFIX)) {
        throw BUILD_FAILED.create({
          detail: "Render artifact storage returned an invalid private directory",
        });
      }
      this.#directory = directory;
      const [physicalDirectory, physicalCache] = await Promise.all([
        this.#fs.realPath(directory),
        resolveThroughExistingAncestor(this.#cacheRoot, this.#fs.realPath),
      ]);
      if (!physicalCache || isWithinDirectory(physicalCache, physicalDirectory)) {
        throw CACHE_ERROR.create({
          detail:
            "Render artifact storage must be outside the disposable cache. Use separate temporary and cache directories.",
        });
      }
      const directories = new Set<string>([directory]);
      const encoder = new TextEncoder();
      // Sequential publication bounds open files and ensures cleanup never
      // races writes that outlive a rejected Promise.all operation.
      for (const [path, source] of files) {
        this.#assertOpen();
        const target = join(directory, path);
        const parent = dirname(target);
        if (!directories.has(parent)) {
          await this.#fs.mkdir(parent, { recursive: true });
          directories.add(parent);
        }
        await this.#write(target, encoder.encode(source));
      }
      this.#assertOpen();
      return Object.freeze({
        id,
        directory,
        entrypointUrls: Object.freeze(
          this.#entrypoints.map((path) => toFileUrl(join(directory, path)).href),
        ),
        fileCount: this.#fileCount,
        entryCount: this.#entryCount,
        byteLength: this.#byteLength,
      });
    } catch (error) {
      try {
        await this.#removeDirectory();
      } catch (cleanupError) {
        throw BUILD_FAILED.create({
          detail: "Render artifact publication and cleanup failed",
          cause: new AggregateError([error, cleanupError]),
        });
      }
      throw error instanceof VeryfrontError ? error : BUILD_FAILED.create({
        detail: "Render artifact publication failed",
        cause: error,
      });
    } finally {
      this.#files.clear();
    }
  }

  async #removeDirectory(): Promise<void> {
    if (!this.#directory) return;
    try {
      await this.#fs.remove(this.#directory, { recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    this.#directory = undefined;
  }
}

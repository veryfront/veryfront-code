import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "#veryfront/platform/adapters/base.ts";
import * as path from "#veryfront/compat/path";
import { isWithinDirectory } from "#veryfront/security/path-validation/normalization.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PROVIDER_ENTRIES = 20_000;

export const PROJECT_SOURCE_SNAPSHOT_MAX_FILES = 10_000;
export const PROJECT_SOURCE_SNAPSHOT_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const PROJECT_SOURCE_SNAPSHOT_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const PROJECT_SOURCE_SNAPSHOT_MAX_PATH_LENGTH = 4_096;
export const PROJECT_SOURCE_SNAPSHOT_MAX_TOTAL_PATH_BYTES = 4 * 1024 * 1024;
export const PROJECT_SOURCE_SNAPSHOT_MAX_DEPTH = 64;
export const PROJECT_SOURCE_SNAPSHOT_MAX_DIRECTORY_ENTRIES = 20_000;

export interface ProjectSourceSnapshotFile {
  sourcePath: string;
  content: Uint8Array;
}

export interface ProjectSourceSnapshot {
  algorithm: "sha256";
  digest: string;
  files: ProjectSourceSnapshotFile[];
}

interface SourceFileProvider {
  getAllSourceFiles(): Promise<Array<{ path: string; content?: string | Uint8Array }>>;
}

export interface CollectProjectSourceSnapshotInput {
  projectDir: string;
  fs: FileSystemAdapter;
  /** Virtual project filesystems expose their project at `/`. */
  virtualRoot?: boolean;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function assertSafeEntryName(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > 255 ||
    value === "." || value === ".." || value.includes("/") || value.includes("\\") ||
    hasControlCharacter(value)
  ) {
    throw new TypeError("Project source directory returned an invalid entry name");
  }
}

export function normalizeProjectSourcePath(
  value: unknown,
  projectDir: string,
  virtualRoot = false,
): string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > PROJECT_SOURCE_SNAPSHOT_MAX_PATH_LENGTH || hasControlCharacter(value)
  ) {
    throw new TypeError("Project source path must be a bounded project-relative path");
  }

  const withoutProtocol = value.startsWith("file://") ? value.slice("file://".length) : value;
  let candidate = withoutProtocol.replaceAll("\\", "/");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(candidate)) {
    throw new TypeError("Project source path must be project-relative");
  }

  if (path.isAbsolute(candidate)) {
    if (virtualRoot) {
      candidate = candidate.replace(/^\/+/, "");
    } else {
      const relative = path.relative(path.resolve(projectDir), path.resolve(candidate))
        .replaceAll("\\", "/");
      if (
        relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)
      ) {
        throw new TypeError("Project source path is outside the project root");
      }
      candidate = relative;
    }
  }

  const segments = candidate.split("/");
  if (
    candidate.length === 0 || segments.length > PROJECT_SOURCE_SNAPSHOT_MAX_DEPTH ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError("Project source path must be project-relative");
  }
  return segments.join("/");
}

function getSourceFileProvider(fs: FileSystemAdapter): SourceFileProvider | null {
  const candidate = fs as FileSystemAdapter & {
    getAllSourceFiles?: SourceFileProvider["getAllSourceFiles"];
    getUnderlyingAdapter?: () => unknown;
  };
  if (typeof candidate.getAllSourceFiles === "function") {
    return { getAllSourceFiles: candidate.getAllSourceFiles.bind(candidate) };
  }
  if (typeof candidate.getUnderlyingAdapter !== "function") return null;
  const underlying = candidate.getUnderlyingAdapter() as Partial<SourceFileProvider> | null;
  return underlying && typeof underlying.getAllSourceFiles === "function"
    ? { getAllSourceFiles: underlying.getAllSourceFiles.bind(underlying) }
    : null;
}

function assertFileBytesWithinLimit(bytes: Uint8Array): void {
  if (bytes.byteLength > PROJECT_SOURCE_SNAPSHOT_MAX_FILE_BYTES) {
    throw new RangeError("Project source file exceeds the snapshot byte limit");
  }
}

async function readSourceBytes(
  fs: FileSystemAdapter,
  sourcePath: string,
): Promise<Uint8Array> {
  const info = fs.lstat ? await fs.lstat(sourcePath) : await fs.stat(sourcePath);
  if (info.isSymlink) {
    throw new TypeError("Project source snapshots do not support symbolic links");
  }
  if (!info.isFile || !Number.isSafeInteger(info.size) || info.size < 0) {
    throw new TypeError("Project source snapshot entry is not a regular file");
  }
  if (info.size > PROJECT_SOURCE_SNAPSHOT_MAX_FILE_BYTES) {
    throw new RangeError("Project source file exceeds the snapshot byte limit");
  }

  const bytes = fs.readFileBytes
    ? await fs.readFileBytes(sourcePath)
    : encoder.encode(await fs.readFile(sourcePath));
  assertFileBytesWithinLimit(bytes);
  if (bytes.byteLength !== info.size) {
    throw new TypeError("Project source changed while its snapshot was being created");
  }
  return new Uint8Array(bytes);
}

function resolveProviderReadPath(
  rawPath: string,
  projectDir: string,
  virtualRoot: boolean,
): string {
  const withoutProtocol = rawPath.startsWith("file://") ? rawPath.slice("file://".length) : rawPath;
  if (virtualRoot || path.isAbsolute(withoutProtocol)) return withoutProtocol;
  return path.join(projectDir, withoutProtocol);
}

async function collectFromProvider(
  provider: SourceFileProvider,
  input: CollectProjectSourceSnapshotInput,
): Promise<ProjectSourceSnapshotFile[] | null> {
  const provided = await provider.getAllSourceFiles();
  if (!Array.isArray(provided) || provided.length > MAX_PROVIDER_ENTRIES) {
    throw new RangeError("Project source provider entry count exceeds the snapshot limit");
  }
  if (provided.length === 0) return null;

  const virtualRoot = input.virtualRoot ?? false;
  const normalized = provided.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Project source provider returned an invalid entry");
    }
    return {
      entry,
      sourcePath: normalizeProjectSourcePath(entry.path, input.projectDir, virtualRoot),
    };
  }).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

  const files: ProjectSourceSnapshotFile[] = [];
  let previousPath: string | undefined;
  for (const { entry, sourcePath } of normalized) {
    if (sourcePath === previousPath) {
      throw new TypeError("Project source provider returned duplicate normalized paths");
    }
    previousPath = sourcePath;
    if (files.length >= PROJECT_SOURCE_SNAPSHOT_MAX_FILES) {
      throw new RangeError("Project source file count exceeds the snapshot limit");
    }

    let content: Uint8Array;
    if (typeof entry.content === "string") {
      content = encoder.encode(entry.content);
    } else if (entry.content instanceof Uint8Array) {
      content = new Uint8Array(entry.content);
    } else if (entry.content === undefined) {
      content = await readSourceBytes(
        input.fs,
        resolveProviderReadPath(entry.path, input.projectDir, virtualRoot),
      );
    } else {
      throw new TypeError("Project source provider returned invalid file content");
    }
    assertFileBytesWithinLimit(content);
    files.push({ sourcePath, content });
  }
  return files;
}

async function collectByTraversal(
  input: CollectProjectSourceSnapshotInput,
): Promise<ProjectSourceSnapshotFile[]> {
  const fs = input.fs;
  const virtualRoot = input.virtualRoot ?? false;
  const root = virtualRoot ? "/" : path.resolve(input.projectDir);
  if (!(await fs.exists(root))) {
    throw new TypeError("Project source root does not exist");
  }

  const rootInfo = fs.lstat ? await fs.lstat(root) : await fs.stat(root);
  if (rootInfo.isSymlink) {
    throw new TypeError("Project source snapshots do not support symbolic links");
  }
  if (!rootInfo.isDirectory) throw new TypeError("Project source root is not a directory");

  const canonicalRoot = fs.realPath ? await fs.realPath(root) : null;
  const files: ProjectSourceSnapshotFile[] = [];
  let entriesSeen = 0;

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > PROJECT_SOURCE_SNAPSHOT_MAX_DEPTH) {
      throw new RangeError("Project source directory depth exceeds the snapshot limit");
    }
    const entries: DirEntry[] = [];
    for await (const entry of fs.readDir(directory)) {
      entriesSeen++;
      if (entriesSeen > PROJECT_SOURCE_SNAPSHOT_MAX_DIRECTORY_ENTRIES) {
        throw new RangeError("Project source directory entry count exceeds the snapshot limit");
      }
      assertSafeEntryName(entry.name);
      entries.push(entry);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isSymlink) {
        throw new TypeError("Project source snapshots do not support symbolic links");
      }
      if (entry.isFile === entry.isDirectory) {
        throw new TypeError("Project source directory returned an invalid entry type");
      }
      const physicalPath = path.join(directory, entry.name);
      if (entry.isDirectory) {
        await visit(physicalPath, depth + 1);
        continue;
      }
      if (files.length >= PROJECT_SOURCE_SNAPSHOT_MAX_FILES) {
        throw new RangeError("Project source file count exceeds the snapshot limit");
      }
      if (canonicalRoot !== null && fs.realPath) {
        const canonicalFile = await fs.realPath(physicalPath);
        if (!isWithinDirectory(canonicalRoot, canonicalFile)) {
          throw new TypeError("Project source path resolves outside the project root");
        }
      }
      files.push({
        sourcePath: normalizeProjectSourcePath(physicalPath, root, virtualRoot),
        content: await readSourceBytes(fs, physicalPath),
      });
    }
  }

  await visit(root, 0);
  return files;
}

function assertSnapshotFiles(files: unknown): asserts files is ProjectSourceSnapshotFile[] {
  if (!Array.isArray(files) || files.length > PROJECT_SOURCE_SNAPSHOT_MAX_FILES) {
    throw new RangeError("Project source file count exceeds the snapshot limit");
  }
  let previousPath: string | undefined;
  let totalBytes = 0;
  let totalPathBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new TypeError("Project source snapshot contains an invalid file");
    }
    const sourcePath = normalizeProjectSourcePath(file.sourcePath, "/", true);
    if (sourcePath !== file.sourcePath) {
      throw new TypeError("Project source snapshot paths must be canonical");
    }
    if (previousPath !== undefined && sourcePath <= previousPath) {
      throw new TypeError("Project source snapshot contains a duplicate or unsorted path");
    }
    previousPath = sourcePath;
    if (!(file.content instanceof Uint8Array)) {
      throw new TypeError("Project source snapshot content must be bytes");
    }
    assertFileBytesWithinLimit(file.content);
    totalBytes += file.content.byteLength;
    totalPathBytes += encoder.encode(sourcePath).byteLength;
    if (totalBytes > PROJECT_SOURCE_SNAPSHOT_MAX_TOTAL_BYTES) {
      throw new RangeError("Project source snapshot exceeds the total byte limit");
    }
    if (totalPathBytes > PROJECT_SOURCE_SNAPSHOT_MAX_TOTAL_PATH_BYTES) {
      throw new RangeError("Project source snapshot path data exceeds the byte limit");
    }
  }
}

export function assertValidProjectSourceSnapshot(
  value: ProjectSourceSnapshot,
): asserts value is ProjectSourceSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Project source snapshot is invalid");
  }
  if (value.algorithm !== "sha256" || !SHA256_PATTERN.test(value.digest)) {
    throw new TypeError("Project source snapshot digest is invalid");
  }
  assertSnapshotFiles(value.files);
}

async function computeSnapshotDigest(files: ProjectSourceSnapshotFile[]): Promise<string> {
  assertSnapshotFiles(files);
  const encodedPaths = files.map((file) => encoder.encode(file.sourcePath));
  const framedLength = encodedPaths.reduce(
    (total, pathBytes, index) =>
      total + 8 + pathBytes.byteLength + files[index]!.content.byteLength,
    0,
  );
  const framed = new Uint8Array(framedLength);
  const view = new DataView(framed.buffer);
  let offset = 0;
  for (let index = 0; index < files.length; index++) {
    const pathBytes = encodedPaths[index]!;
    const content = files[index]!.content;
    view.setUint32(offset, pathBytes.byteLength);
    view.setUint32(offset + 4, content.byteLength);
    offset += 8;
    framed.set(pathBytes, offset);
    offset += pathBytes.byteLength;
    framed.set(content, offset);
    offset += content.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", framed));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyProjectSourceSnapshot(snapshot: ProjectSourceSnapshot): Promise<void> {
  assertValidProjectSourceSnapshot(snapshot);
  if (await computeSnapshotDigest(snapshot.files) !== snapshot.digest) {
    throw new TypeError("Project source snapshot digest does not match its contents");
  }
}

export async function collectProjectSourceSnapshot(
  input: CollectProjectSourceSnapshotInput,
): Promise<ProjectSourceSnapshot> {
  if (
    !input || typeof input.projectDir !== "string" || input.projectDir.length === 0 ||
    input.projectDir.length > PROJECT_SOURCE_SNAPSHOT_MAX_PATH_LENGTH ||
    hasControlCharacter(input.projectDir)
  ) {
    throw new TypeError("Project source root is invalid");
  }
  const provider = getSourceFileProvider(input.fs);
  const files = (provider ? await collectFromProvider(provider, input) : null) ??
    await collectByTraversal(input);
  files.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  assertSnapshotFiles(files);
  const snapshot: ProjectSourceSnapshot = {
    algorithm: "sha256",
    digest: await computeSnapshotDigest(files),
    files,
  };
  assertValidProjectSourceSnapshot(snapshot);
  return snapshot;
}

function snapshotPathError(detail: string): never {
  throw new TypeError(`Project snapshot path ${detail}`);
}

/** Create a read-only adapter backed only by one verified source snapshot. */
export function createProjectSnapshotFileSystem(
  snapshot: ProjectSourceSnapshot,
  projectRoot = "/__veryfront_project_snapshot__",
): FileSystemAdapter {
  assertValidProjectSourceSnapshot(snapshot);
  const root = path.resolve(projectRoot);
  const files = new Map(
    snapshot.files.map((file) => [file.sourcePath, new Uint8Array(file.content)]),
  );
  const directories = new Set<string>([""]);
  for (const sourcePath of files.keys()) {
    const segments = sourcePath.split("/");
    for (let index = 1; index < segments.length; index++) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }

  function resolveSnapshotPath(inputPath: string): { absolute: string; relative: string } {
    if (typeof inputPath !== "string" || inputPath.length === 0 || hasControlCharacter(inputPath)) {
      return snapshotPathError("is invalid");
    }
    const absolute = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(root, inputPath);
    if (!isWithinDirectory(root, absolute)) return snapshotPathError("is outside the project root");
    const relative = path.relative(root, absolute).replaceAll("\\", "/");
    if (relative !== "") {
      const normalized = normalizeProjectSourcePath(relative, "/", true);
      if (normalized !== relative) return snapshotPathError("is not canonical");
    }
    return { absolute, relative };
  }

  function requireFile(
    inputPath: string,
  ): { absolute: string; relative: string; bytes: Uint8Array } {
    const resolved = resolveSnapshotPath(inputPath);
    const bytes = files.get(resolved.relative);
    if (!bytes) return snapshotPathError("does not identify a file");
    return { ...resolved, bytes };
  }

  function fileInfo(inputPath: string): FileInfo {
    const { relative } = resolveSnapshotPath(inputPath);
    const bytes = files.get(relative);
    if (bytes) {
      return {
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: bytes.byteLength,
        mtime: null,
      };
    }
    if (directories.has(relative)) {
      return { isFile: false, isDirectory: true, isSymlink: false, size: 0, mtime: null };
    }
    return snapshotPathError("does not exist");
  }

  const readOnly = (): never => {
    throw new TypeError("Project source snapshots are read-only");
  };

  return {
    async readFile(inputPath) {
      const { bytes } = requireFile(inputPath);
      try {
        return decoder.decode(bytes);
      } catch {
        throw new TypeError("Project snapshot file is not valid UTF-8");
      }
    },
    readFileBytes(inputPath) {
      return Promise.resolve(new Uint8Array(requireFile(inputPath).bytes));
    },
    writeFile: () => Promise.reject(new TypeError("Project source snapshots are read-only")),
    exists(inputPath) {
      try {
        const { relative } = resolveSnapshotPath(inputPath);
        return Promise.resolve(files.has(relative) || directories.has(relative));
      } catch {
        return Promise.resolve(false);
      }
    },
    async *readDir(inputPath) {
      const { relative } = resolveSnapshotPath(inputPath);
      if (!directories.has(relative)) snapshotPathError("does not identify a directory");
      const prefix = relative === "" ? "" : `${relative}/`;
      const names = new Map<string, DirEntry>();
      for (const sourcePath of files.keys()) {
        if (!sourcePath.startsWith(prefix)) continue;
        const remainder = sourcePath.slice(prefix.length);
        const separator = remainder.indexOf("/");
        const name = separator === -1 ? remainder : remainder.slice(0, separator);
        if (!name || names.has(name)) continue;
        names.set(name, {
          name,
          isFile: separator === -1,
          isDirectory: separator !== -1,
          isSymlink: false,
        });
      }
      for (
        const entry of [...names.values()].sort((left, right) =>
          left.name.localeCompare(right.name)
        )
      ) {
        yield entry;
      }
    },
    stat(inputPath) {
      return Promise.resolve(fileInfo(inputPath));
    },
    lstat(inputPath) {
      return Promise.resolve(fileInfo(inputPath));
    },
    realPath(inputPath) {
      const { absolute } = resolveSnapshotPath(inputPath);
      fileInfo(inputPath);
      return Promise.resolve(absolute);
    },
    mkdir: () => Promise.reject(new TypeError("Project source snapshots are read-only")),
    remove: () => Promise.reject(new TypeError("Project source snapshots are read-only")),
    makeTempDir: () => Promise.reject(new TypeError("Project source snapshots are read-only")),
    watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
      return readOnly();
    },
  };
}

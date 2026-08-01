/**
 * Workspace Sync for Claude Code
 *
 * Provides bidirectional file synchronization between an explicitly composed
 * project source/persistence boundary and an isolated local filesystem.
 *
 * Flow:
 * 1. Before execution: Materialize admitted project files in an isolated directory
 * 2. During execution: Bash/editor operate on local files
 * 3. After execution: Detect changes for an explicitly composed persistence handler
 */

import { computeHash, logger as baseLogger } from "#veryfront/utils";
import { dirname, join, resolve } from "#veryfront/compat/path";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT, SECURITY_VIOLATION } from "#veryfront/errors";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import { readBoundedFileHandlePrefix } from "#veryfront/platform/adapters/bounded-file-read.ts";

const logger = baseLogger.component("workspace-sync");

/** Maximum file size for workspace sync (10 MB) */
const MAX_WORKSPACE_FILE_SIZE = 10 * 1024 * 1024;

/** Default maximum number of source files considered for one workspace. */
const MAX_WORKSPACE_FILES = 50_000;

/** Default aggregate UTF-8 content budget for one workspace (64 MiB). */
const MAX_WORKSPACE_TOTAL_BYTES = 64 * 1024 * 1024;

/** Default maximum filesystem entries traversed during change detection. */
const MAX_WORKSPACE_ENTRIES = 100_000;

/** Portable upper bounds for one path and one run-directory segment. */
const MAX_WORKSPACE_PATH_BYTES = 4_096;
const MAX_WORKSPACE_PATH_SEGMENT_BYTES = 255;
const MAX_WORKSPACE_RUN_ID_BYTES = 255;
const WINDOWS_RESERVED_PATH_SEGMENT =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const WINDOWS_FORBIDDEN_PATH_CHARACTERS = /[<>:"|?*]/;

function hasWindowsForbiddenPathCharacter(segment: string): boolean {
  if (WINDOWS_FORBIDDEN_PATH_CHARACTERS.test(segment)) return true;
  for (let index = 0; index < segment.length; index++) {
    if (segment.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/**
 * Workspace configuration
 */
export interface WorkspaceConfig {
  /** Explicit absolute base directory for isolated workspaces. */
  baseDir: string;

  /** Run ID for unique workspace isolation */
  runId: string;

  /** Explicit project file source selected by the composing integration. */
  source: WorkspaceFileSource;

  /**
   * File patterns to materialize and detect. Supports exact paths, `*.ext`,
   * `prefix/**`, and `**&#47;suffix` only (default: all).
   */
  include?: string[];

  /**
   * File patterns to omit. Supports exact paths, `*.ext`, `prefix/**`, and
   * `**&#47;suffix` only.
   */
  exclude?: string[];

  /** Maximum file size to sync (bytes, default: 10MB) */
  maxFileSize?: number;

  /** Maximum number of source entries admitted (default: 50,000). */
  maxFiles?: number;

  /** Maximum materialized or traversed filesystem entries (default: 100,000). */
  maxEntries?: number;

  /** Maximum aggregate UTF-8 bytes materialized (default: 64 MiB). */
  maxTotalBytes?: number;

  /** Cancellation propagated to source reads and persistence callbacks. */
  abortSignal?: AbortSignal;

  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Minimal source contract needed to materialize a project workspace.
 * Implementations must bind `listAll` and every `read` in one initialization
 * to the same immutable source snapshot.
 */
export interface WorkspaceFileSource {
  listAll(limits: {
    readonly maxFiles: number;
    readonly abortSignal?: AbortSignal;
  }): Promise<Array<{ path: string }>>;
  /**
   * Return UTF-8 text without reading beyond the caller's current byte budget.
   * Core verifies the returned string again before materializing it.
   */
  read(
    path: string,
    limits: { readonly maxBytes: number; readonly abortSignal?: AbortSignal },
  ): Promise<string>;
}

/**
 * File change tracking
 */
export interface FileChange {
  path: string;
  type: "created" | "modified" | "deleted";
  originalChecksum?: string;
  newChecksum?: string;
}

/** Immutable detected change and cancellation state passed to persistence. */
export interface WorkspacePersistenceContext {
  readonly abortSignal?: AbortSignal;
  /**
   * Detached detected-change snapshot. Persistence integrations should use its
   * checksums as optimistic-concurrency preconditions at the storage boundary.
   */
  readonly change: Readonly<FileChange>;
}

/**
 * Workspace sync result
 */
export interface WorkspaceSyncResult {
  /** Local workspace directory */
  workspaceDir: string;

  /** Number of files downloaded */
  filesDownloaded: number;

  /** Total bytes downloaded */
  bytesDownloaded: number;

  /** Files intentionally omitted by configured include/exclude policy. */
  skippedFiles: string[];

  /**
   * Empty for every successful initialization. Retained for response-shape
   * compatibility; any source or materialization failure rejects and cleans
   * the incomplete workspace instead of returning a partial result.
   */
  downloadErrors: Array<{ path: string; error: string }>;

  /** Duration in ms */
  duration: number;
}

/**
 * Upload result
 */
export interface UploadResult {
  /** Changes successfully persisted through an upload or delete handler. */
  uploaded: FileChange[];

  /**
   * Files that were NOT uploaded because no onUpload handler was provided.
   * Distinct from `uploaded` so callers don't mistake a dry run for a real one.
   */
  skipped: FileChange[];

  /** Files that failed to upload */
  failed: Array<{ path: string; error: string }>;

  /** Duration in ms */
  duration: number;
}

/** Immutable persistence progress captured when cancellation stops a batch. */
export interface WorkspaceUploadPartialResult {
  readonly uploaded: readonly Readonly<FileChange>[];
  readonly skipped: readonly Readonly<FileChange>[];
  readonly failed: readonly Readonly<{ path: string; error: string }>[];
  readonly duration: number;
}

/**
 * Cancellation observed after a persistence batch may already have committed
 * callbacks. The immutable progress and remaining changes make retry decisions
 * explicit instead of disguising committed work as a failed callback.
 */
export class WorkspaceUploadAbortError extends Error {
  override readonly name = "AbortError";
  readonly partialResult: WorkspaceUploadPartialResult;
  readonly remainingChanges: readonly Readonly<FileChange>[];

  constructor(
    partialResult: WorkspaceUploadPartialResult,
    remainingChanges: readonly Readonly<FileChange>[],
    cause?: unknown,
  ) {
    super(
      "Workspace persistence was cancelled after partial settlement",
      cause === undefined ? undefined : { cause },
    );
    this.partialResult = partialResult;
    this.remainingChanges = remainingChanges;
    Object.freeze(this);
  }
}

function snapshotFileChange(change: FileChange): Readonly<FileChange> {
  return Object.freeze({ ...change });
}

function snapshotUploadProgress(
  uploaded: readonly FileChange[],
  skipped: readonly FileChange[],
  failed: readonly { path: string; error: string }[],
  startTime: number,
): WorkspaceUploadPartialResult {
  return Object.freeze({
    uploaded: Object.freeze(uploaded.map(snapshotFileChange)),
    skipped: Object.freeze(skipped.map(snapshotFileChange)),
    failed: Object.freeze(failed.map((entry) => Object.freeze({ ...entry }))),
    duration: Date.now() - startTime,
  });
}

function snapshotRemainingChanges(
  prepared: readonly { change: FileChange; content?: string }[],
  startIndex: number,
): readonly Readonly<FileChange>[] {
  return Object.freeze(
    prepared.slice(startIndex).map(({ change }) => snapshotFileChange(change)),
  );
}

/**
 * Check if a path matches any of the given patterns.
 *
 * This is a deliberately minimal matcher, NOT a full glob implementation. Only
 * these four forms are recognized:
 *
 *   - a leading double-star + slash (e.g. "double-star/foo.ts") matches any
 *     path ending in that suffix
 *   - a trailing slash + double-star (e.g. "src/double-star") matches any path
 *     under that prefix
 *   - `*.ext` matches any path ending in `.ext`
 *   - `exact/path` exact match (with or without a leading slash)
 *
 * Anything else (brace expansion `{a,b}`, single-segment `*`, `?`, character
 * classes, or mid-path `**`) is rejected during construction rather than being
 * accepted with misleading no-op semantics.
 */
function matchesPattern(path: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("**/")) {
      // Match a complete suffix at a path-segment boundary.
      const suffix = pattern.slice(3);
      if (path === `/${suffix}` || path.endsWith(`/${suffix}`)) {
        return true;
      }
    } else if (pattern.endsWith("/**")) {
      // Match a complete directory prefix, not a similarly named sibling.
      const rawPrefix = pattern.slice(0, -3);
      const prefix = rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`;
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        return true;
      }
    } else if (pattern.startsWith("*.")) {
      // Match extension
      if (path.endsWith(pattern.slice(1))) {
        return true;
      }
    } else {
      // Exact match
      if (path === pattern || path === `/${pattern}`) {
        return true;
      }
    }
  }
  return false;
}

function validatePattern(pattern: unknown, label: string): asserts pattern is string {
  if (typeof pattern !== "string" || !pattern || pattern !== pattern.trim()) {
    throw INVALID_ARGUMENT.create({ detail: `${label} must be a non-empty string` });
  }
  if (/^\*\.[^*?{}\[\]/]+$/.test(pattern)) {
    try {
      canonicalProjectPath(`file${pattern.slice(1)}`);
    } catch {
      throw INVALID_ARGUMENT.create({ detail: `${label} uses an unsupported pattern form` });
    }
    return;
  }

  let pathPart: string;
  if (pattern.startsWith("**/")) {
    pathPart = pattern.slice(3);
    if (pathPart.startsWith("/")) {
      throw INVALID_ARGUMENT.create({ detail: `${label} uses an unsupported pattern form` });
    }
  } else if (pattern.endsWith("/**")) {
    pathPart = pattern.slice(0, -3);
  } else if (!/[*?{}\[\]]/.test(pattern)) {
    pathPart = pattern;
  } else {
    throw INVALID_ARGUMENT.create({ detail: `${label} uses an unsupported pattern form` });
  }

  try {
    if (/[*?{}\[\]]/.test(pathPart)) throw new TypeError("wildcard in path component");
    canonicalProjectPath(pathPart);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: `${label} uses an unsupported pattern form` });
  }
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw INVALID_ARGUMENT.create({ detail: `Workspace ${label} must be a positive safe integer` });
  }
  return value as number;
}

function isNativeAbsoluteWorkspacePath(path: string): boolean {
  if (Deno.build.os === "windows") {
    return /^[A-Za-z]:\//.test(path) || /^\/\/[^/]+\/[^/]+(?:\/|$)/.test(path);
  }
  return path.startsWith("/") && !path.startsWith("//");
}

/**
 * Convert the two historically accepted source spellings (`path` and `/path`)
 * into one project-rooted form. Any spelling that requires filesystem
 * normalization is rejected instead of being silently retargeted.
 */
function canonicalProjectPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw SECURITY_VIOLATION.create({ detail: "Expected a non-empty canonical project path" });
  }
  if (utf8ByteLength(value, MAX_WORKSPACE_PATH_BYTES) > MAX_WORKSPACE_PATH_BYTES) {
    throw SECURITY_VIOLATION.create({ detail: "Canonical project path exceeds the byte limit" });
  }
  if (value.includes("\0")) {
    throw SECURITY_VIOLATION.create({ detail: "NUL byte in canonical project path" });
  }
  if (value.includes("\\")) {
    throw SECURITY_VIOLATION.create({
      detail: "Backslashes are not allowed in a canonical project path",
    });
  }
  if (value.normalize("NFC") !== value) {
    throw SECURITY_VIOLATION.create({
      detail: "Project paths must use portable NFC Unicode normalization",
    });
  }
  if (value.startsWith("//") || /^[A-Za-z]:\//.test(value)) {
    throw SECURITY_VIOLATION.create({
      detail: "System-absolute paths are not canonical project paths",
    });
  }

  const relativePath = value.startsWith("/") ? value.slice(1) : value;
  const segments = relativePath.split("/");
  if (
    relativePath.length === 0 ||
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      utf8ByteLength(segment, MAX_WORKSPACE_PATH_SEGMENT_BYTES) >
        MAX_WORKSPACE_PATH_SEGMENT_BYTES ||
      segment.endsWith(".") || segment.endsWith(" ") ||
      hasWindowsForbiddenPathCharacter(segment) ||
      WINDOWS_RESERVED_PATH_SEGMENT.test(segment)
    )
  ) {
    throw SECURITY_VIOLATION.create({
      detail:
        "Path aliases, traversal, and non-portable components are not allowed in a canonical project path",
    });
  }
  return `/${segments.join("/")}`;
}

function portableProjectPathKey(path: string): string {
  return path.normalize("NFC").toUpperCase();
}

function registerPortablePath(
  paths: Map<string, string>,
  path: string,
  createError: (path: string, collision: string) => Error,
): void {
  const key = portableProjectPathKey(path);
  const collision = paths.get(key);
  if (collision !== undefined && collision !== path) {
    throw createError(path, collision);
  }
  paths.set(key, path);
}

interface AdmittedSourceFile {
  readonly path: string;
}

interface WorkspaceIdentity {
  readonly realPath: string;
  readonly device: number | null;
  readonly inode: number | null;
}

interface WorkspaceWalkBudget {
  entries: number;
  files: number;
  bytes: number;
  portablePaths: Map<string, string>;
  observedFiles: Set<string>;
}

function hasSameNativeIdentity(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  return !(
    left.dev !== null && right.dev !== null && left.dev !== right.dev ||
    left.ino !== null && right.ino !== null && left.ino !== right.ino
  );
}

function hasSameStableMetadata(left: Deno.FileInfo, right: Deno.FileInfo): boolean {
  const leftModified = left.mtime?.getTime();
  const rightModified = right.mtime?.getTime();
  return hasSameNativeIdentity(left, right) &&
    left.size === right.size &&
    (leftModified === undefined || rightModified === undefined || leftModified === rightModified);
}

function assertOrdinaryWorkspaceFile(info: Deno.FileInfo, path: string): void {
  if (info.isSymlink || !info.isFile) {
    throw SECURITY_VIOLATION.create({
      detail: `Workspace path is not a regular file: ${path}`,
    });
  }
  if (info.nlink !== null && info.nlink > 1) {
    throw SECURITY_VIOLATION.create({
      detail: `Workspace file has multiple hard links: ${path}`,
    });
  }
}

function admitSourceFiles(
  files: Array<{ path: string }>,
  maxFiles: number,
): AdmittedSourceFile[] {
  if (files.length > maxFiles) {
    throw INITIALIZATION_ERROR.create({
      detail: `Workspace source exceeds the configured limit of ${maxFiles} files`,
    });
  }

  const seenPaths = new Set<string>();
  const admitted: AdmittedSourceFile[] = [];
  for (const file of files) {
    let path: string;
    try {
      path = canonicalProjectPath(file?.path);
    } catch {
      throw INITIALIZATION_ERROR.create({
        detail: "Workspace source path admission failed: invalid canonical project path",
      });
    }
    if (seenPaths.has(path)) {
      throw INITIALIZATION_ERROR.create({
        detail:
          `Workspace source path admission failed: Duplicate canonical project file path: ${path}`,
      });
    }
    seenPaths.add(path);
    admitted.push({ path });
  }

  // Source ordering is not a policy input. Stable code-unit ordering makes
  // read order, budget settlement, and diagnostics independent of API order.
  admitted.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return admitted;
}

function selectSourceFiles(
  admittedFiles: readonly AdmittedSourceFile[],
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
  maxEntries: number,
): { selected: AdmittedSourceFile[]; skipped: string[] } {
  const selected: AdmittedSourceFile[] = [];
  const skipped: string[] = [];

  for (const file of admittedFiles) {
    if (
      include && !matchesPattern(file.path, include) ||
      exclude && matchesPattern(file.path, exclude)
    ) {
      skipped.push(file.path);
      continue;
    }

    selected.push(file);
  }

  const selectedPaths = new Set(selected.map((file) => file.path));
  const materializedEntries = new Set<string>();
  const portableEntries = new Map<string, string>();
  for (const file of selected) {
    const segments = file.path.slice(1).split("/");
    for (let index = 1; index <= segments.length; index++) {
      const entryPath = `/${segments.slice(0, index).join("/")}`;
      if (index < segments.length && selectedPaths.has(entryPath)) {
        throw INITIALIZATION_ERROR.create({
          detail: `Workspace source file is also a parent of another selected file: ${entryPath}`,
        });
      }
      registerPortablePath(
        portableEntries,
        entryPath,
        (path, collision) =>
          INITIALIZATION_ERROR.create({
            detail: `Workspace source contains a portable path collision: ${collision} and ${path}`,
          }),
      );
      materializedEntries.add(entryPath);
      if (materializedEntries.size > maxEntries) {
        throw INITIALIZATION_ERROR.create({
          detail: `Workspace source exceeds the configured limit of ${maxEntries} entries`,
        });
      }
    }
  }

  return { selected, skipped };
}

function admitWorkspaceChanges(value: unknown, maxFiles: number): FileChange[] {
  if (!Array.isArray(value)) {
    throw INVALID_ARGUMENT.create({ detail: "Workspace changes must be an array" });
  }
  if (value.length > maxFiles) {
    throw INVALID_ARGUMENT.create({
      detail: `Workspace changes exceed the configured limit of ${maxFiles} files`,
    });
  }

  const admitted: FileChange[] = [];
  const seenPaths = new Set<string>();
  const portablePaths = new Map<string, string>();
  for (const rawChange of value) {
    if (rawChange === null || typeof rawChange !== "object" || Array.isArray(rawChange)) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace change must be an object" });
    }
    const change = rawChange as Record<string, unknown>;
    const path = canonicalProjectPath(change.path);
    if (seenPaths.has(path)) {
      throw INVALID_ARGUMENT.create({
        detail: `Duplicate canonical workspace change path: ${path}`,
      });
    }
    registerPortablePath(
      portablePaths,
      path,
      (candidate, collision) =>
        INVALID_ARGUMENT.create({
          detail:
            `Workspace changes contain a portable path collision: ${collision} and ${candidate}`,
        }),
    );
    if (
      change.type !== "created" && change.type !== "modified" &&
      change.type !== "deleted"
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Workspace change type must be created, modified, or deleted",
      });
    }
    const normalized: FileChange = { path, type: change.type };
    for (const field of ["originalChecksum", "newChecksum"] as const) {
      const checksum = change[field];
      if (checksum !== undefined) {
        if (typeof checksum !== "string" || checksum.length === 0) {
          throw INVALID_ARGUMENT.create({
            detail: `Workspace change ${field} must be a non-empty string`,
          });
        }
        normalized[field] = checksum;
      }
    }
    seenPaths.add(path);
    admitted.push(normalized);
  }
  return admitted;
}

function maximumDetectedChanges(maxFiles: number): number {
  // One detection can contain every tracked source file as deleted and a
  // disjoint maxFiles set of current files as created. Saturate defensively for
  // user-supplied safe integers near Number.MAX_SAFE_INTEGER.
  return maxFiles <= Math.floor(Number.MAX_SAFE_INTEGER / 2)
    ? maxFiles * 2
    : Number.MAX_SAFE_INTEGER;
}

function assertChangesMatchPolicy(
  changes: readonly FileChange[],
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
): void {
  for (const change of changes) {
    if (
      include && !matchesPattern(change.path, include) ||
      exclude && matchesPattern(change.path, exclude)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: `Workspace change is outside the configured file policy: ${change.path}`,
      });
    }
  }
}

/**
 * Workspace manager for Claude Code execution
 */
export class WorkspaceSync {
  private config:
    & Required<
      Omit<WorkspaceConfig, "include" | "exclude" | "abortSignal">
    >
    & {
      include?: string[];
      exclude?: string[];
      abortSignal?: AbortSignal;
    };
  private fileChecksums = new Map<string, string>();
  private initialized = false;
  private workspaceClaimed = false;
  private workspaceIdentity?: WorkspaceIdentity;

  constructor(config: WorkspaceConfig) {
    if (config === null || typeof config !== "object" || Array.isArray(config)) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace config must be an object" });
    }
    // SECURITY: Validate runId to prevent path traversal
    if (
      typeof config.runId !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(config.runId) ||
      WINDOWS_RESERVED_PATH_SEGMENT.test(config.runId) ||
      utf8ByteLength(config.runId, MAX_WORKSPACE_RUN_ID_BYTES) > MAX_WORKSPACE_RUN_ID_BYTES
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Invalid runId: use a non-reserved portable segment of at most 255 bytes",
      });
    }
    if (
      typeof config.baseDir !== "string" || !config.baseDir ||
      config.baseDir !== config.baseDir.trim() || config.baseDir.includes("\0") ||
      utf8ByteLength(config.baseDir, MAX_WORKSPACE_PATH_BYTES) > MAX_WORKSPACE_PATH_BYTES ||
      !isNativeAbsoluteWorkspacePath(config.baseDir) ||
      resolve(config.baseDir) !== config.baseDir
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Workspace baseDir must be an explicit canonical absolute path",
      });
    }
    if (
      !config.source || typeof config.source.listAll !== "function" ||
      typeof config.source.read !== "function"
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace source is invalid" });
    }
    if (config.abortSignal !== undefined && !(config.abortSignal instanceof AbortSignal)) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace abortSignal must be an AbortSignal" });
    }
    const maxFileSize = requirePositiveSafeInteger(
      config.maxFileSize ?? MAX_WORKSPACE_FILE_SIZE,
      "maxFileSize",
    );
    const maxFiles = requirePositiveSafeInteger(
      config.maxFiles ?? MAX_WORKSPACE_FILES,
      "maxFiles",
    );
    const maxEntries = requirePositiveSafeInteger(
      config.maxEntries ?? MAX_WORKSPACE_ENTRIES,
      "maxEntries",
    );
    const maxTotalBytes = requirePositiveSafeInteger(
      config.maxTotalBytes ?? MAX_WORKSPACE_TOTAL_BYTES,
      "maxTotalBytes",
    );
    for (const field of ["include", "exclude"] as const) {
      const patterns = config[field];
      if (patterns !== undefined && !Array.isArray(patterns)) {
        throw INVALID_ARGUMENT.create({ detail: `Workspace ${field} must be an array` });
      }
      patterns?.forEach((pattern, index) => validatePattern(pattern, `${field}[${index}]`));
    }
    if (config.debug !== undefined && typeof config.debug !== "boolean") {
      throw INVALID_ARGUMENT.create({ detail: "Workspace debug must be a boolean" });
    }

    this.config = {
      ...config,
      maxFileSize,
      maxFiles,
      maxEntries,
      maxTotalBytes,
      debug: config.debug ?? false,
      include: config.include ? [...config.include] : undefined,
      exclude: config.exclude ? [...config.exclude] : undefined,
    };
  }

  /**
   * Get the workspace directory path
   */
  get workspaceDir(): string {
    return join(this.config.baseDir, this.config.runId);
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw INITIALIZATION_ERROR.create({
        detail: "Workspace not initialized. Call initialize() first.",
      });
    }
  }

  private throwIfAborted(): void {
    this.config.abortSignal?.throwIfAborted();
  }

  private async failInitialization(error: unknown, aggregateMessage: string): Promise<never> {
    try {
      await this.cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], aggregateMessage);
    }
    throw error;
  }

  private async captureWorkspaceIdentity(): Promise<void> {
    const info = await Deno.lstat(this.workspaceDir);
    if (info.isSymlink || !info.isDirectory) {
      throw SECURITY_VIOLATION.create({
        detail: "Claimed workspace must be a non-symlink directory",
      });
    }
    const workspaceRealPath = await Deno.realPath(this.workspaceDir);
    // Record enough ownership state as soon as the new directory is resolved.
    // If the later base-containment check fails, failInitialization can still
    // verify and remove the directory instead of leaking an untracked claim.
    this.workspaceIdentity = {
      realPath: workspaceRealPath,
      device: info.dev,
      inode: info.ino,
    };
    const baseRealPath = await Deno.realPath(this.config.baseDir);
    if (dirname(workspaceRealPath) !== baseRealPath) {
      throw SECURITY_VIOLATION.create({
        detail: "Claimed workspace resolved outside its admitted base directory",
      });
    }
  }

  private async assertWorkspaceIdentity(): Promise<void> {
    const info = await Deno.lstat(this.workspaceDir);
    if (info.isSymlink || !info.isDirectory) {
      throw SECURITY_VIOLATION.create({ detail: "Claimed workspace identity changed" });
    }

    const expected = this.workspaceIdentity;
    if (!expected) return;
    const currentRealPath = await Deno.realPath(this.workspaceDir);
    const identityChanged = currentRealPath !== expected.realPath ||
      (expected.device !== null && info.dev !== null && info.dev !== expected.device) ||
      (expected.inode !== null && info.ino !== null && info.ino !== expected.inode);
    if (identityChanged) {
      throw SECURITY_VIOLATION.create({ detail: "Claimed workspace identity changed" });
    }
  }

  private async ensureParentDirectories(path: string): Promise<void> {
    const segments = canonicalProjectPath(path).slice(1).split("/").slice(0, -1);
    let current = resolve(this.workspaceDir);
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      const projectParent = `/${segments.slice(0, index + 1).join("/")}`;
      await this.assertWorkspaceIdentity();
      current = join(current, segment);
      let info: Deno.FileInfo;
      try {
        info = await Deno.lstat(current);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        try {
          await Deno.mkdir(current, { mode: 0o700 });
        } catch (mkdirError) {
          // A concurrent creator is acceptable only after lstat proves it made
          // an ordinary directory rather than a link or another file type.
          if (!(mkdirError instanceof Deno.errors.AlreadyExists)) throw mkdirError;
        }
        info = await Deno.lstat(current);
      }
      if (info.isSymlink || !info.isDirectory) {
        throw SECURITY_VIOLATION.create({
          detail: `Workspace parent is not a non-symlink directory: ${projectParent}`,
        });
      }

      const [workspaceRealPath, currentRealPath] = await Promise.all([
        this.workspaceIdentity?.realPath ?? Deno.realPath(this.workspaceDir),
        Deno.realPath(current),
      ]);
      if (!isWithinDirectory(workspaceRealPath, currentRealPath)) {
        throw SECURITY_VIOLATION.create({
          detail: `Workspace parent resolved outside the claimed workspace: ${projectParent}`,
        });
      }
    }
    await this.assertWorkspaceIdentity();
  }

  private async readWorkspaceText(
    path: string,
    maxBytes: number,
    limitDetail: string,
  ): Promise<{ content: string; bytes: number }> {
    const canonicalPath = canonicalProjectPath(path);
    const localPath = await this.resolveSafePath(canonicalPath);
    const pathInfo = await Deno.lstat(localPath);
    assertOrdinaryWorkspaceFile(pathInfo, canonicalPath);
    if (pathInfo.size > maxBytes) {
      throw SECURITY_VIOLATION.create({ detail: limitDetail });
    }

    const probeBytes = maxBytes < Number.MAX_SAFE_INTEGER ? maxBytes + 1 : maxBytes;
    const handle = await Deno.open(localPath, { read: true });
    let encoded: Uint8Array;
    let openedInfo: Deno.FileInfo;
    try {
      openedInfo = await handle.stat();
      assertOrdinaryWorkspaceFile(openedInfo, canonicalPath);
      if (!hasSameStableMetadata(pathInfo, openedInfo)) {
        throw SECURITY_VIOLATION.create({
          detail: `Workspace file changed before it could be read: ${canonicalPath}`,
        });
      }
      encoded = await readBoundedFileHandlePrefix(handle, Math.max(1, probeBytes));
      const afterReadInfo = await handle.stat();
      assertOrdinaryWorkspaceFile(afterReadInfo, canonicalPath);
      if (!hasSameStableMetadata(openedInfo, afterReadInfo)) {
        throw SECURITY_VIOLATION.create({
          detail: `Workspace file changed while it was being read: ${canonicalPath}`,
        });
      }
      openedInfo = afterReadInfo;
    } finally {
      handle.close();
    }
    if (encoded.byteLength > maxBytes) {
      throw SECURITY_VIOLATION.create({ detail: limitDetail });
    }

    // Bind the bytes read through the handle back to the admitted pathname.
    const recheckedPath = await this.resolveSafePath(canonicalPath);
    const finalPathInfo = await Deno.lstat(recheckedPath);
    assertOrdinaryWorkspaceFile(finalPathInfo, canonicalPath);
    if (!hasSameStableMetadata(openedInfo, finalPathInfo)) {
      throw SECURITY_VIOLATION.create({
        detail: `Workspace file changed while its pathname was being verified: ${canonicalPath}`,
      });
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(encoded);
    } catch {
      throw SECURITY_VIOLATION.create({
        detail: `Workspace file must contain valid UTF-8 text: ${canonicalPath}`,
      });
    }
    return { content, bytes: encoded.byteLength };
  }

  private async removeOwnedTemporaryFile(
    path: string,
    expected: Deno.FileInfo,
  ): Promise<void> {
    try {
      const current = await Deno.lstat(path);
      if (!current.isFile || current.isSymlink || !hasSameNativeIdentity(expected, current)) {
        throw SECURITY_VIOLATION.create({
          detail: "Workspace temporary file identity changed during cleanup",
        });
      }
      await Deno.remove(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  private async replaceWorkspaceText(path: string, content: string): Promise<void> {
    const canonicalPath = canonicalProjectPath(path);
    await this.resolveSafePath(canonicalPath);
    await this.ensureParentDirectories(canonicalPath);
    const targetPath = await this.resolveSafePath(canonicalPath);
    const parentPath = dirname(targetPath);
    const admittedParent = await Deno.realPath(parentPath);
    const workspaceRoot = this.workspaceIdentity?.realPath ??
      await Deno.realPath(this.workspaceDir);
    if (!isWithinDirectory(workspaceRoot, admittedParent)) {
      throw SECURITY_VIOLATION.create({
        detail: `Workspace parent resolved outside the claimed workspace: ${canonicalPath}`,
      });
    }

    try {
      const targetInfo = await Deno.lstat(targetPath);
      assertOrdinaryWorkspaceFile(targetInfo, canonicalPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }

    const temporaryPath = join(
      parentPath,
      `.veryfront-write-${crypto.randomUUID()}.tmp`,
    );
    const encoded = new TextEncoder().encode(content);
    let temporaryInfo: Deno.FileInfo | undefined;
    let temporaryPresent = false;
    let operationFailed = false;
    let operationError: unknown;

    try {
      const handle = await Deno.open(temporaryPath, {
        createNew: true,
        mode: 0o600,
        write: true,
      });
      temporaryPresent = true;
      try {
        temporaryInfo = await handle.stat();
        assertOrdinaryWorkspaceFile(temporaryInfo, canonicalPath);
        let offset = 0;
        while (offset < encoded.byteLength) {
          const written = await handle.write(encoded.subarray(offset));
          if (!Number.isSafeInteger(written) || written <= 0) {
            throw new TypeError("Workspace file write returned an invalid byte count");
          }
          offset += written;
        }
        await handle.sync();
        const persistedInfo = await handle.stat();
        if (!hasSameNativeIdentity(temporaryInfo, persistedInfo)) {
          throw SECURITY_VIOLATION.create({
            detail: "Workspace temporary file identity changed while writing",
          });
        }
        temporaryInfo = persistedInfo;
      } finally {
        handle.close();
      }

      await this.assertWorkspaceIdentity();
      const currentParent = await Deno.realPath(parentPath);
      if (currentParent !== admittedParent) {
        throw SECURITY_VIOLATION.create({
          detail: `Workspace parent identity changed while writing: ${canonicalPath}`,
        });
      }
      await this.resolveSafePath(canonicalPath);
      const namedTemporaryInfo = await Deno.lstat(temporaryPath);
      if (
        !temporaryInfo || !namedTemporaryInfo.isFile || namedTemporaryInfo.isSymlink ||
        !hasSameNativeIdentity(temporaryInfo, namedTemporaryInfo)
      ) {
        throw SECURITY_VIOLATION.create({
          detail: "Workspace temporary file identity changed before publication",
        });
      }

      // Rename publishes the completed file without following a final-component
      // symlink that appears after the last pathname check.
      await Deno.rename(temporaryPath, targetPath);
      temporaryPresent = false;
      const publishedInfo = await Deno.lstat(targetPath);
      assertOrdinaryWorkspaceFile(publishedInfo, canonicalPath);
      if (!hasSameNativeIdentity(namedTemporaryInfo, publishedInfo)) {
        throw SECURITY_VIOLATION.create({
          detail: `Workspace file identity changed during publication: ${canonicalPath}`,
        });
      }
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    let cleanupFailed = false;
    let cleanupError: unknown;
    if (temporaryPresent && temporaryInfo) {
      try {
        await this.removeOwnedTemporaryFile(temporaryPath, temporaryInfo);
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error;
      }
    }
    if (operationFailed && cleanupFailed) {
      throw new AggregateError(
        [operationError, cleanupError],
        "Workspace write and temporary-file cleanup failed",
      );
    }
    if (operationFailed) throw operationError;
    if (cleanupFailed) throw cleanupError;
  }

  private async assertWorkspacePathAbsent(path: string): Promise<void> {
    const canonicalPath = canonicalProjectPath(path);
    const localPath = await this.resolveSafePath(canonicalPath);
    try {
      await Deno.lstat(localPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await this.assertWorkspaceIdentity();
      return;
    }
    throw SECURITY_VIOLATION.create({
      detail: `Workspace deletion changed after change detection: ${canonicalPath}`,
    });
  }

  /**
   * Initialize workspace by downloading project files
   */
  async initialize(): Promise<WorkspaceSyncResult> {
    const startTime = Date.now();
    const skippedFiles: string[] = [];
    const downloadErrors: Array<{ path: string; error: string }> = [];
    let filesDownloaded = 0;
    let bytesDownloaded = 0;

    if (this.config.debug) {
      logger.info("Initializing workspace", { runId: this.config.runId });
    }
    this.throwIfAborted();
    if (this.workspaceClaimed || this.initialized) {
      throw INITIALIZATION_ERROR.create({ detail: "Workspace is already initialized" });
    }

    // Create the parent, then claim this run directory exclusively. Reusing a
    // stale or active workspace could expose unrelated files to the agent.
    await Deno.mkdir(this.config.baseDir, { recursive: true, mode: 0o700 });
    const baseInfo = await Deno.lstat(this.config.baseDir);
    if (baseInfo.isSymlink) {
      throw SECURITY_VIOLATION.create({
        detail: "Workspace initialization refuses a symlinked baseDir",
      });
    }
    if (!baseInfo.isDirectory) {
      throw INITIALIZATION_ERROR.create({ detail: "Workspace baseDir is not a directory" });
    }
    await Deno.mkdir(this.workspaceDir, { mode: 0o700 });
    this.workspaceClaimed = true;
    try {
      await this.captureWorkspaceIdentity();
      this.throwIfAborted();
    } catch (error) {
      return await this.failInitialization(
        error,
        "Workspace claim and cleanup failed",
      );
    }

    // List all files from project
    let files: Array<{ path: string }>;
    try {
      files = await this.config.source.listAll({
        maxFiles: this.config.maxFiles,
        abortSignal: this.config.abortSignal,
      });
      this.throwIfAborted();
      if (!Array.isArray(files)) throw new TypeError("Workspace source returned an invalid list");
    } catch (error) {
      if (this.config.abortSignal?.aborted) {
        return await this.failInitialization(
          this.config.abortSignal.reason ?? error,
          "Workspace source listing cancellation and cleanup failed",
        );
      }
      logger.error("Failed to list workspace source files", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      const initializationError = INITIALIZATION_ERROR.create({
        detail: "Workspace source file listing failed",
      });
      return await this.failInitialization(
        initializationError,
        "Workspace source listing and cleanup failed",
      );
    }

    let admittedFiles: AdmittedSourceFile[];
    let selectedFiles: AdmittedSourceFile[];
    try {
      admittedFiles = admitSourceFiles(files, this.config.maxFiles);
      const selection = selectSourceFiles(
        admittedFiles,
        this.config.include,
        this.config.exclude,
        this.config.maxEntries,
      );
      selectedFiles = selection.selected;
      skippedFiles.push(...selection.skipped);
    } catch (error) {
      return await this.failInitialization(
        error,
        "Workspace source admission and cleanup failed",
      );
    }
    try {
      await this.assertWorkspaceIdentity();
    } catch (error) {
      return await this.failInitialization(
        error,
        "Workspace source listing changed the claimed workspace",
      );
    }

    if (this.config.debug) {
      logger.info("Found files in project", {
        admitted: admittedFiles.length,
        selected: selectedFiles.length,
      });
    }

    // Download each file
    for (const { path } of selectedFiles) {
      try {
        this.throwIfAborted();
        await this.assertWorkspaceIdentity();
      } catch (error) {
        return await this.failInitialization(
          error,
          "Workspace identity check and cleanup failed",
        );
      }

      // Check file size (if available in metadata)
      // Note: We might not have size info until we fetch the file

      let content: string;
      try {
        const currentReadLimit = Math.min(
          this.config.maxFileSize,
          this.config.maxTotalBytes - bytesDownloaded,
        );
        content = await this.config.source.read(path, {
          maxBytes: currentReadLimit,
          abortSignal: this.config.abortSignal,
        });
        this.throwIfAborted();
        if (typeof content !== "string") {
          throw new TypeError("Workspace source returned non-text content");
        }
      } catch (error) {
        if (this.config.abortSignal?.aborted) {
          return await this.failInitialization(
            this.config.abortSignal.reason ?? error,
            "Workspace download cancellation and cleanup failed",
          );
        }
        const errorName = error instanceof Error ? error.name : typeof error;
        logger.error("Failed to download workspace file", { path, errorName });
        downloadErrors.push({ path, error: "Project file download failed" });
        return await this.failInitialization(
          INITIALIZATION_ERROR.create({
            detail: "Workspace initialization failed for 1 file(s)",
          }),
          "Workspace download and cleanup failed",
        );
      }

      const remainingTotalBytes = this.config.maxTotalBytes - bytesDownloaded;
      const contentSize = utf8ByteLength(
        content,
        Math.min(this.config.maxFileSize, remainingTotalBytes),
      );

      // Verify the source honored the bounded-read contract. Oversized files
      // fail the snapshot; silently omitting one would expose a partial project.
      if (contentSize > this.config.maxFileSize) {
        const fileBudgetError = INITIALIZATION_ERROR.create({
          detail:
            `Workspace source file exceeds the configured limit of ${this.config.maxFileSize} UTF-8 bytes: ${path}`,
        });
        return await this.failInitialization(
          fileBudgetError,
          "Workspace file-budget failure and cleanup failed",
        );
      }

      if (contentSize > remainingTotalBytes) {
        const budgetError = INITIALIZATION_ERROR.create({
          detail:
            `Workspace source exceeds the configured limit of ${this.config.maxTotalBytes} UTF-8 bytes`,
        });
        return await this.failInitialization(
          budgetError,
          "Workspace byte-budget failure and cleanup failed",
        );
      }

      try {
        this.throwIfAborted();
        // Calculate checksum for change detection only for materialized files.
        const hash = await computeHash(content);

        // The run directory is exclusively claimed. `createNew` ensures a
        // raced final-component symlink or alias cannot be followed/overwritten.
        await this.resolveSafePath(path);
        await this.ensureParentDirectories(path);
        const recheckedPath = await this.resolveSafePath(path);
        await Deno.writeTextFile(recheckedPath, content, { createNew: true, mode: 0o600 });

        this.fileChecksums.set(path, hash);
        filesDownloaded++;
        bytesDownloaded += contentSize;

        if (this.config.debug) {
          logger.info("Downloaded file", { path });
        }
      } catch (error) {
        if (this.config.abortSignal?.aborted) {
          return await this.failInitialization(
            this.config.abortSignal.reason ?? error,
            "Workspace materialization cancellation and cleanup failed",
          );
        }
        const errorName = error instanceof Error ? error.name : typeof error;
        logger.error("Failed to materialize workspace file", { path, errorName });
        downloadErrors.push({ path, error: "Project file materialization failed" });
        return await this.failInitialization(
          INITIALIZATION_ERROR.create({
            detail: "Workspace initialization failed for 1 file(s)",
          }),
          "Workspace materialization and cleanup failed",
        );
      }
    }

    try {
      await this.assertWorkspaceIdentity();
      // This is the initialization linearization point. An abort observed
      // before it must tear down the claimed workspace rather than returning a
      // successfully initialized object with an already-cancelled lifetime.
      this.throwIfAborted();
    } catch (error) {
      return await this.failInitialization(
        error,
        "Workspace final identity check and cleanup failed",
      );
    }

    this.initialized = true;

    const result: WorkspaceSyncResult = {
      workspaceDir: this.workspaceDir,
      filesDownloaded,
      bytesDownloaded,
      skippedFiles,
      downloadErrors,
      duration: Date.now() - startTime,
    };

    if (this.config.debug) {
      logger.info("Workspace initialized", {
        duration: result.duration,
        filesDownloaded,
        bytesDownloaded,
        skipped: skippedFiles.length,
      });
    }

    return result;
  }

  /**
   * Detect changes in the workspace
   */
  async detectChanges(): Promise<FileChange[]> {
    const changes: FileChange[] = [];
    const budget: WorkspaceWalkBudget = {
      entries: 0,
      files: 0,
      bytes: 0,
      portablePaths: new Map(),
      observedFiles: new Set(),
    };

    this.assertInitialized();
    this.throwIfAborted();
    await this.assertWorkspaceIdentity();

    // Walk the workspace directory
    for await (const entry of Deno.readDir(this.workspaceDir)) {
      await this.walkAndDetect(
        `${this.workspaceDir}/${entry.name}`,
        `/${entry.name}`,
        changes,
        budget,
      );
    }

    // Check for deleted files
    for (const [path, originalHash] of this.fileChecksums) {
      this.throwIfAborted();
      const localPath = await this.resolveSafePath(path);
      try {
        const info = await Deno.lstat(localPath);
        assertOrdinaryWorkspaceFile(info, path);
        if (!budget.observedFiles.has(path)) {
          throw SECURITY_VIOLATION.create({
            detail: `Tracked workspace file appeared during change detection: ${path}`,
          });
        }
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
        await this.assertWorkspaceIdentity();
        if (budget.observedFiles.has(path)) {
          throw SECURITY_VIOLATION.create({
            detail: `Tracked workspace file disappeared during change detection: ${path}`,
          });
        }
        registerPortablePath(
          budget.portablePaths,
          path,
          (candidate, collision) =>
            SECURITY_VIOLATION.create({
              detail:
                `Workspace changes contain a portable path collision: ${collision} and ${candidate}`,
            }),
        );
        changes.push({
          path,
          type: "deleted",
          originalChecksum: originalHash,
        });
      }
    }

    // Do not linearize a successful detection after its lifetime was cancelled
    // or the claimed root changed during the final deletion check.
    await this.assertWorkspaceIdentity();
    this.throwIfAborted();

    changes.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

    if (this.config.debug) {
      logger.info("Detected changes", { count: changes.length });
    }

    return changes;
  }

  /**
   * Recursively walk directory and detect changes.
   *
   * SECURITY: Uses lstat (not stat) and skips any symlink it finds, so a
   * symlink planted inside the workspace cannot cause descent into, or reads
   * from, files outside the workspace (VULN-FS-4).
   */
  private async walkAndDetect(
    localPath: string,
    relativePath: string,
    changes: FileChange[],
    budget: WorkspaceWalkBudget,
  ): Promise<void> {
    this.throwIfAborted();
    await this.assertWorkspaceIdentity();
    const stat = await Deno.lstat(localPath);
    budget.entries++;
    if (budget.entries > this.config.maxEntries) {
      throw SECURITY_VIOLATION.create({
        detail:
          `Workspace contents exceed the configured limit of ${this.config.maxEntries} entries`,
      });
    }

    // A symlink is an untracked workspace mutation. Failing is safer than
    // silently returning a change set that omits it.
    if (stat.isSymlink) {
      throw SECURITY_VIOLATION.create({
        detail: `Workspace change detection refuses symlink: ${relativePath}`,
      });
    }
    try {
      canonicalProjectPath(relativePath);
    } catch {
      throw SECURITY_VIOLATION.create({
        detail: "Workspace contains a non-portable project path",
      });
    }
    registerPortablePath(
      budget.portablePaths,
      relativePath,
      (path, collision) =>
        SECURITY_VIOLATION.create({
          detail: `Workspace contains a portable path collision: ${collision} and ${path}`,
        }),
    );

    if (stat.isDirectory) {
      if (this.fileChecksums.has(relativePath)) {
        throw SECURITY_VIOLATION.create({
          detail: `Tracked workspace file became a directory: ${relativePath}`,
        });
      }
      // Apply the same policy in both synchronization directions. Excluded
      // directories are pruned, while include-mismatched directories must
      // still be traversed because a descendant can match an include pattern.
      if (this.config.exclude && matchesPattern(relativePath, this.config.exclude)) {
        return;
      }
      for await (const entry of Deno.readDir(localPath)) {
        await this.walkAndDetect(
          `${localPath}/${entry.name}`,
          `${relativePath}/${entry.name}`,
          changes,
          budget,
        );
      }
      return;
    }

    if (!stat.isFile) {
      throw SECURITY_VIOLATION.create({
        detail: `Workspace contains an unsupported filesystem entry: ${relativePath}`,
      });
    }

    if (stat.nlink !== null && stat.nlink > 1) {
      throw SECURITY_VIOLATION.create({
        detail: `Workspace file has multiple hard links: ${relativePath}`,
      });
    }
    if (this.config.exclude && matchesPattern(relativePath, this.config.exclude)) {
      return;
    }
    if (this.config.include && !matchesPattern(relativePath, this.config.include)) {
      return;
    }

    budget.files++;
    if (budget.files > this.config.maxFiles) {
      throw SECURITY_VIOLATION.create({
        detail: `Workspace contents exceed the configured limit of ${this.config.maxFiles} files`,
      });
    }
    if (stat.size > this.config.maxFileSize) {
      throw SECURITY_VIOLATION.create({
        detail:
          `Workspace file exceeds the configured limit of ${this.config.maxFileSize} UTF-8 bytes`,
      });
    }
    const remainingBytes = this.config.maxTotalBytes - budget.bytes;
    if (stat.size > remainingBytes) {
      throw SECURITY_VIOLATION.create({
        detail:
          `Workspace contents exceed the configured limit of ${this.config.maxTotalBytes} UTF-8 bytes`,
      });
    }

    // It's a regular, contained file - check for changes.
    const fileLimitDetail = remainingBytes < this.config.maxFileSize
      ? `Workspace contents exceed the configured limit of ${this.config.maxTotalBytes} UTF-8 bytes`
      : `Workspace file exceeds the configured limit of ${this.config.maxFileSize} UTF-8 bytes`;
    const { content, bytes } = await this.readWorkspaceText(
      relativePath,
      Math.min(this.config.maxFileSize, remainingBytes),
      fileLimitDetail,
    );
    budget.bytes += bytes;
    const newHash = await computeHash(content);
    budget.observedFiles.add(relativePath);
    const originalHash = this.fileChecksums.get(relativePath);

    if (!originalHash) {
      // New file
      changes.push({
        path: relativePath,
        type: "created",
        newChecksum: newHash,
      });
    } else if (newHash !== originalHash) {
      // Modified file
      changes.push({
        path: relativePath,
        type: "modified",
        originalChecksum: originalHash,
        newChecksum: newHash,
      });
    }
  }

  /**
   * Persist changes through explicitly composed integration callbacks.
   */
  async uploadChanges(
    changes: FileChange[],
    options: {
      /** Callback to get file content for upload */
      onUpload?: (
        path: string,
        content: string,
        type: FileChange["type"],
        context: WorkspacePersistenceContext,
      ) => Promise<void>;
      /** Callback that persists a deletion without fabricating file content. */
      onDelete?: (
        path: string,
        context: WorkspacePersistenceContext,
      ) => Promise<void>;
    } = {},
  ): Promise<UploadResult> {
    this.assertInitialized();
    this.throwIfAborted();
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw INVALID_ARGUMENT.create({ detail: "Workspace upload options must be an object" });
    }
    if (options.onUpload !== undefined && typeof options.onUpload !== "function") {
      throw INVALID_ARGUMENT.create({ detail: "Workspace onUpload must be a function" });
    }
    if (options.onDelete !== undefined && typeof options.onDelete !== "function") {
      throw INVALID_ARGUMENT.create({ detail: "Workspace onDelete must be a function" });
    }
    const admittedChanges = admitWorkspaceChanges(
      changes,
      maximumDetectedChanges(this.config.maxFiles),
    );
    assertChangesMatchPolicy(
      admittedChanges,
      this.config.include,
      this.config.exclude,
    );
    const startTime = Date.now();
    const uploaded: FileChange[] = [];
    const skipped: FileChange[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    const prepared: Array<{ change: FileChange; content?: string }> = [];
    let preparedBytes = 0;

    for (const change of admittedChanges) {
      this.throwIfAborted();
      if (change.type === "deleted") {
        await this.assertWorkspacePathAbsent(change.path);
        prepared.push({ change });
        continue;
      }
      if (!options.onUpload) {
        prepared.push({ change });
        continue;
      }
      const remainingBytes = this.config.maxTotalBytes - preparedBytes;
      const uploadLimitDetail = remainingBytes < this.config.maxFileSize
        ? `Workspace upload exceeds the configured limit of ${this.config.maxTotalBytes} UTF-8 bytes`
        : `Workspace file exceeds the configured limit of ${this.config.maxFileSize} UTF-8 bytes`;
      const { content, bytes } = await this.readWorkspaceText(
        change.path,
        Math.min(this.config.maxFileSize, remainingBytes),
        uploadLimitDetail,
      );
      preparedBytes += bytes;
      if (change.newChecksum !== undefined) {
        const currentChecksum = await computeHash(content);
        if (currentChecksum !== change.newChecksum) {
          throw SECURITY_VIOLATION.create({
            detail: `Workspace file changed after change detection: ${change.path}`,
          });
        }
      }
      prepared.push({ change, content });
    }

    for (let index = 0; index < prepared.length; index++) {
      const { change, content } = prepared[index]!;
      if (this.config.abortSignal?.aborted) {
        throw new WorkspaceUploadAbortError(
          snapshotUploadProgress(uploaded, skipped, failed, startTime),
          snapshotRemainingChanges(prepared, index),
          this.config.abortSignal.reason,
        );
      }
      const persistenceContext = Object.freeze({
        abortSignal: this.config.abortSignal,
        change: snapshotFileChange(change),
      });
      try {
        if (change.type === "deleted") {
          if (!options.onDelete) {
            failed.push({
              path: change.path,
              error: "Delete handler is not configured",
            });
            continue;
          }
          try {
            // Preparation establishes the initial snapshot, but an earlier
            // callback can recreate a later deletion. Recheck immediately
            // before the persistence boundary and report the unsettled item.
            await this.assertWorkspacePathAbsent(change.path);
          } catch (error) {
            logger.error("Workspace deletion changed before persistence", {
              path: change.path,
              errorName: error instanceof Error ? error.name : typeof error,
            });
            failed.push({
              path: change.path,
              error: "Workspace deletion changed before persistence",
            });
            continue;
          }
          await options.onDelete(change.path, persistenceContext);
          // Callback resolution is the persistence commit point. Record it
          // before observing cancellation ahead of the next callback.
          uploaded.push(change);
          continue;
        }

        if (options.onUpload) {
          if (content === undefined) {
            throw new TypeError("Prepared workspace upload content is missing");
          }
          await options.onUpload(change.path, content, change.type, persistenceContext);
          // Callback resolution is the persistence commit point. Record it
          // before observing cancellation ahead of the next callback.
          uploaded.push(change);
        } else {
          // No upload handler: this is a dry run. Record as skipped (NOT
          // uploaded) so the caller can tell nothing was persisted.
          if (this.config.debug) {
            logger.info("Would upload file (no onUpload handler)", {
              path: change.path,
              type: change.type,
            });
          }
          skipped.push(change);
        }
      } catch (error) {
        if (this.config.abortSignal?.aborted) {
          throw new WorkspaceUploadAbortError(
            snapshotUploadProgress(uploaded, skipped, failed, startTime),
            snapshotRemainingChanges(prepared, index),
            this.config.abortSignal.reason ?? error,
          );
        }
        logger.error("Workspace persistence callback failed", {
          path: change.path,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        failed.push({
          path: change.path,
          error: "Workspace persistence callback failed",
        });
      }
    }

    return {
      uploaded,
      skipped,
      failed,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Safely resolve a path within the workspace, preventing path traversal
   * and symlink-based escapes (VULN-FS-4).
   *
   * - Rejects NUL bytes outright.
   * - Rejects any intermediate path segment that is a symlink.
   * - Re-checks containment by realpath-ing the parent directory after the
   *   segment walk, so a symlink that resolves through a non-symlink directory
   *   chain still cannot escape the workspace.
   *
   * Note: this deliberately rejects all symlinks inside the workspace, even
   * those whose targets remain within it, because the race window between
   * resolution and use is not worth the complexity for our use-case.
   */
  private async resolveSafePath(path: string): Promise<string> {
    const canonicalPath = canonicalProjectPath(path);
    const normalizedPath = canonicalPath.slice(1);
    await this.assertWorkspaceIdentity();

    // Resolve the already-canonical path lexically as a defense in depth.
    const workspaceRoot = resolve(this.workspaceDir);
    const fullPath = resolve(join(this.workspaceDir, normalizedPath));
    if (fullPath === workspaceRoot || !isWithinDirectory(workspaceRoot, fullPath)) {
      throw SECURITY_VIOLATION.create({ detail: `Path traversal detected: ${path}` });
    }

    // Walk each segment and reject any existing symlink along the way.
    // A segment that does not yet exist is allowed because it will be created later.
    // Use the admitted project-path segments rather than the host separator
    // returned by `relative()`, so intermediate checks remain correct on
    // Windows as well as POSIX hosts.
    const projectSegments = normalizedPath.split("/");
    let cursor = workspaceRoot;
    for (let index = 0; index < projectSegments.length; index++) {
      const seg = projectSegments[index]!;
      const projectSegment = `/${projectSegments.slice(0, index + 1).join("/")}`;
      cursor = join(cursor, seg);
      try {
        const info = await Deno.lstat(cursor);
        if (info.isSymlink) {
          throw SECURITY_VIOLATION.create({
            detail: `Refusing to traverse symlink: ${projectSegment}`,
          });
        }
        if (info.isFile && info.nlink !== null && info.nlink > 1) {
          throw SECURITY_VIOLATION.create({
            detail: `Refusing a workspace file with multiple hard links: ${projectSegment}`,
          });
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          // The segment does not exist yet. The rest of the chain will be
          // created under a verified-non-symlink parent, so stop walking.
          break;
        }
        throw e;
      }
    }

    // Final containment check against the realpath of the parent directory,
    // to defeat any symlink-in-parent we might have missed (e.g. one that
    // appeared mid-walk). A missing parent is allowed because
    // the segment walk above already proved every existing ancestor is real.
    try {
      const parentReal = await Deno.realPath(dirname(fullPath));
      const workspaceReal = await Deno.realPath(this.workspaceDir);
      if (!isWithinDirectory(workspaceReal, parentReal)) {
        throw SECURITY_VIOLATION.create({
          detail: `Workspace parent resolved outside the claimed workspace: ${canonicalPath}`,
        });
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    return fullPath;
  }

  /**
   * Read a file from the workspace
   */
  async readFile(path: string): Promise<string> {
    this.assertInitialized();
    this.throwIfAborted();
    const { content } = await this.readWorkspaceText(
      path,
      this.config.maxFileSize,
      `Workspace file exceeds the configured limit of ${this.config.maxFileSize} UTF-8 bytes`,
    );
    return content;
  }

  /**
   * Write a file to the workspace
   */
  async writeFile(path: string, content: string): Promise<void> {
    this.assertInitialized();
    this.throwIfAborted();
    if (typeof content !== "string") {
      throw INVALID_ARGUMENT.create({ detail: "Workspace file content must be a string" });
    }
    if (utf8ByteLength(content, this.config.maxFileSize) > this.config.maxFileSize) {
      throw SECURITY_VIOLATION.create({
        detail:
          `Workspace file exceeds the configured limit of ${this.config.maxFileSize} UTF-8 bytes`,
      });
    }
    await this.replaceWorkspaceText(path, content);
  }

  /**
   * Delete a file from the workspace
   */
  async deleteFile(path: string): Promise<void> {
    this.assertInitialized();
    this.throwIfAborted();
    const localPath = await this.resolveSafePath(path);
    const info = await Deno.lstat(localPath);
    assertOrdinaryWorkspaceFile(info, canonicalProjectPath(path));
    await Deno.remove(localPath);
  }

  /**
   * Check if a file exists in the workspace
   */
  async fileExists(path: string): Promise<boolean> {
    this.assertInitialized();
    this.throwIfAborted();
    const localPath = await this.resolveSafePath(path);
    try {
      const info = await Deno.lstat(localPath);
      await this.assertWorkspaceIdentity();
      return info.isFile;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      await this.assertWorkspaceIdentity();
      return false;
    }
  }

  /**
   * Clean up the workspace directory
   */
  async cleanup(): Promise<void> {
    if (this.config.debug) {
      logger.info("Cleaning up workspace", { runId: this.config.runId });
    }

    if (!this.workspaceClaimed) {
      this.initialized = false;
      this.fileChecksums.clear();
      this.workspaceIdentity = undefined;
      return;
    }
    if (!this.workspaceIdentity) {
      throw SECURITY_VIOLATION.create({
        detail: "Workspace cleanup cannot verify ownership of the claimed directory",
      });
    }

    try {
      await this.assertWorkspaceIdentity();
      await Deno.remove(this.workspaceDir, { recursive: true });
    } catch (error) {
      logger.error("Workspace cleanup failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      if (error instanceof Deno.errors.NotFound) {
        throw SECURITY_VIOLATION.create({
          detail: "Claimed workspace disappeared before cleanup completed",
        });
      }
      throw error;
    }

    this.workspaceClaimed = false;
    this.initialized = false;
    this.fileChecksums.clear();
    this.workspaceIdentity = undefined;
  }
}

/**
 * Create a workspace sync for a Claude Code run
 */
export function createWorkspaceSync(config: WorkspaceConfig): WorkspaceSync {
  return new WorkspaceSync(config);
}

/**
 * Execute a function with a synchronized workspace
 *
 * @example
 * ```typescript
 * const result = await withWorkspace(
 *   { baseDir: workspaceRoot, runId: "abc123", source },
 *   async (workspace) => {
 *     // Workspace is initialized with project files
 *     await runBashCommand("npm install", workspace.workspaceDir);
 *     await runBashCommand("npm test", workspace.workspaceDir);
 *
 *     // Return result
 *     return { success: true };
 *   },
 * );
 *
 * // Changes are automatically detected and returned
 * console.log(result.changes);
 * ```
 */
export async function withWorkspace<T>(
  config: WorkspaceConfig,
  fn: (workspace: WorkspaceSync) => Promise<T>,
): Promise<{
  result: T;
  changes: FileChange[];
  syncResult: WorkspaceSyncResult;
}> {
  const workspace = createWorkspaceSync(config);
  let outcome: { result: T; changes: FileChange[]; syncResult: WorkspaceSyncResult } | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    // Initialize workspace
    const syncResult = await workspace.initialize();

    // Execute function
    const result = await fn(workspace);

    // Detect changes
    const changes = await workspace.detectChanges();

    outcome = { result, changes, syncResult };
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  try {
    await workspace.cleanup();
  } catch (cleanupError) {
    if (operationFailed) {
      throw new AggregateError(
        [operationError, cleanupError],
        "Workspace operation and cleanup failed",
      );
    }
    throw cleanupError;
  }

  if (operationFailed) throw operationError;
  if (outcome === undefined) {
    throw INITIALIZATION_ERROR.create({
      detail: "Workspace operation completed without a result",
    });
  }
  return outcome;
}

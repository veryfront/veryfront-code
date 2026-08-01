import { isAbsolute, relative, resolve, sep } from "../../../compat/path/index.ts";
import { FileSnapshotChangedError } from "../../file-snapshot-error.ts";

interface SnapshotStat {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface SnapshotHandle {
  stat(): Promise<SnapshotStat>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  writeFile(content: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface NativeSnapshotOperations {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<SnapshotStat>;
  open(path: string, flags: number | string): Promise<SnapshotHandle>;
}

function toSnapshotStat(stats: import("node:fs").BigIntStats): SnapshotStat {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    isFile: () => stats.isFile(),
    isSymbolicLink: () => stats.isSymbolicLink(),
  };
}

async function defaultOperations(): Promise<NativeSnapshotOperations> {
  const fs = await import("node:fs/promises");
  return {
    realpath: (path) => fs.realpath(path),
    async lstat(path) {
      return toSnapshotStat(await fs.lstat(path, { bigint: true }));
    },
    async open(path, flags) {
      const handle = await fs.open(path, flags);
      return {
        async stat() {
          return toSnapshotStat(await handle.stat({ bigint: true }));
        },
        read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
        writeFile: (content) => handle.writeFile(content),
        close: () => handle.close(),
      };
    },
  };
}

function requireByteLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Snapshot byte limit must be a positive safe integer");
  }
  return value;
}

function isContainedPath(path: string, root: string): boolean {
  const relation = relative(root, path);
  return relation === "" ||
    (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

function sameIdentity(left: SnapshotStat, right: SnapshotStat): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameGeneration(left: SnapshotStat, right: SnapshotStat): boolean {
  return sameIdentity(left, right) && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function changed(message: string, cause?: unknown): FileSnapshotChangedError {
  const error = new FileSnapshotChangedError(message);
  if (cause !== undefined) Object.defineProperty(error, "cause", { value: cause });
  return error;
}

async function closeSnapshotHandle(
  handle: SnapshotHandle,
  primaryFailure: unknown,
  failed: boolean,
): Promise<void> {
  try {
    await handle.close();
  } catch (cleanupFailure) {
    if (failed) {
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        "Filesystem snapshot read and handle cleanup both failed",
      );
    }
    throw cleanupFailure;
  }
  if (failed) throw primaryFailure;
}

/**
 * Read one verified regular-file generation without following a terminal link.
 * Identity and generation are checked before and after the bounded positional read.
 */
export async function readNodeFileSnapshotWithinLimit(
  path: string,
  containmentRoot: string,
  byteLimit: number,
  operations?: NativeSnapshotOperations,
): Promise<Uint8Array> {
  const admittedLimit = requireByteLimit(byteLimit);
  const lexicalRoot = resolve(containmentRoot);
  const candidate = resolve(path);
  if (!isContainedPath(candidate, lexicalRoot)) {
    throw new TypeError("Snapshot path must be contained by the requested root");
  }

  const fsOperations = operations ?? await defaultOperations();
  const { constants } = await import("node:fs");
  if (!Number.isSafeInteger(constants.O_NOFOLLOW) || constants.O_NOFOLLOW === 0) {
    throw new TypeError("This runtime cannot guarantee no-follow snapshot opens");
  }

  const canonicalRoot = await fsOperations.realpath(lexicalRoot);
  const pathnameBefore = await fsOperations.lstat(candidate);
  if (pathnameBefore.isSymbolicLink()) {
    throw new TypeError("Snapshot path must not be a symbolic link");
  }
  if (!pathnameBefore.isFile()) {
    throw new TypeError("Snapshot path must identify a regular file");
  }

  let handle: SnapshotHandle;
  try {
    handle = await fsOperations.open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (cause) {
    throw changed("File identity became uncertain while opening the snapshot", cause);
  }

  let failed = false;
  let primaryFailure: unknown;
  let result: Uint8Array | undefined;
  try {
    let handleBefore: SnapshotStat;
    try {
      handleBefore = await handle.stat();
    } catch (cause) {
      throw changed("Opened file identity could not be verified", cause);
    }
    if (!handleBefore.isFile() || !sameGeneration(pathnameBefore, handleBefore)) {
      throw changed("File identity changed while opening the snapshot");
    }

    let canonicalTarget: string;
    let pathnameOpened: SnapshotStat;
    try {
      [canonicalTarget, pathnameOpened] = await Promise.all([
        fsOperations.realpath(candidate),
        fsOperations.lstat(candidate),
      ]);
    } catch (cause) {
      throw changed("File target became uncertain while opening the snapshot", cause);
    }
    if (
      pathnameOpened.isSymbolicLink() || !pathnameOpened.isFile() ||
      !sameGeneration(handleBefore, pathnameOpened)
    ) {
      throw changed("File identity changed while opening the snapshot");
    }
    if (!isContainedPath(canonicalTarget, canonicalRoot)) {
      throw new TypeError("Snapshot target must be contained by the canonical root");
    }
    if (handleBefore.size < 0n) {
      throw changed("File size became uncertain while opening the snapshot");
    }
    if (handleBefore.size > BigInt(admittedLimit)) {
      throw new RangeError(`File exceeds byte limit of ${admittedLimit} bytes`);
    }

    const size = Number(handleBefore.size);
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > size - offset) {
        throw changed("File size changed while reading the snapshot");
      }
      offset += bytesRead;
    }

    let handleAfter: SnapshotStat;
    let pathnameAfter: SnapshotStat;
    let canonicalTargetAfter: string;
    try {
      [handleAfter, pathnameAfter, canonicalTargetAfter] = await Promise.all([
        handle.stat(),
        fsOperations.lstat(candidate),
        fsOperations.realpath(candidate),
      ]);
    } catch (cause) {
      throw changed("File identity became uncertain after reading the snapshot", cause);
    }
    if (
      pathnameAfter.isSymbolicLink() || !pathnameAfter.isFile() ||
      !sameGeneration(handleBefore, handleAfter) ||
      !sameGeneration(handleBefore, pathnameAfter) ||
      canonicalTargetAfter !== canonicalTarget ||
      !isContainedPath(canonicalTargetAfter, canonicalRoot)
    ) {
      throw changed("File snapshot changed during the read");
    }
    result = bytes;
  } catch (error) {
    failed = true;
    primaryFailure = error;
  }

  await closeSnapshotHandle(handle, primaryFailure, failed);
  return result!;
}

/** Create a new file without replacement and join handle cleanup. */
export async function createNodeFileBytesExclusive(
  path: string,
  content: Uint8Array,
  operations?: NativeSnapshotOperations,
): Promise<void> {
  const fsOperations = operations ?? await defaultOperations();
  const handle = await fsOperations.open(path, "wx");
  let failed = false;
  let primaryFailure: unknown;
  try {
    await handle.writeFile(content);
  } catch (error) {
    failed = true;
    primaryFailure = error;
  }
  await closeSnapshotHandle(handle, primaryFailure, failed);
}

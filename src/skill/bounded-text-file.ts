import { resolve } from "#veryfront/compat/path";
import type {
  BoundedFileSystemAdapter,
  FileInfo,
  FileSystemAdapter,
} from "#veryfront/platform/adapters/base.ts";
import { isNativeFileSystemAdapter } from "#veryfront/platform/adapters/native-file-system-provenance.ts";
import { SKILL_ROOT_PATH_MAX_LENGTH, SKILL_TEXT_FILE_MAX_BYTES } from "./limits.ts";
import type { SkillOperationBudget } from "./operation-budget.ts";
import { sanitizeSkillBoundaryFailure } from "./error-boundary.ts";
import { validateStrictSkillPath } from "./path-safety.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type FileIdentity = Readonly<{
  dev: number | bigint;
  ino: number | bigint;
}>;

type LocalFileInfo = Readonly<{
  dev: number | bigint | null;
  ino: number | bigint | null;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number | bigint;
}>;

interface LocalReadHandle {
  close(): void | Promise<void>;
  read(buffer: Uint8Array): Promise<number | null>;
  stat(): Promise<LocalFileInfo>;
}

interface GuardedLocalRead {
  readonly expectedIdentity?: FileIdentity;
  readonly expectedSize: number;
  readonly revalidate: () => Promise<string>;
  readonly validatedPath: string;
}

function requirePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SKILL_ROOT_PATH_MAX_LENGTH ||
    !isWellFormedUtf16(value) ||
    hasControlCharacters(value)
  ) {
    throw new TypeError("Skill file path must be a non-empty bounded path");
  }
  return value;
}

function requireMaxBytes(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > SKILL_TEXT_FILE_MAX_BYTES
  ) {
    throw new RangeError(
      `Skill text-file maxBytes must be a positive safe integer no greater than ${SKILL_TEXT_FILE_MAX_BYTES}`,
    );
  }
  return value as number;
}

function assertFileInfo(
  path: string,
  info: Pick<FileInfo, "isFile" | "isSymlink" | "size">,
  maxBytes: number,
): void {
  if (info.isSymlink) {
    throw new TypeError(`Skill file must not be a symlink: "${path}"`);
  }
  if (!info.isFile) {
    throw new TypeError(`Skill path must point to a file: "${path}"`);
  }
  if (!Number.isSafeInteger(info.size) || info.size < 0) {
    throw new TypeError(`Skill file size is invalid for "${path}"`);
  }
  if (info.size > maxBytes) {
    throw new RangeError(`Skill file "${path}" exceeds ${maxBytes} bytes`);
  }
}

function requireLocalFileSize(path: string, size: number | bigint): number {
  const normalized = typeof size === "bigint" ? Number(size) : size;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 0
  ) {
    throw new TypeError(`Skill file size is invalid for "${path}"`);
  }
  return normalized;
}

function getFileIdentity(info: LocalFileInfo): FileIdentity | undefined {
  const validPart = (value: number | bigint | null): value is number | bigint =>
    (typeof value === "bigint" && value >= 0n) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

  if (!validPart(info.dev) || !validPart(info.ino)) return undefined;
  return { dev: info.dev, ino: info.ino };
}

function isSameFile(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertOpenedRegularFile(
  path: string,
  info: LocalFileInfo,
  maxBytes: number,
): { identity?: FileIdentity; size: number } {
  if (info.isSymlink) {
    throw new TypeError(`Skill file must not be a symlink: "${path}"`);
  }
  if (!info.isFile || info.isDirectory) {
    throw new TypeError(`Skill path must point to a regular file: "${path}"`);
  }
  const size = requireLocalFileSize(path, info.size);
  if (size > maxBytes) {
    throw new RangeError(`Skill file "${path}" exceeds ${maxBytes} bytes`);
  }
  const identity = getFileIdentity(info);
  return identity === undefined ? { size } : { identity, size };
}

function assertBoundedUtf8String(
  path: string,
  content: string,
  maxBytes: number,
): string {
  let byteLength = 0;
  for (let index = 0; index < content.length; index += 1) {
    const code = content.charCodeAt(index);
    if (code <= 0x7f) {
      byteLength += 1;
    } else if (code <= 0x7ff) {
      byteLength += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = content.charCodeAt(index + 1);
      if (index + 1 >= content.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(`Skill file "${path}" must contain valid Unicode text`);
      }
      byteLength += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError(`Skill file "${path}" must contain valid Unicode text`);
    } else {
      byteLength += 3;
    }

    if (byteLength > maxBytes) {
      throw new RangeError(`Skill file "${path}" exceeds ${maxBytes} bytes`);
    }
  }
  return content;
}

function decodeUtf8(path: string, bytes: Uint8Array): string {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw new TypeError(`Skill file "${path}" must contain valid UTF-8`, {
      cause: error,
    });
  }
}

function getBoundedAdapterReader(
  fsAdapter: FileSystemAdapter,
): BoundedFileSystemAdapter["readFileBytesBounded"] | undefined {
  const candidate = fsAdapter.readFileBytesBounded;
  return typeof candidate === "function" ? candidate : undefined;
}

async function readAdapterTextFile(
  path: string,
  fsAdapter: FileSystemAdapter,
  maxBytes: number,
  requireBoundedRead = false,
): Promise<string> {
  const info = fsAdapter.lstat ? await fsAdapter.lstat(path) : await fsAdapter.stat(path);
  assertFileInfo(path, info, maxBytes);

  const boundedReader = getBoundedAdapterReader(fsAdapter);
  if (requireBoundedRead && boundedReader === undefined) {
    throw new TypeError(
      "Untrusted skill files require an adapter with a genuinely bounded byte reader",
    );
  }
  let boundedBytes: Uint8Array | undefined;
  let content: string;
  if (boundedReader) {
    const bytes = await boundedReader.call(fsAdapter, path, maxBytes + 1);
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError(`Skill file adapter returned invalid bytes for "${path}"`);
    }
    if (bytes.byteLength > maxBytes) {
      throw new RangeError(`Skill file "${path}" exceeds ${maxBytes} bytes`);
    }
    if (bytes.byteLength !== info.size) {
      throw new TypeError(`Skill file changed during reading: "${path}"`);
    }
    boundedBytes = bytes;
    content = decodeUtf8(path, bytes);
  } else if (fsAdapter.readFileBytes) {
    // Compatibility path for pre-existing adapters. The metadata preflight
    // rejects known oversized files before reading, but an opaque legacy
    // adapter can still materialize a file that grows after stat(). Only the
    // optional bounded capability above can enforce the allocation budget
    // before materialization.
    const bytes = await fsAdapter.readFileBytes(path);
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError(`Skill file adapter returned invalid bytes for "${path}"`);
    }
    if (bytes.byteLength > maxBytes) {
      throw new RangeError(`Skill file "${path}" exceeds ${maxBytes} bytes`);
    }
    content = decodeUtf8(path, bytes);
  } else {
    const adapterContent = await fsAdapter.readFile(path);
    if (typeof adapterContent !== "string") {
      throw new TypeError(`Skill file adapter returned non-text content for "${path}"`);
    }
    content = assertBoundedUtf8String(path, adapterContent, maxBytes);
  }

  const after = fsAdapter.lstat ? await fsAdapter.lstat(path) : await fsAdapter.stat(path);
  assertFileInfo(path, after, maxBytes);
  if (after.size !== info.size) {
    throw new TypeError(`Skill file changed during reading: "${path}"`);
  }

  if (boundedBytes !== undefined && boundedReader !== undefined) {
    // Allocation-bounded reads do not, by themselves, bind the adapter path to
    // the handle that produced the bytes. A second bounded snapshot catches an
    // ordinary same-size symlink/path swap-back without requiring private
    // native adapter markers. Mutable adapters that need protection from an
    // attacker toggling the namespace around every read must provide their own
    // atomic snapshot semantics.
    const confirmation = await boundedReader.call(
      fsAdapter,
      path,
      maxBytes + 1,
    );
    if (!(confirmation instanceof Uint8Array)) {
      throw new TypeError(`Skill file adapter returned invalid bytes for "${path}"`);
    }
    if (confirmation.byteLength > maxBytes) {
      throw new RangeError(`Skill file "${path}" exceeds ${maxBytes} bytes`);
    }
    const confirmedInfo = fsAdapter.lstat
      ? await fsAdapter.lstat(path)
      : await fsAdapter.stat(path);
    assertFileInfo(path, confirmedInfo, maxBytes);
    if (
      confirmation.byteLength !== info.size ||
      confirmedInfo.size !== info.size ||
      !bytesEqual(boundedBytes, confirmation)
    ) {
      throw new TypeError(`Skill file changed during reading: "${path}"`);
    }
  }
  return content;
}

async function lstatLocal(path: string): Promise<LocalFileInfo> {
  if (typeof Deno !== "undefined") {
    const info = await Deno.lstat(path);
    return {
      dev: info.dev,
      ino: info.ino,
      isDirectory: info.isDirectory,
      isFile: info.isFile,
      isSymlink: info.isSymlink,
      size: info.size,
    };
  }

  const fs = await import("node:fs/promises");
  const info = await fs.lstat(path, { bigint: true });
  return {
    dev: info.dev,
    ino: info.ino,
    isDirectory: info.isDirectory(),
    isFile: info.isFile(),
    isSymlink: info.isSymbolicLink(),
    size: info.size,
  };
}

async function openLocal(path: string): Promise<LocalReadHandle> {
  if (typeof Deno !== "undefined") {
    const file = await Deno.open(path, { read: true });
    return {
      close() {
        file.close();
      },
      read(buffer) {
        return file.read(buffer);
      },
      async stat() {
        const info = await file.stat();
        return {
          dev: info.dev,
          ino: info.ino,
          isDirectory: info.isDirectory,
          isFile: info.isFile,
          isSymlink: info.isSymlink,
          size: info.size,
        };
      },
    };
  }

  const [{ constants }, { open }] = await Promise.all([
    import("node:fs"),
    import("node:fs/promises"),
  ]);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(path, constants.O_RDONLY | noFollow);
  return {
    close() {
      return handle.close();
    },
    async read(buffer) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      return bytesRead === 0 ? null : bytesRead;
    },
    async stat() {
      const info = await handle.stat({ bigint: true });
      return {
        dev: info.dev,
        ino: info.ino,
        isDirectory: info.isDirectory(),
        isFile: info.isFile(),
        isSymlink: info.isSymbolicLink(),
        size: info.size,
      };
    },
  };
}

function compareKnownIdentities(
  path: string,
  left: FileIdentity | undefined,
  right: FileIdentity | undefined,
  phase: "reading" | "validation",
): boolean {
  if (left === undefined || right === undefined) return false;
  if (!isSameFile(left, right)) {
    throw new TypeError(`Skill file changed during ${phase}: "${path}"`);
  }
  return true;
}

function assertSameSize(
  path: string,
  left: number,
  right: number,
  phase: "reading" | "validation",
): void {
  if (left !== right) {
    throw new TypeError(`Skill file changed during ${phase}: "${path}"`);
  }
}

async function readHandleBytes(
  path: string,
  handle: LocalReadHandle,
  maxBytes: number,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(maxBytes + 1);
  let byteLength = 0;
  while (byteLength < bytes.byteLength) {
    const remaining = bytes.byteLength - byteLength;
    const bytesRead = await handle.read(bytes.subarray(byteLength));
    if (bytesRead === null || bytesRead === 0) break;
    if (
      !Number.isSafeInteger(bytesRead) ||
      bytesRead < 0 ||
      bytesRead > remaining
    ) {
      throw new TypeError(`Skill file read returned an invalid byte count for "${path}"`);
    }
    byteLength += bytesRead;
  }
  if (byteLength > maxBytes) {
    throw new RangeError(`Skill file "${path}" exceeds ${maxBytes} bytes`);
  }
  return bytes.subarray(0, byteLength);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

async function assertGuardStillValid(
  path: string,
  opened: { identity?: FileIdentity; size: number },
  guard: GuardedLocalRead,
  maxBytes: number,
): Promise<boolean> {
  const revalidatedPath = await guard.revalidate();
  if (resolve(revalidatedPath) !== resolve(guard.validatedPath)) {
    throw new TypeError(`Skill file changed during validation: "${path}"`);
  }

  const current = assertOpenedRegularFile(
    path,
    await lstatLocal(path),
    maxBytes,
  );
  assertSameSize(path, opened.size, current.size, "validation");
  assertSameSize(path, guard.expectedSize, current.size, "validation");
  return compareKnownIdentities(
    path,
    opened.identity,
    current.identity,
    "validation",
  );
}

/**
 * Capture a second bounded path snapshot.
 *
 * This is the portability fallback for filesystems where Deno cannot expose
 * device/inode identifiers. Comparing the opened bytes with a freshly opened,
 * revalidated path rejects a swap-back attack whenever the substituted file
 * differs. It deliberately does not pretend to provide kernel-atomic openat
 * semantics against an attacker that can toggle the namespace around every
 * verification open.
 */
async function readCurrentPathSnapshot(
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const before = assertOpenedRegularFile(
    path,
    await lstatLocal(path),
    maxBytes,
  );
  const handle = await openLocal(path);
  try {
    const opened = assertOpenedRegularFile(path, await handle.stat(), maxBytes);
    assertSameSize(path, before.size, opened.size, "reading");
    compareKnownIdentities(
      path,
      before.identity,
      opened.identity,
      "reading",
    );

    const bytes = await readHandleBytes(path, handle, maxBytes);
    const after = assertOpenedRegularFile(path, await handle.stat(), maxBytes);
    assertSameSize(path, opened.size, after.size, "reading");
    assertSameSize(path, opened.size, bytes.byteLength, "reading");
    compareKnownIdentities(
      path,
      opened.identity,
      after.identity,
      "reading",
    );

    const current = assertOpenedRegularFile(
      path,
      await lstatLocal(path),
      maxBytes,
    );
    assertSameSize(path, opened.size, current.size, "reading");
    compareKnownIdentities(
      path,
      opened.identity,
      current.identity,
      "reading",
    );
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readLocalTextFile(
  path: string,
  maxBytes: number,
  guard?: GuardedLocalRead,
): Promise<string> {
  const before = await lstatLocal(path);
  const beforeFile = assertOpenedRegularFile(path, before, maxBytes);
  let identityVerified = true;
  if (guard) {
    assertSameSize(path, guard.expectedSize, beforeFile.size, "validation");
    identityVerified = compareKnownIdentities(
      path,
      guard.expectedIdentity,
      beforeFile.identity,
      "validation",
    );
  }

  const handle = await openLocal(path);
  try {
    const opened = assertOpenedRegularFile(path, await handle.stat(), maxBytes);
    assertSameSize(
      path,
      beforeFile.size,
      opened.size,
      guard ? "validation" : "reading",
    );
    const beforeMatches = compareKnownIdentities(
      path,
      beforeFile.identity,
      opened.identity,
      guard ? "validation" : "reading",
    );
    identityVerified = beforeMatches && identityVerified;
    if (guard) {
      const expectedMatches = compareKnownIdentities(
        path,
        guard.expectedIdentity,
        opened.identity,
        "validation",
      );
      identityVerified = expectedMatches && identityVerified;
    }

    if (guard) {
      const pathMatches = await assertGuardStillValid(
        path,
        opened,
        guard,
        maxBytes,
      );
      identityVerified = pathMatches && identityVerified;
    }

    const bytes = await readHandleBytes(path, handle, maxBytes);

    const after = assertOpenedRegularFile(path, await handle.stat(), maxBytes);
    assertSameSize(path, opened.size, after.size, "reading");
    assertSameSize(path, opened.size, bytes.byteLength, "reading");
    const handleMatches = compareKnownIdentities(
      path,
      opened.identity,
      after.identity,
      "reading",
    );
    identityVerified = handleMatches && identityVerified;

    if (guard) {
      const pathMatches = await assertGuardStillValid(
        path,
        opened,
        guard,
        maxBytes,
      );
      identityVerified = pathMatches && identityVerified;
    } else {
      const current = assertOpenedRegularFile(
        path,
        await lstatLocal(path),
        maxBytes,
      );
      assertSameSize(path, opened.size, current.size, "reading");
      const pathMatches = compareKnownIdentities(
        path,
        opened.identity,
        current.identity,
        "reading",
      );
      identityVerified = pathMatches && identityVerified;
    }

    if (!identityVerified) {
      if (guard) {
        await assertGuardStillValid(path, opened, guard, maxBytes);
      }
      const currentBytes = await readCurrentPathSnapshot(path, maxBytes);
      if (guard) {
        await assertGuardStillValid(path, opened, guard, maxBytes);
      }
      if (!bytesEqual(bytes, currentBytes)) {
        const phase = guard ? "validation" : "reading";
        throw new TypeError(`Skill file changed during ${phase}: "${path}"`);
      }
    }

    return decodeUtf8(path, bytes);
  } finally {
    await handle.close();
  }
}

/**
 * Read one skill-owned text file through a fixed byte budget.
 *
 * Local reads reject terminal symlinks and never allocate from an
 * attacker-controlled file size. When stable device/inode metadata exists,
 * validation is bound to the opened file identity. On valid filesystems where
 * Deno reports those fields as null, the bounded bytes are instead compared
 * with a second current-path snapshot. Adapters use an optional genuinely
 * bounded capability when available; legacy adapters keep the compatible
 * stat-preflight and post-read validation path.
 */
export async function readBoundedSkillTextFile(
  path: string,
  fsAdapter?: FileSystemAdapter,
  maxBytes: number = SKILL_TEXT_FILE_MAX_BYTES,
): Promise<string> {
  const boundedPath = requirePath(path);
  const boundedMaxBytes = requireMaxBytes(maxBytes);
  if (fsAdapter && !isNativeFileSystemAdapter(fsAdapter)) {
    return await readAdapterTextFile(
      boundedPath,
      fsAdapter,
      boundedMaxBytes,
    );
  }
  return await readLocalTextFile(boundedPath, boundedMaxBytes);
}

/**
 * Validate and read a skill file as one guarded operation.
 *
 * For native files, the first validated identity is compared with the opened
 * handle and with the path after containment is revalidated both before and
 * after the bounded read. If the runtime exposes no stable device/inode
 * identity, byte equality against a second revalidated path snapshot provides
 * a portable fail-closed fallback for differing-file swap-back attacks.
 *
 * High-level Deno and Node filesystem APIs do not expose openat/openat2-style
 * directory-relative resolution. An attacker able to toggle the namespace
 * around every validation and verification open can therefore still outrun
 * this userspace protocol; runtimes needing that stronger guarantee must
 * provide a kernel-atomic adapter implementation.
 *
 * FileSystemAdapter remains a compatibility boundary: validation is repeated
 * around the read, but the adapter must provide its own atomic snapshot
 * semantics if its namespace is concurrently mutable. Unlike the generic
 * readBoundedSkillTextFile helper, this untrusted validated-read path requires
 * a genuine readFileBytesBounded implementation from non-native adapters.
 */
export async function readValidatedSkillTextFile(
  skillRoot: string,
  requestedPath: string,
  allowedSubdirs: readonly string[],
  fsAdapter?: FileSystemAdapter,
  maxBytes: number = SKILL_TEXT_FILE_MAX_BYTES,
  options: { budget?: SkillOperationBudget } = {},
): Promise<{ content: string; path: string }> {
  const read = async (): Promise<{ content: string; path: string }> => {
    const boundedMaxBytes = requireMaxBytes(maxBytes);
    const validatedPath = await validateStrictSkillPath(
      skillRoot,
      requestedPath,
      allowedSubdirs,
      fsAdapter,
      options.budget ? { budget: options.budget } : {},
    );

    if (fsAdapter && !isNativeFileSystemAdapter(fsAdapter)) {
      const content = await readAdapterTextFile(
        validatedPath,
        fsAdapter,
        boundedMaxBytes,
        true,
      );
      const revalidatedPath = await validateStrictSkillPath(
        skillRoot,
        requestedPath,
        allowedSubdirs,
        fsAdapter,
        options.budget ? { budget: options.budget } : {},
      );
      if (resolve(revalidatedPath) !== resolve(validatedPath)) {
        throw new TypeError(`Skill file changed during validation: "${requestedPath}"`);
      }
      return { content, path: validatedPath };
    }

    const validatedInfo = await lstatLocal(validatedPath);
    const expected = assertOpenedRegularFile(
      validatedPath,
      validatedInfo,
      boundedMaxBytes,
    );
    const content = await readLocalTextFile(
      validatedPath,
      boundedMaxBytes,
      {
        ...(expected.identity === undefined ? {} : { expectedIdentity: expected.identity }),
        expectedSize: expected.size,
        revalidate: () =>
          validateStrictSkillPath(
            skillRoot,
            requestedPath,
            allowedSubdirs,
            fsAdapter,
            options.budget ? { budget: options.budget } : {},
          ),
        validatedPath,
      },
    );
    return { content, path: validatedPath };
  };

  try {
    return options.budget ? await options.budget.run(() => read()) : await read();
  } catch (error) {
    if (
      options.budget?.abortSignal?.aborted &&
      error === options.budget.abortSignal.reason
    ) {
      throw error;
    }
    throw sanitizeSkillBoundaryFailure(error, skillRoot);
  }
}

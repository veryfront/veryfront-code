/**
 * Internal scaffold writer.
 *
 * The parent starts this process with the validated target directory as its
 * working directory. The process verifies that pinned directory identity, then
 * creates or removes only a validated basename relative to it. A later rename
 * or symlink replacement of the parent path cannot redirect the file operation.
 */

import { lstat, open, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";

type FileIdentity = {
  dev: number | string;
  ino: number | string;
  kind: "directory" | "file" | "symlink" | "other";
  mode?: number | string | null;
  size?: number | string;
  mtimeMs?: number | string | null;
  birthtimeMs?: number | string | null;
  ctimeMs?: number | string | null;
} | null;

interface RootGuard {
  identity: FileIdentity;
  realPath: string;
}

type WriterRequest =
  | {
    operation: "ensure-parents";
    rootGuard: RootGuard;
    parentParts: string[];
  }
  | {
    operation: "create";
    rootGuard: RootGuard;
    parentParts: string[];
    name: string;
    content: string;
    failAfterBytes?: number;
  }
  | {
    operation: "remove";
    rootGuard: RootGuard;
    parentParts: string[];
    name: string;
    expectedFileIdentity: FileIdentity;
  };

const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

interface CreatedDirectory {
  parts: string[];
  identity: FileIdentity;
}

interface EnteredParent {
  directories: CreatedDirectory[];
  expectedRealPath: string;
}

interface NativeFileInfo {
  dev: bigint;
  ino: bigint;
  mode: bigint;
  size: bigint;
  mtimeMs: bigint;
  birthtimeMs: bigint;
  ctimeMs: bigint;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

function identity(info: NativeFileInfo): FileIdentity {
  if (info.dev <= 0n || info.ino <= 0n) return null;
  const kind = info.isDirectory()
    ? "directory"
    : info.isFile()
    ? "file"
    : info.isSymbolicLink()
    ? "symlink"
    : "other";
  const base = { dev: String(info.dev), ino: String(info.ino), kind } as const;
  if (kind === "directory") return base;
  return {
    ...base,
    mode: String(info.mode),
    size: String(info.size),
    mtimeMs: String(info.mtimeMs),
    birthtimeMs: String(info.birthtimeMs),
    ctimeMs: String(info.ctimeMs),
  };
}

function hasErrorCode(error: unknown, expected: string): boolean {
  return error instanceof Error && "code" in error &&
    (error as Error & { code?: unknown }).code === expected;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  if (left === null || right === null) return false;
  return left.dev === right.dev && left.ino === right.ino && left.kind === right.kind &&
    left.mode === right.mode && left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.birthtimeMs === right.birthtimeMs && left.ctimeMs === right.ctimeMs;
}

async function readRequest(): Promise<WriterRequest> {
  const bytes = new Uint8Array(MAX_REQUEST_BYTES + 1);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const read = await Deno.stdin.read(bytes.subarray(offset));
    if (read === null) break;
    offset += read;
  }
  if (offset > MAX_REQUEST_BYTES) throw new TypeError("request-too-large");
  return JSON.parse(new TextDecoder().decode(bytes.subarray(0, offset))) as WriterRequest;
}

function validateName(name: unknown): asserts name is string {
  if (
    typeof name !== "string" || name.length === 0 || name.length > 255 || name === "." ||
    name === ".." || name.includes("/") || name.includes("\\") || name.includes(":")
  ) {
    throw new TypeError("unsafe-name");
  }
}

async function validatePinnedDirectory(guard: RootGuard): Promise<void> {
  if (!guard || typeof guard !== "object" || typeof guard.realPath !== "string") {
    throw new TypeError("unsafe-directory");
  }
  const current = await stat(".", { bigint: true });
  if (!current.isDirectory()) throw new TypeError("unsafe-directory");
  const currentIdentity = identity(current);
  if (guard.identity !== null && !sameIdentity(currentIdentity, guard.identity)) {
    throw new TypeError("unsafe-directory");
  }
  await validateEnteredPath(guard.realPath);
}

async function enterPinnedParent(
  parts: unknown,
  createMissing: boolean,
  rootRealPath: string,
  beforeEnterForTesting?: () => Promise<void>,
): Promise<EnteredParent> {
  if (!Array.isArray(parts) || parts.length > 64) throw new TypeError("unsafe-directory");
  const created: CreatedDirectory[] = [];
  const traversed: string[] = [];
  for (const part of parts) {
    validateName(part);
    let before: NativeFileInfo;
    let createdCurrent = false;
    try {
      before = await lstat(part, { bigint: true });
    } catch (error) {
      if (!createMissing || !hasErrorCode(error, "ENOENT")) throw error;
      await Deno.mkdir(part);
      before = await lstat(part, { bigint: true });
      createdCurrent = true;
    }
    if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new TypeError("unsafe-directory");
    }
    const beforeIdentity = identity(before);
    const expectedRealPath = resolve(rootRealPath, ...traversed, part);
    await beforeEnterForTesting?.();
    Deno.chdir(part);
    const after = await stat(".", { bigint: true });
    if (!after.isDirectory()) throw new TypeError("unsafe-directory");
    if (beforeIdentity !== null && !sameIdentity(identity(after), beforeIdentity)) {
      throw new TypeError("unsafe-directory");
    }
    await validateEnteredPath(expectedRealPath);
    traversed.push(part);
    if (createdCurrent) created.push({ parts: [...traversed], identity: beforeIdentity });
  }
  return {
    directories: created,
    expectedRealPath: resolve(rootRealPath, ...traversed),
  };
}

function sameResolvedPath(left: string, right: string): boolean {
  return relative(left, right) === "" && relative(right, left) === "";
}

async function validateEnteredPath(expectedRealPath: string): Promise<void> {
  if (!sameResolvedPath(await Deno.realPath("."), expectedRealPath)) {
    throw new TypeError("unsafe-directory");
  }
}

/** @internal Test seam for a parent replacement between lstat and chdir. */
export async function testEnterPinnedParent(options: {
  parts: string[];
  beforeEnter: () => Promise<void>;
}): Promise<void> {
  await enterPinnedParent(
    options.parts,
    false,
    await Deno.realPath("."),
    options.beforeEnter,
  );
}

async function removeOwnedFile(name: string, expected: FileIdentity): Promise<void> {
  if (expected === null) return;
  try {
    const current = identity(await lstat(name, { bigint: true }));
    if (sameIdentity(current, expected)) await Deno.remove(name);
  } catch {
    // The caller reports the original failure. Cleanup is best effort and
    // never follows a parent path because this process stays in the pinned cwd.
  }
}

async function createFile(request: Extract<WriterRequest, { operation: "create" }>) {
  if (typeof request.content !== "string") throw new TypeError("invalid-content");
  const failAfterBytes = request.failAfterBytes;
  if (
    failAfterBytes !== undefined &&
    (!Number.isSafeInteger(failAfterBytes) || failAfterBytes < 0)
  ) {
    throw new TypeError("invalid-failure-boundary");
  }

  const handle = await open(request.name, "wx");
  let openedIdentity = identity(await handle.stat({ bigint: true }));
  let closed = false;
  const closeHandle = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  try {
    const content = new TextEncoder().encode(request.content);
    let offset = 0;
    while (offset < content.byteLength) {
      const remaining = failAfterBytes === undefined
        ? content.byteLength - offset
        : failAfterBytes - offset;
      if (remaining <= 0) throw new Error("simulated-partial-write-failure");
      const chunk = content.subarray(offset, Math.min(content.byteLength, offset + remaining));
      const { bytesWritten } = await handle.write(chunk);
      if (bytesWritten === 0) throw new Error("write-made-no-progress");
      offset += bytesWritten;
      openedIdentity = identity(await handle.stat({ bigint: true }));
      if (failAfterBytes !== undefined && offset >= failAfterBytes) {
        throw new Error("simulated-partial-write-failure");
      }
    }
  } catch (error) {
    await closeHandle();
    await removeOwnedFile(request.name, openedIdentity);
    throw error;
  } finally {
    try {
      await closeHandle();
    } catch {
      // The failure path already closed the handle.
    }
  }
  return identity(await lstat(request.name, { bigint: true }));
}

export async function runSecureScaffoldWriterProcess(): Promise<number> {
  try {
    const request = await readRequest();
    await validatePinnedDirectory(request.rootGuard);
    const entered = await enterPinnedParent(
      request.parentParts,
      request.operation === "ensure-parents",
      request.rootGuard.realPath,
    );
    await validateEnteredPath(entered.expectedRealPath);
    if (request.operation === "ensure-parents") {
      console.log(JSON.stringify({ ok: true, directories: entered.directories }));
      return 0;
    }
    validateName(request.name);
    if (request.operation === "create") {
      const createdIdentity = await createFile(request);
      try {
        await validateEnteredPath(entered.expectedRealPath);
      } catch (error) {
        await removeOwnedFile(request.name, createdIdentity);
        throw error;
      }
      console.log(JSON.stringify({ ok: true, identity: createdIdentity }));
      return 0;
    }
    if (request.operation === "remove") {
      await removeOwnedFile(request.name, request.expectedFileIdentity);
      console.log(JSON.stringify({ ok: true }));
      return 0;
    }
    throw new TypeError("invalid-operation");
  } catch (error) {
    const code = error instanceof Deno.errors.AlreadyExists || hasErrorCode(error, "EEXIST")
      ? "already-exists"
      : error instanceof TypeError && error.message === "unsafe-directory"
      ? "unsafe-directory"
      : "filesystem";
    console.log(JSON.stringify({ ok: false, code }));
    return 0;
  }
}

if (import.meta.main) Deno.exit(await runSecureScaffoldWriterProcess());

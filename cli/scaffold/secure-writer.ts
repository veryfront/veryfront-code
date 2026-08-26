/**
 * Internal scaffold writer.
 *
 * The parent starts this process with the validated target directory as its
 * working directory. The process verifies that pinned directory identity, then
 * creates or removes only a validated basename relative to it. A later rename
 * or symlink replacement of the parent path cannot redirect the file operation.
 */

type FileIdentity = {
  dev: number;
  ino: number;
  kind: "directory" | "file" | "symlink" | "other";
  mode?: number | null;
  size?: number;
  mtimeMs?: number | null;
  birthtimeMs?: number | null;
  ctimeMs?: number | null;
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

function identity(info: Deno.FileInfo): FileIdentity {
  if (typeof info.dev !== "number" || typeof info.ino !== "number") return null;
  const kind = info.isDirectory
    ? "directory"
    : info.isFile
    ? "file"
    : info.isSymlink
    ? "symlink"
    : "other";
  if (kind === "directory") return { dev: info.dev, ino: info.ino, kind };
  const time = (value: Date | null | undefined) => value?.getTime() ?? null;
  return {
    dev: info.dev,
    ino: info.ino,
    kind,
    mode: typeof info.mode === "number" ? info.mode : null,
    size: info.size,
    mtimeMs: time(info.mtime),
    birthtimeMs: time(info.birthtime),
    ctimeMs: time(info.ctime),
  };
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
  const current = await Deno.stat(".");
  if (!current.isDirectory || current.isSymlink) throw new TypeError("unsafe-directory");
  const currentIdentity = identity(current);
  if (guard.identity !== null) {
    if (!sameIdentity(currentIdentity, guard.identity)) throw new TypeError("unsafe-directory");
    return;
  }
  if (await Deno.realPath(".") !== guard.realPath) throw new TypeError("unsafe-directory");
}

async function enterPinnedParent(
  parts: unknown,
  createMissing: boolean,
): Promise<CreatedDirectory[]> {
  if (!Array.isArray(parts) || parts.length > 64) throw new TypeError("unsafe-directory");
  const created: CreatedDirectory[] = [];
  const traversed: string[] = [];
  for (const part of parts) {
    validateName(part);
    let before: Deno.FileInfo;
    let createdCurrent = false;
    try {
      before = await Deno.lstat(part);
    } catch (error) {
      if (!createMissing || !(error instanceof Deno.errors.NotFound)) throw error;
      await Deno.mkdir(part);
      before = await Deno.lstat(part);
      createdCurrent = true;
    }
    if (!before.isDirectory || before.isSymlink) throw new TypeError("unsafe-directory");
    const beforeIdentity = identity(before);
    const beforeRealPath = beforeIdentity === null ? await Deno.realPath(part) : null;
    Deno.chdir(part);
    const after = await Deno.stat(".");
    if (!after.isDirectory || after.isSymlink) throw new TypeError("unsafe-directory");
    if (beforeIdentity !== null) {
      if (!sameIdentity(identity(after), beforeIdentity)) throw new TypeError("unsafe-directory");
    } else if (await Deno.realPath(".") !== beforeRealPath) {
      throw new TypeError("unsafe-directory");
    }
    traversed.push(part);
    if (createdCurrent) created.push({ parts: [...traversed], identity: beforeIdentity });
  }
  return created;
}

async function removeOwnedFile(name: string, expected: FileIdentity): Promise<void> {
  if (expected === null) return;
  try {
    const current = identity(await Deno.lstat(name));
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

  const handle = await Deno.open(request.name, { write: true, createNew: true });
  let openedIdentity = identity(await handle.stat());
  try {
    const content = new TextEncoder().encode(request.content);
    let offset = 0;
    while (offset < content.byteLength) {
      const remaining = failAfterBytes === undefined
        ? content.byteLength - offset
        : failAfterBytes - offset;
      if (remaining <= 0) throw new Error("simulated-partial-write-failure");
      const chunk = content.subarray(offset, Math.min(content.byteLength, offset + remaining));
      const written = await handle.write(chunk);
      if (written === 0) throw new Error("write-made-no-progress");
      offset += written;
      openedIdentity = identity(await handle.stat());
      if (failAfterBytes !== undefined && offset >= failAfterBytes) {
        throw new Error("simulated-partial-write-failure");
      }
    }
  } catch (error) {
    handle.close();
    await removeOwnedFile(request.name, openedIdentity);
    throw error;
  } finally {
    try {
      handle.close();
    } catch {
      // The failure path already closed the handle.
    }
  }
  return identity(await Deno.lstat(request.name));
}

export async function runSecureScaffoldWriterProcess(): Promise<number> {
  try {
    const request = await readRequest();
    await validatePinnedDirectory(request.rootGuard);
    const directories = await enterPinnedParent(
      request.parentParts,
      request.operation === "ensure-parents",
    );
    if (request.operation === "ensure-parents") {
      console.log(JSON.stringify({ ok: true, directories }));
      return 0;
    }
    validateName(request.name);
    if (request.operation === "create") {
      const createdIdentity = await createFile(request);
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
    const code = error instanceof Deno.errors.AlreadyExists
      ? "already-exists"
      : error instanceof TypeError && error.message === "unsafe-directory"
      ? "unsafe-directory"
      : "filesystem";
    console.log(JSON.stringify({ ok: false, code }));
    return 0;
  }
}

if (import.meta.main) Deno.exit(await runSecureScaffoldWriterProcess());

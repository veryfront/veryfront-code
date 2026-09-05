import { constants } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

function failure(): Error {
  return new Error(
    "Refusing directory traversal without a stable no-follow handle.",
  );
}

function components(path: string, root: string): string[] {
  if (!isAbsolute(root) || !isAbsolute(path) || root.includes("\0")) throw failure();
  const local = relative(root, path);
  const parts = local === "" ? [] : local.split(sep);
  if (
    isAbsolute(local) ||
    parts.some((part) => !part || part === ".." || part.includes("\0"))
  ) {
    throw failure();
  }
  return parts;
}

/** Enumerate through a directory handle opened beneath the project root. */
export async function* readPinnedDirectory(
  path: string,
  root: string,
): AsyncGenerator<Deno.DirEntry> {
  const parts = components(path, root);
  if (root.includes("\0")) throw failure();
  if (Deno.build.os === "windows") {
    yield* readWindowsDirectory(root, parts);
  } else if (Deno.build.os === "darwin" || Deno.build.os === "linux") {
    yield* readPosixDirectory(root, parts);
  } else {
    throw failure();
  }
}

function openPosixLibrary() {
  const darwin = Deno.build.os === "darwin";
  const inode64Suffix = darwin && Deno.build.arch === "x86_64" ? "$INODE64" : "";
  const library = Deno.dlopen(
    darwin ? "/usr/lib/libSystem.B.dylib" : "libc.so.6",
    {
      open: { parameters: ["buffer", "i32"], result: "i32" },
      openat: { parameters: ["i32", "buffer", "i32"], result: "i32" },
      close: { parameters: ["i32"], result: "i32" },
      errno: { name: darwin ? "__error" : "__errno_location", parameters: [], result: "pointer" },
      pread: { parameters: ["i32", "buffer", "usize", "i64"], result: "isize" },
      pwrite: { parameters: ["i32", "buffer", "usize", "i64"], result: "isize" },
      ftruncate: { parameters: ["i32", "i64"], result: "i32" },
      fstat: {
        name: "fstat" + inode64Suffix,
        parameters: ["i32", "buffer"],
        result: "i32",
        optional: !darwin,
      },
      legacyFstat: {
        name: "__fxstat",
        parameters: ["i32", "i32", "buffer"],
        result: "i32",
        optional: true,
      },
      legacyFstatat: {
        name: "__fxstatat",
        parameters: ["i32", "i32", "buffer", "buffer", "i32"],
        result: "i32",
        optional: true,
      },
      fdopendir: {
        name: "fdopendir" + inode64Suffix,
        parameters: ["i32"],
        result: "pointer",
      },
      readdir_r: {
        name: "readdir_r" + inode64Suffix,
        parameters: ["pointer", "buffer", "buffer"],
        result: "i32",
      },
      closedir: { parameters: ["pointer"], result: "i32" },
      fstatat: {
        name: "fstatat" + inode64Suffix,
        parameters: ["i32", "buffer", "buffer", "i32"],
        result: "i32",
        optional: !darwin,
      },
    },
  );
  // Older glibc exports the versioned entrypoints rather than fstat/fstatat.
  // The x86-64 stat ABI is version 1; the generic AArch64 ABI is version 0.
  const version = Deno.build.arch === "x86_64" ? 1 : 0;
  return {
    close: () => library.close(),
    symbols: {
      ...library.symbols,
      fstat: (fd: number, info: Uint8Array<ArrayBuffer>) =>
        library.symbols.fstat?.(fd, info) ??
          library.symbols.legacyFstat?.(version, fd, info) ?? -1,
      fstatat: (
        fd: number,
        name: Uint8Array<ArrayBuffer>,
        info: Uint8Array<ArrayBuffer>,
        flags: number,
      ) =>
        library.symbols.fstatat?.(fd, name, info, flags) ??
          library.symbols.legacyFstatat?.(version, fd, name, info, flags) ?? -1,
    },
  };
}

function posixError(library: ReturnType<typeof openPosixLibrary>): Error {
  const pointer = library.symbols.errno();
  const code = pointer ? new Deno.UnsafePointerView(pointer).getInt32() : 0;
  if (code === 2) return new Deno.errors.NotFound("File not found");
  if (code === 17) return new Deno.errors.AlreadyExists("File already exists");
  if (code === 13) return new Deno.errors.PermissionDenied("File access denied");
  return failure();
}

function posixSearchFlags(): number {
  // Darwin O_SEARCH (O_EXEC | O_DIRECTORY), Linux O_PATH | O_DIRECTORY.
  // Ancestors need search permission, not permission to list their contents.
  return (Deno.build.os === "darwin" ? 0x40000000 : 0x200000) |
    constants.O_DIRECTORY | constants.O_NOFOLLOW;
}

function* readPosixDirectory(root: string, parts: string[]): Generator<Deno.DirEntry> {
  const darwin = Deno.build.os === "darwin";
  const library = openPosixLibrary();
  const cstring = (value: string) => new TextEncoder().encode(value + "\0");
  const flags = constants.O_RDONLY | constants.O_DIRECTORY |
    constants.O_NOFOLLOW;
  let fd = -1;
  let directory: Deno.PointerValue = null;
  try {
    // O_NOFOLLOW only protects the final component. Pin every ancestor of
    // the project root as well as the paths below it.
    fd = library.symbols.open(cstring("/"), posixSearchFlags());
    if (fd < 0) throw failure();
    for (const part of [...root.split("/").filter(Boolean), ...parts]) {
      const child = library.symbols.openat(fd, cstring(part), posixSearchFlags());
      if (child < 0) throw failure();
      library.symbols.close(fd);
      fd = child;
    }
    const readable = library.symbols.openat(fd, cstring("."), flags);
    if (readable < 0) throw failure();
    library.symbols.close(fd);
    fd = readable;
    directory = library.symbols.fdopendir(fd);
    if (!directory) throw failure();
    // The supported ABIs have directory records smaller than this buffer.
    // readdir_r reports errors directly instead of requiring thread-local errno.
    const entry = new Uint8Array(4096);
    const result = new BigUint64Array(1);
    const view = new DataView(entry.buffer);
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    while (true) {
      result[0] = 0n;
      if (library.symbols.readdir_r(directory, entry, result) !== 0) {
        throw failure();
      }
      if (result[0] === 0n) break;
      const recordLength = view.getUint16(16, true);
      const nameOffset = darwin ? 21 : 19;
      if (recordLength <= nameOffset || recordLength > entry.length) {
        throw failure();
      }
      const end = entry.indexOf(0, nameOffset);
      if (end < nameOffset || end >= recordLength) throw failure();
      const name = decoder.decode(entry.subarray(nameOffset, end));
      if (name === "." || name === "..") continue;
      if (!name || name.includes("/")) throw failure();
      let type = entry[darwin ? 20 : 18];
      if (type === 0) {
        const info = new Uint8Array(256);
        if (
          library.symbols.fstatat(
            fd,
            cstring(name),
            info,
            darwin ? 0x20 : 0x100,
          ) !== 0
        ) throw failure();
        const metadata = new DataView(info.buffer);
        const mode = darwin
          ? metadata.getUint16(4, true)
          : metadata.getUint32(Deno.build.arch === "aarch64" ? 16 : 24, true);
        type = (mode & 0xf000) >>> 12;
      }
      yield {
        name,
        isFile: type === 8,
        isDirectory: type === 4,
        isSymlink: type === 10,
      };
    }
  } finally {
    if (directory) library.symbols.closedir(directory);
    else if (fd >= 0) library.symbols.close(fd);
    library.close();
  }
}

/** Open a POSIX file beneath the root without following any path-component symlink. */
export function openPinnedPosixFile(path: string, root: string, mode: "r" | "r+" | "wx+") {
  const parts = components(path, root);
  const name = parts.pop();
  if (!name || Deno.build.os === "windows") throw failure();
  const library = openPosixLibrary();
  const cstring = (value: string) => new TextEncoder().encode(value + "\0");
  const directoryFlags = posixSearchFlags();
  let directory = -1;
  let fd = -1;
  try {
    directory = library.symbols.open(cstring("/"), directoryFlags);
    if (directory < 0) throw posixError(library);
    for (const part of [...root.split("/").filter(Boolean), ...parts]) {
      const child = library.symbols.openat(directory, cstring(part), directoryFlags);
      if (child < 0) throw posixError(library);
      library.symbols.close(directory);
      directory = child;
    }
    const flags = (mode === "r" ? constants.O_RDONLY : constants.O_RDWR) |
      constants.O_NONBLOCK | constants.O_NOFOLLOW;
    // openat is variadic when creating a file; use a separate fixed binding
    // below so the permission mode is passed with the correct native ABI.
    if (mode === "wx+") {
      const creation = Deno.dlopen(
        Deno.build.os === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6",
        {
          openat: {
            name: Deno.build.os === "darwin" ? "__openat" : "openat",
            parameters: ["i32", "buffer", "i32", "u32"],
            result: "i32",
          },
        },
      );
      try {
        fd = creation.symbols.openat(
          directory,
          cstring(name),
          flags | constants.O_CREAT | constants.O_EXCL,
          0o666,
        );
      } finally {
        creation.close();
      }
    } else fd = library.symbols.openat(directory, cstring(name), flags);
    if (fd < 0) throw posixError(library);
  } catch (error) {
    if (directory >= 0) {
      library.symbols.close(directory);
      directory = -1;
    }
    if (fd >= 0) library.symbols.close(fd);
    library.close();
    throw error;
  } finally {
    if (directory >= 0) library.symbols.close(directory);
  }
  let closed = false;
  const stat = () => {
    if (closed) throw failure();
    const bytes = new Uint8Array(256);
    if (library.symbols.fstat(fd, bytes) !== 0) throw failure();
    const view = new DataView(bytes.buffer);
    const darwin = Deno.build.os === "darwin";
    return {
      dev: darwin ? BigInt(view.getUint32(0, true)) : view.getBigUint64(0, true),
      ino: view.getBigUint64(8, true),
      size: view.getBigInt64(darwin ? 96 : 48, true),
    };
  };
  const read = (
    bytes: Uint8Array<ArrayBuffer>,
    offset: number,
    length: number,
    position: number,
  ) => {
    if (closed) throw failure();
    const count = Number(
      library.symbols.pread(
        fd,
        bytes.subarray(offset, offset + length),
        BigInt(length),
        BigInt(position),
      ),
    );
    if (count < 0 || count > length) throw failure();
    return count;
  };
  return {
    stat: (_options?: { bigint: boolean }) => Promise.resolve(stat()),
    read: (bytes: Uint8Array<ArrayBuffer>, offset: number, length: number, position: number) =>
      Promise.resolve({ bytesRead: read(bytes, offset, length, position) }),
    readFile: (_options: { encoding: "utf8" }) => {
      const size = Number(stat().size);
      if (!Number.isSafeInteger(size) || size < 0) throw failure();
      const bytes = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const count = read(bytes, offset, size - offset, offset);
        if (count === 0) break;
        offset += count;
      }
      return Promise.resolve(
        new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, offset)),
      );
    },
    truncate: (size: number) => {
      if (closed || library.symbols.ftruncate(fd, BigInt(size)) !== 0) throw failure();
      return Promise.resolve();
    },
    write: (bytes: Uint8Array<ArrayBuffer>, offset: number, length: number, position: number) => {
      if (closed) throw failure();
      const count = Number(
        library.symbols.pwrite(
          fd,
          bytes.subarray(offset, offset + length),
          BigInt(length),
          BigInt(position),
        ),
      );
      if (count < 0 || count > length) throw failure();
      return Promise.resolve({ bytesWritten: count });
    },
    close: () => {
      if (!closed) {
        closed = true;
        library.symbols.close(fd);
        library.close();
      }
      return Promise.resolve();
    },
  };
}

function openWindowsLibrary() {
  const nt = Deno.dlopen("ntdll.dll", {
    NtCreateFile: {
      parameters: [
        "buffer",
        "u32",
        "buffer",
        "buffer",
        "pointer",
        "u32",
        "u32",
        "u32",
        "u32",
        "pointer",
        "u32",
      ],
      result: "i32",
    },
    NtClose: { parameters: ["pointer"], result: "i32" },
  });
  const kernel = Deno.dlopen("kernel32.dll", {
    GetFileInformationByHandleEx: {
      parameters: ["pointer", "u32", "buffer", "u32"],
      result: "i32",
    },
    GetLastError: { parameters: [], result: "u32" },
    GetFileInformationByHandle: { parameters: ["pointer", "buffer"], result: "i32" },
  });
  const open = (name: string, parent: Deno.PointerValue, createFile = false): Deno.PointerValue => {
    const encoded = new Uint16Array(name.length + 1);
    for (let index = 0; index < name.length; index++) {
      encoded[index] = name.charCodeAt(index);
    }
    if (name.length * 2 > 65_532) throw failure();
    const unicode = new Uint8Array(16);
    const stringView = new DataView(unicode.buffer);
    stringView.setUint16(0, name.length * 2, true);
    stringView.setUint16(2, encoded.byteLength, true);
    stringView.setBigUint64(
      8,
      Deno.UnsafePointer.value(Deno.UnsafePointer.of(encoded)),
      true,
    );
    const attributes = new Uint8Array(48);
    const attributesView = new DataView(attributes.buffer);
    attributesView.setUint32(0, 48, true);
    attributesView.setBigUint64(
      8,
      parent ? Deno.UnsafePointer.value(parent) : 0n,
      true,
    );
    attributesView.setBigUint64(
      16,
      Deno.UnsafePointer.value(Deno.UnsafePointer.of(unicode)),
      true,
    );
    // OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE. Relative names are resolved
    // beneath the already opened parent; junctions and symlinks are rejected.
    attributesView.setUint32(24, 0x1040, true);
    const result = new BigUint64Array(1);
    const status = new Uint8Array(16);
    const error = nt.symbols.NtCreateFile(
      result,
      0x100081,
      attributes,
      status,
      null,
      0,
      7,
      createFile ? 2 : 1,
      createFile ? 0x200060 : 0x200021,
      null,
      0,
    );
    // Keep the backing buffers reachable throughout the synchronous native call.
    if (
      error !== 0 || encoded.length === 0 || unicode.length === 0 ||
      result[0] === 0n
    ) throw failure();
    const handle = Deno.UnsafePointer.create(result[0]!);
    const tag = new Uint8Array(8);
    if (
      !kernel.symbols.GetFileInformationByHandleEx(
        handle,
        9,
        tag,
        tag.length,
      ) ||
      (new DataView(tag.buffer).getUint32(0, true) & 0x400) !== 0
    ) {
      nt.symbols.NtClose(handle);
      throw failure();
    }
    return handle;
  };
  return { nt, kernel, open };
}

function nativeWindowsRoot(root: string): string {
  const normalized = root.replaceAll("/", "\\").replace(/^\\\\\?\\/, "");
  return normalized.startsWith("\\\\")
    ? "\\??\\UNC\\" + normalized.slice(2)
    : "\\??\\" + normalized;
}

/** Create exclusively relative to a pinned parent, and retain its identity until handoff. */
export function createPinnedWindowsFile(path: string, root: string) {
  const parts = components(path, root);
  const name = parts.pop();
  if (!name || Deno.build.os !== "windows") throw failure();
  const { nt, kernel, open } = openWindowsLibrary();
  let parent: Deno.PointerValue = null;
  let file: Deno.PointerValue = null;
  const close = () => {
    if (file) {
      nt.symbols.NtClose(file);
      file = null;
    }
    if (parent) {
      nt.symbols.NtClose(parent);
      parent = null;
    }
    kernel.close();
    nt.close();
  };
  try {
    parent = open(nativeWindowsRoot(root), null);
    for (const part of parts) {
      const child = open(part, parent);
      nt.symbols.NtClose(parent);
      parent = child;
    }
    file = open(name, parent, true);
    const info = new Uint8Array(52);
    if (!kernel.symbols.GetFileInformationByHandle(file, info)) throw failure();
    const view = new DataView(info.buffer);
    return {
      dev: BigInt(view.getUint32(28, true)),
      ino: (BigInt(view.getUint32(44, true)) << 32n) | BigInt(view.getUint32(48, true)),
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}

function* readWindowsDirectory(root: string, parts: string[]): Generator<Deno.DirEntry> {
  const { nt, kernel, open } = openWindowsLibrary();
  let handle: Deno.PointerValue = null;
  try {
    handle = open(nativeWindowsRoot(root), null);
    for (const part of parts) {
      const child = open(part, handle);
      nt.symbols.NtClose(handle);
      handle = child;
    }
    const buffer = new Uint8Array(64 * 1024);
    const view = new DataView(buffer.buffer);
    const decoder = new TextDecoder("utf-16le", {
      fatal: true,
      ignoreBOM: true,
    });
    while (true) {
      if (
        !kernel.symbols.GetFileInformationByHandleEx(
          handle,
          10,
          buffer,
          buffer.length,
        )
      ) {
        if (kernel.symbols.GetLastError() === 18) break; // ERROR_NO_MORE_FILES
        throw failure();
      }
      let offset = 0;
      while (true) {
        if (offset + 104 > buffer.length) throw failure();
        const next = view.getUint32(offset, true);
        const attributes = view.getUint32(offset + 56, true);
        const length = view.getUint32(offset + 60, true);
        const limit = next === 0 ? buffer.length : offset + next;
        if (
          length % 2 || offset + 104 + length > limit || limit > buffer.length
        ) throw failure();
        const name = decoder.decode(
          buffer.subarray(offset + 104, offset + 104 + length),
        );
        if (name !== "." && name !== "..") {
          if (!name || /[\\/\0]/.test(name)) throw failure();
          const isDirectory = (attributes & 0x10) !== 0;
          const isSymlink = (attributes & 0x400) !== 0;
          yield {
            name,
            isDirectory,
            isSymlink,
            isFile: !isDirectory && !isSymlink,
          };
        }
        if (next === 0) break;
        if (next < 104 || next % 8) throw failure();
        offset += next;
      }
    }
  } finally {
    if (handle) nt.symbols.NtClose(handle);
    kernel.close();
    nt.close();
  }
}

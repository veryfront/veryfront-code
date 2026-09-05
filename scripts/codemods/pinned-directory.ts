import { constants } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

function failure(): Error {
  return new Error(
    "Refusing directory traversal without a stable no-follow handle.",
  );
}

function components(path: string, root: string): string[] {
  if (!isAbsolute(root) || !isAbsolute(path)) throw failure();
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

function* readPosixDirectory(
  root: string,
  parts: string[],
): Generator<Deno.DirEntry> {
  const darwin = Deno.build.os === "darwin";
  const inode64Suffix = darwin && Deno.build.arch === "x86_64" ? "$INODE64" : "";
  const library = Deno.dlopen(
    darwin ? "/usr/lib/libSystem.B.dylib" : "libc.so.6",
    {
      open: { parameters: ["buffer", "i32"], result: "i32" },
      openat: { parameters: ["i32", "buffer", "i32"], result: "i32" },
      close: { parameters: ["i32"], result: "i32" },
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
      },
    },
  );
  const cstring = (value: string) => new TextEncoder().encode(value + "\0");
  const flags = constants.O_RDONLY | constants.O_DIRECTORY |
    constants.O_NOFOLLOW;
  let fd = -1;
  let directory: Deno.PointerValue = null;
  try {
    fd = library.symbols.open(cstring(root), flags);
    if (fd < 0) throw failure();
    for (const part of parts) {
      const child = library.symbols.openat(fd, cstring(part), flags);
      if (child < 0) throw failure();
      library.symbols.close(fd);
      fd = child;
    }
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

function* readWindowsDirectory(
  root: string,
  parts: string[],
): Generator<Deno.DirEntry> {
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
  });
  const open = (name: string, parent: Deno.PointerValue): Deno.PointerValue => {
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
      1,
      0x200021,
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
  let handle: Deno.PointerValue = null;
  try {
    const normalized = root.replaceAll("/", "\\").replace(/^\\\\\?\\/, "");
    const nativeRoot = normalized.startsWith("\\\\")
      ? "\\??\\UNC\\" + normalized.slice(2)
      : "\\??\\" + normalized;
    handle = open(nativeRoot, null);
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

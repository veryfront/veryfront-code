---
title: "veryfront/fs"
description: "Runtime-native filesystem, path, and cwd utilities."
order: 11
---

## Runtime boundary

`veryfront/fs` uses the native process filesystem selected for Deno, Node, or Bun.
It does not delegate to the `runtime.get().fs` adapter. Custom adapters
configured with `runtime.set()` affect adapter-consuming APIs, not these
compatibility functions.

`veryfront/fs` does not add a project-root sandbox, block `.env` or other
secret-file names, or validate paths from untrusted input. Relative paths
resolve from `cwd()`. Absolute paths and `..` segments can reach any location
that the runtime permits.

Runtime permissions remain the outer boundary. Hosted project secrets are
supplied through request-owned environment data rather than `.env` files.
Isolated Pages route `ctx.fs` is a separate, read-only, project-confined
capability. Those protections do not change the contract of `veryfront/fs`.

Canonicalize a trusted root and candidate with `realPath`, then use
`validateLexicalPath` from `veryfront/security` before reading a
user-influenced path. Canonicalization follows existing symlinks before the
containment check.

Path admission is not an operating-system sandbox.
The trusted root must not be writable by untrusted or project code while a
validated path is in use. Otherwise, concurrent filesystem changes can
create a time-of-check/time-of-use race between validation and reading.

## Import

```ts
import { exists, join, mkdir, readTextFile, resolve, writeTextFile } from "veryfront/fs";
```

## Examples

### File operations

```ts
import { exists, mkdir, readTextFile, writeTextFile } from "veryfront/fs";

const data = JSON.parse(await readTextFile("./data/config.json"));
await mkdir("./output", { recursive: true });
await writeTextFile("./output/result.json", JSON.stringify(data));
```

### Path utilities

```ts
import { basename, dirname, extname, join, resolve } from "veryfront/fs";

const filePath = join("src", "pages", "index.tsx");
const dir = dirname(filePath); // "src/pages"
```

### Working directory

```ts
import { cwd, resolve } from "veryfront/fs";

const configPath = resolve(cwd(), "veryfront.config.ts");
```

### Confine an untrusted path

```ts
import { cwd, readTextFile, realPath, resolve } from "veryfront/fs";
import { validateLexicalPath } from "veryfront/security";

const publicFilesDir = await realPath(resolve(cwd(), "public-data"));

export async function readPublicFile(requestedPath: string): Promise<string> {
  const candidate = resolve(publicFilesDir, requestedPath);
  const canonicalPath = await realPath(candidate);
  const admitted = validateLexicalPath(canonicalPath, {
    baseDir: publicFilesDir,
    allowAbsolute: true,
  });
  if (!admitted.valid || !admitted.canonicalPath) {
    throw new Error("Invalid path");
  }
  return await readTextFile(admitted.canonicalPath);
}
```

## Exports

### Functions

| Name                         | Description                                                                                                                                                                                       | Source                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `basename`                   | Return the last path segment.                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L43) |
| `createFileSystem`           | Create the runtime-native filesystem implementation.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L449)                   |
| `cwd`                        | Return the current working directory.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L26)     |
| `dirname`                    | Return the parent directory path.                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L36) |
| `exists`                     | Return false for a missing path and propagate every other filesystem error.                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L525)                   |
| `extname`                    | Return the file extension for a path.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L51) |
| `isFileSnapshotChangedError` | Return whether a value is a framework-created file snapshot change error.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/file-snapshot-error.ts#L32) |
| `isNotFoundError`            |                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/not-found-error.ts#L210)      |
| `join`                       | Join and normalize path segments using their detected path flavor.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L23) |
| `lstat`                      | Read file metadata without following a terminal symbolic link.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L535)                   |
| `mkdir`                      | Create a directory.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L575)                   |
| `readDir`                    | Read directory entries.                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L585)                   |
| `readTextFile`               | Read a file as text.                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L505)                   |
| `realPath`                   | Resolve a path to its canonical absolute form, following symlinks. Throws if the path does not exist. Useful for containment checks where a symlink could otherwise escape an intended directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L621)                   |
| `remove`                     | Remove a file or directory, rejecting when the path does not exist.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L580)                   |
| `resolve`                    | Resolve path segments to an absolute, normalized path.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L24)       |
| `writeTextFile`              | Write text to a file.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L515)                   |

### Classes

| Name                       | Description                                                             | Source                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `FileSnapshotChangedError` | Error raised when a file changes while a stable snapshot is being read. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/file-snapshot-error.ts#L22) |

### Types

| Name         | Description                          | Source                                                                                        |
| ------------ | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `FileSystem` | Runtime-neutral filesystem contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L83) |

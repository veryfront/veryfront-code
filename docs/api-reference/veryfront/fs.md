---
title: "veryfront/fs"
description: "Public filesystem, path, and cwd utilities."
order: 11
---

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

## Exports

### Functions

| Name               | Description                                                                                                                                                                                       | Source                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `basename`         | Return the last path segment.                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L27) |
| `createFileSystem` | Create the runtime-native filesystem implementation.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L382)                   |
| `cwd`              | Return the current working directory.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L26)     |
| `dirname`          | Return the parent directory path.                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L20) |
| `exists`           | Return false for a missing path and propagate every other filesystem error.                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L414)                   |
| `extname`          | Return the file extension for a path.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L35) |
| `isNotFoundError`  | Return whether an error or its cause chain represents a missing path.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L529)                   |
| `join`             | Join and normalize path segments using their detected path flavor.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L12) |
| `lstat`            | Read file metadata without following a terminal symbolic link.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L424)                   |
| `mkdir`            | Create a directory.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L464)                   |
| `readDir`          | Read directory entries.                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L474)                   |
| `readTextFile`     | Read a file as text.                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L394)                   |
| `realPath`         | Resolve a path to its canonical absolute form, following symlinks. Throws if the path does not exist. Useful for containment checks where a symlink could otherwise escape an intended directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L510)                   |
| `remove`           | Remove a file or directory, rejecting when the path does not exist.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L469)                   |
| `resolve`          | Resolve path segments to an absolute, normalized path.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L12)       |
| `writeTextFile`    | Write text to a file.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L404)                   |

### Types

| Name         | Description                          | Source                                                                                        |
| ------------ | ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `FileSystem` | Runtime-neutral filesystem contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L60) |

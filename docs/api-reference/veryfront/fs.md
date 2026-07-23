---
title: "veryfront/fs"
description: "Public filesystem, path, and cwd utilities."
order: 10
---

## Import

```ts
import {
  readTextFile,
  writeTextFile,
  join,
  resolve,
  exists,
  mkdir,
} from "veryfront/fs";
```

## Examples

### File operations

```ts
import { mkdir, readTextFile, writeTextFile } from "veryfront/fs";

await mkdir("./output", { recursive: true });
await writeTextFile("./output/result.json", '{"ok":true}\n');
const content = await readTextFile("./output/result.json");
console.log(content);
```

### Path utilities

```ts
import { join, resolve, dirname, basename, extname } from "veryfront/fs";

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

| Name | Description | Source |
|------|-------------|--------|
| `basename` | Return the last path segment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L26) |
| `createFileSystem` | Create a filesystem implementation for the active runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L338) |
| `cwd` | Return the current working directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L21) |
| `dirname` | Return the parent directory path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L10) |
| `exists` | Check whether a path exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L370) |
| `extname` | Return the file extension for a path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L45) |
| `isNotFoundError` | Return whether an unknown error represents a missing path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L470) |
| `join` | Join path segments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L4) |
| `lstat` | Read file metadata without following a terminal symbolic link. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L380) |
| `mkdir` | Create a directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L387) |
| `readDir` | Read directory entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L397) |
| `readTextFile` | Read a file as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L350) |
| `realPath` | Resolve a path to its canonical absolute form, following symlinks. Throws if the path does not exist. Useful for containment checks where a symlink could otherwise escape an intended directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L437) |
| `remove` | Remove a file or directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L392) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L9) |
| `writeTextFile` | Write text to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L360) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `FileInfo` | Portable metadata returned for a filesystem path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L208) |
| `FileSystem` | Public API contract for file system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L19) |

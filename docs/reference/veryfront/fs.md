---
title: "veryfront/fs"
description: "Public filesystem, path, and cwd utilities."
order: 21
---

# veryfront/fs

Public filesystem, path, and cwd utilities.

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
import { exists, mkdir, readTextFile, writeTextFile } from "veryfront/fs";

const content = await readTextFile("./data/config.json");
await writeTextFile("./output/result.json", JSON.stringify(data));
await mkdir("./output", { recursive: true });
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
| `basename` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L32) |
| `createFileSystem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L258) |
| `cwd` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L17) |
| `dirname` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L22) |
| `exists` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L285) |
| `extname` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L51) |
| `join` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L11) |
| `mkdir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L293) |
| `readDir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L301) |
| `readTextFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L269) |
| `remove` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L297) |
| `resolve` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L14) |
| `writeTextFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L277) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `FileSystem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L4) |

## Related

Reference modules:

- [`veryfront`](./index.md): Core framework configuration and utilities
- [`veryfront/agent`](./agent.md): Agents that may use filesystem for persistence

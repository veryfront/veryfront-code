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

| Name | Description |
|------|-------------|
| `basename` | Get filename of path |
| `createFileSystem` | Create platform-agnostic FS |
| `cwd` | Get project root |
| `dirname` | Get directory of path |
| `exists` | Check path exists |
| `extname` | Get file extension |
| `join` | Join path segments |
| `mkdir` | Create directory (recursive supported) |
| `readDir` | List directory entries |
| `readTextFile` | Read file as UTF-8 |
| `remove` | Delete file or directory |
| `resolve` | Resolve to absolute path |
| `writeTextFile` | Write UTF-8 to file |

### Types

| Name | Description |
|------|-------------|
| `FileSystem` | Filesystem interface |

## Related

Reference modules:

- [`veryfront`](./index.md): Core framework configuration and utilities
- [`veryfront/agent`](./agent.md): Agents that may use filesystem for persistence

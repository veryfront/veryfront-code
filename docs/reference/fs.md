---
title: "veryfront/fs"
description: "Filesystem operations and path utilities."
order: 18
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
import { readTextFile, writeTextFile, mkdir, exists } from "veryfront/fs";

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

- [`veryfront`](./root.md) — Core framework configuration and utilities
- [`veryfront/agent`](./agent.md) — Agents that may use filesystem for persistence

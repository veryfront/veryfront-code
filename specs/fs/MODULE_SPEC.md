# NLSpec: src/fs/

## Purpose
Public surface for filesystem operations, path utilities, and project context (cwd). Pure barrel module that re-exports from the platform compatibility layer.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `createFileSystem` | function | Creates a filesystem abstraction instance |
| `readTextFile` | function | Reads a file as UTF-8 text |
| `writeTextFile` | function | Writes UTF-8 text to a file |
| `mkdir` | function | Creates a directory (supports recursive) |
| `exists` | function | Checks if a path exists |
| `remove` | function | Removes a file or directory |
| `readDir` | function | Lists directory entries |
| `FileSystem` | type | Filesystem abstraction interface |
| `basename` | function | Returns the last portion of a path |
| `dirname` | function | Returns the directory portion of a path |
| `extname` | function | Returns the file extension |
| `join` | function | Joins path segments |
| `resolve` | function | Resolves path segments to an absolute path |
| `cwd` | function | Returns the current working directory |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| FS operations | `#veryfront/platform/compat/fs.ts` | Filesystem abstraction |
| Path basics | `#veryfront/platform/compat/path/basic-operations.ts` | Path manipulation |
| Path resolve | `#veryfront/platform/compat/path/resolution.ts` | Path resolution |
| Process | `#veryfront/platform/compat/process.ts` | CWD access |

## Behaviors

### Behavior 1: Pure re-export barrel
- **Given**: Any consumer imports from `veryfront/fs`
- **When**: The import is resolved
- **Then**: The export is forwarded from the platform compat layer with no transformation
- **Edge cases**: None — no logic in this module

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/fs/
- This is a barrel-only module — refactoring scope is limited to export hygiene

## Error Handling
- None — all error handling is delegated to the platform compat layer

## Side Effects
- None in this module (side effects are in the re-exported implementations)

## Performance Constraints
- None

## Invariants
- Every export must map to exactly one re-export from the platform compat layer
- No logic, transformations, or wrappers should exist in this module

---
title: "veryfront/platform"
description: "Cross-runtime abstraction layer - adapter detection, process/env/signal compat, filesystem and KV abstractions for Deno, Node.js, and Bun."
order: 24
---

## Import

```ts
import {
  createEscapeBuffer,
  createFileSystem,
  createFSAdapter,
  createInMemoryHostRuntime,
  createKVStore,
  createMockAdapter,
} from "veryfront/platform";
```

## Examples

### Inspect the current runtime

```ts
import { getOsType, getRuntimeVersion } from "veryfront/platform";

console.log(`${getOsType()} ${getRuntimeVersion()}`);
```

## Exports

### Functions

| Name                        | Description                                                                                                                                                                                                             | Source                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `createEscapeBuffer`        | Create an escape sequence buffer.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts)                |
| `createFileSystem`          | Create the runtime-native filesystem implementation.                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |
| `createFSAdapter`           |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/factory.ts)         |
| `createInMemoryHostRuntime` | The test adapter: an isolated env map, a fixed cwd and argv, recorded exits, and signal subscribers a test fires with `emitSignal`. Two instances never share state, and nothing here reads or writes the real process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts) |
| `createKVStore`             | Create a cross-runtime KV store.                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts)           |
| `createMockAdapter`         |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/mock.ts)               |
| `cwd`                       | Return the current working directory.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `enhanceAdapterWithFS`      |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/integration.ts)     |
| `execPath`                  | Get the executable path of the current runtime                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `exists`                    | Return false for a missing path and propagate every other filesystem error.                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |
| `getArgs`                   | Get command-line arguments (cross-runtime: Deno.args or process.argv).                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `getEnv`                    | Read an environment variable from the active project scope.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts)          |
| `getOsType`                 | Get the operating system type Returns: "darwin" (macOS), "linux", "windows", or the raw platform string                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `getRuntimeVersion`         | Get runtime version string                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `getStdinReader`            | Get a reader for stdin (for raw mode character reading) Returns an object with read() and releaseLock() methods                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts)                |
| `getStdout`                 | Get stdout stream for writing Returns null if not available (e.g., in browser/workers)                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `getTerminalSize`           | Get terminal size (columns and rows) Returns default fallback values if terminal size cannot be determined                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `isExtendedFSAdapter`       |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/wrapper.ts)         |
| `isHostExit`                | Return whether a value is an exit raised by an in-memory host.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts) |
| `isInteractive`             | Check if stdin is a TTY (terminal)                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `isNotFoundError`           |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/not-found-error.ts)      |
| `isStdoutTTY`               | Check if stdout is a TTY (terminal)                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `lookupMimeType`            |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/media-types.ts)          |
| `mkdir`                     | Create a directory.                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |
| `promptSync`                | Synchronous prompt function that works across Deno and Bun. Displays a message and reads user input from stdin.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `readDir`                   | Read directory entries.                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |
| `readStdinByteSync`         | Read a single byte from stdin synchronously. Requires raw mode to be enabled for character-by-character reading. Returns null on EOF or if stdin is not available.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `readStdinLine`             | Read one line from stdin and release the reader when complete.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts)                |
| `readTextFile`              | Read a file as text.                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |
| `remove`                    | Remove a file or directory, rejecting when the path does not exist.                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |
| `resolveHostAddresses`      |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/dns.ts)                  |
| `setRawMode`                | Set raw mode on stdin (enables character-by-character input)                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts)                |
| `writeStdout`               | Write text directly to stdout (sync) No-op if stdout is not available                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `writeStdoutAsync`          | Write data to stdout asynchronously Returns a promise that resolves when the write is complete                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts)    |
| `writeTextFile`             | Write text to a file.                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |

### Classes

| Name                 | Description                                                                                                                            | Source                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `HostExit`           | Thrown by an in-memory host's `exit` so the calling code stops where the real process would have ended. Identify it with `isHostExit`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts)          |
| `MemoryKv`           |                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/memory-adapter.ts)             |
| `VeryfrontApiClient` |                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/client.ts) |
| `VeryfrontFSAdapter` |                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/veryfront/adapter.ts)        |

### Types

| Name                          | Description                                                                                                                                                   | Source                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CommandResult`               |                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/command.ts)      |
| `FileSystem`                  | Runtime-neutral filesystem contract.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                   |
| `HostRuntime`                 | The process a unit of framework code runs in, as seen by that code.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts) |
| `HostRuntimeEnv`              | Environment access through a host. Structurally a superset of `EnvironmentAdapter` in `platform/adapters/base.ts`, so a host env satisfies that contract too. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts) |
| `HostSignal`                  | Signals a host can deliver to a subscriber.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts) |
| `InMemoryHostRuntime`         | The in-memory adapter, with the hooks a test needs to observe and drive it.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts) |
| `InMemoryHostRuntimeInit`     | Initial state for `createInMemoryHostRuntime`. Everything is optional.                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts) |
| `ResolveHostAddressesOptions` |                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/dns.ts)                  |
| `RuntimeAdapter`              | Core runtime adapter interface                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts)               |
| `StdinReader`                 | Stdin reader interface for cross-runtime compatibility                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts)                |

### Constants

| Name     | Description                                                      | Source                                                                                         |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `isDeno` | True if running in the real Deno runtime rather than a dnt shim. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/platform/env`

Public environment facade for the `veryfront/platform/env` subpath. Exposes only project-scoped readers. Privileged or mutating accessors (`getHostEnv`, `env`, `setEnv`, `deleteEnv`) stay internal so a tenant project cannot read or alter the host process environment through a supported package export.

```ts
import { getEnv, getEnvBoolean, getEnvNumber } from "veryfront/platform/env";
```

#### Functions

| Name            | Description                                                 | Source                                                                                             |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `getEnv`        | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts) |
| `getEnvBoolean` |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts) |
| `getEnvNumber`  |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts) |
| `getEnvString`  |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts) |

#### Types

| Name                | Description | Source                                                                                             |
| ------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| `EnvBooleanOptions` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts) |

### `veryfront/platform/path`

Compat - Path

```ts
import { basename, dirname, extname } from "veryfront/platform/path";
```

#### Components

| Name        | Description | Source                                                                                              |
| ----------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `SEPARATOR` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts) |

#### Functions

| Name                   | Description                                                        | Source                                                                                                       |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `basename`             | Return the last path segment.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts) |
| `dirname`              | Return the parent directory path.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts) |
| `extname`              | Return the file extension for a path.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts) |
| `format`               |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/parse-format.ts)     |
| `fromFileUrl`          | Convert a file URL to a runtime-native filesystem path.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/url-conversion.ts)   |
| `isAbsolute`           |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts)       |
| `join`                 | Join and normalize path segments using their detected path flavor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts) |
| `normalize`            |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts)       |
| `parse`                |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/parse-format.ts)     |
| `relative`             |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts)       |
| `resolve`              | Resolve path segments to an absolute, normalized path.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts)       |
| `toFileUrl`            |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/url-conversion.ts)   |
| `validatePathSecurity` |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/security.ts)         |

#### Types

| Name             | Description                                                        | Source                                                                                            |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `NodePathModule` |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/types.ts) |
| `PathObject`     |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/types.ts) |
| `PosixPath`      | Dependency-free POSIX path operations for every supported runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/posix.ts) |

#### Constants

| Name          | Description | Source                                                                                              |
| ------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `delimiter`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts) |
| `hasNodePath` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts) |
| `isDeno`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts) |
| `nodePath`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts) |
| `posix`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/posix.ts)   |
| `sep`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts) |

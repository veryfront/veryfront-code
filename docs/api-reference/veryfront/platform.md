---
title: "veryfront/platform"
description: "Cross-runtime abstraction layer - adapter detection, process/env/signal compat, filesystem and KV abstractions for Deno, Node.js, and Bun."
order: 24
---

## Import

```ts
import {
  chdir,
  createEscapeBuffer,
  createFileSystem,
  createFSAdapter,
  createInMemoryHostRuntime,
  createKVStore,
} from "veryfront/platform";
```

## Exports

### Functions

| Name                        | Description                                                                                                                                                                                                             | Source                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `chdir`                     |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L33)     |
| `createEscapeBuffer`        | Create an escape sequence buffer.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L291)                |
| `createFileSystem`          | Create the runtime-native filesystem implementation.                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L449)                   |
| `createFSAdapter`           |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/factory.ts#L6)           |
| `createInMemoryHostRuntime` | The test adapter: an isolated env map, a fixed cwd and argv, recorded exits, and signal subscribers a test fires with `emitSignal`. Two instances never share state, and nothing here reads or writes the real process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L126) |
| `createKVStore`             | Create a cross-runtime KV store.                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L82)            |
| `createMockAdapter`         |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/mock.ts#L133)               |
| `cwd`                       | Return the current working directory.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L26)     |
| `deleteEnv`                 | Delete a process environment variable.                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L338)          |
| `enhanceAdapterWithFS`      |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/integration.ts#L64)      |
| `env`                       | Read and write process environment variables.                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L62)           |
| `execPath`                  | Get the executable path of the current runtime                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L332)    |
| `exists`                    | Return false for a missing path and propagate every other filesystem error.                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L522)                   |
| `exit`                      | Exit the process with an optional code (cross-runtime: Deno.exit or process.exit).                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L18)     |
| `getAdapter`                | Get the runtime adapter for the current environment                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/detect.ts#L24)              |
| `getArgs`                   | Get command-line arguments (cross-runtime: Deno.args or process.argv).                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L10)     |
| `getDenoRuntime`            |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L33)               |
| `getEnv`                    | Read an environment variable from the active project scope.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L229)          |
| `getLocalAdapter`           |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/registry.ts#L230)           |
| `getOsType`                 | Get the operating system type Returns: "darwin" (macOS), "linux", "windows", or the raw platform string                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L164)    |
| `getRuntimeVersion`         | Get runtime version string                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L150)    |
| `getStdinReader`            | Get a reader for stdin (for raw mode character reading) Returns an object with read() and releaseLock() methods                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L187)                |
| `getStdout`                 | Get stdout stream for writing Returns null if not available (e.g., in browser/workers)                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L360)    |
| `getTerminalSize`           | Get terminal size (columns and rows) Returns default fallback values if terminal size cannot be determined                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L124)    |
| `isExtendedFSAdapter`       |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/wrapper.ts#L119)         |
| `isHostExit`                | Return whether a value is an exit raised by an in-memory host.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L95)  |
| `isInteractive`             | Check if stdin is a TTY (terminal)                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L103)    |
| `isNotFoundError`           |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/not-found-error.ts#L210)      |
| `isStdoutTTY`               | Check if stdout is a TTY (terminal)                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L113)    |
| `liveHostRuntime`           | The production adapter: every member delegates to the compat functions, so behaviour is identical to calling them directly.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L60)  |
| `lookupMimeType`            |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/media-types.ts#L21)           |
| `mkdir`                     | Create a directory.                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L572)                   |
| `onGlobalError`             | Register global error handlers for uncaught exceptions and unhandled promise rejections. These handlers prevent the process from crashing due to application code errors.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L259)    |
| `onSignal`                  | Register a SIGINT or SIGTERM handler for graceful shutdown.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L184)    |
| `promptSync`                | Synchronous prompt function that works across Deno and Bun. Displays a message and reads user input from stdin.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L409)    |
| `readDir`                   | Read directory entries.                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L582)                   |
| `readStdinByteSync`         | Read a single byte from stdin synchronously. Requires raw mode to be enabled for character-by-character reading. Returns null on EOF or if stdin is not available.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L472)    |
| `readStdinLine`             | Read one line from stdin and release the reader when complete.                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L212)                |
| `readTextFile`              | Read a file as text.                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L502)                   |
| `remove`                    | Remove a file or directory, rejecting when the path does not exist.                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L577)                   |
| `resolveHostAddresses`      |                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/dns.ts#L292)                  |
| `runCommand`                | Run a command and return the result. Works across Deno, Node.js, and Bun.                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/command.ts#L449)      |
| `setEnv`                    | Sets env.                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L309)          |
| `setRawMode`                | Set raw mode on stdin (enables character-by-character input)                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L55)                 |
| `writeStdout`               | Write text directly to stdout (sync) No-op if stdout is not available                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L377)    |
| `writeStdoutAsync`          | Write data to stdout asynchronously Returns a promise that resolves when the write is complete                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L385)    |
| `writeTextFile`             | Write text to a file.                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L512)                   |

### Classes

| Name                 | Description                                                                                                                            | Source                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `HostExit`           | Thrown by an in-memory host's `exit` so the calling code stops where the real process would have ended. Identify it with `isHostExit`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L83)          |
| `MemoryKv`           |                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/memory-adapter.ts#L27)             |
| `VeryfrontApiClient` |                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/client.ts#L38) |
| `VeryfrontFSAdapter` |                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/veryfront/adapter.ts#L121)       |

### Types

| Name                          | Description                                                                                                                                                   | Source                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CommandResult`               |                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/command.ts#L12)       |
| `FileSystem`                  | Runtime-neutral filesystem contract.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L83)                    |
| `HostRuntime`                 | The process a unit of framework code runs in, as seen by that code.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L38)  |
| `HostRuntimeEnv`              | Environment access through a host. Structurally a superset of `EnvironmentAdapter` in `platform/adapters/base.ts`, so a host env satisfies that contract too. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L29)  |
| `HostSignal`                  | Signals a host can deliver to a subscriber.                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L22)  |
| `InMemoryHostRuntime`         | The in-memory adapter, with the hooks a test needs to observe and drive it.                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L107) |
| `InMemoryHostRuntimeInit`     | Initial state for `createInMemoryHostRuntime`. Everything is optional.                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/host-runtime.ts#L100) |
| `ResolveHostAddressesOptions` |                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/dns.ts#L35)                   |
| `RuntimeAdapter`              | Core runtime adapter interface                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L14)                |
| `StdinReader`                 | Stdin reader interface for cross-runtime compatibility                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L72)                 |

### Constants

| Name      | Description                                                      | Source                                                                                                 |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `isDeno`  | True if running in the real Deno runtime rather than a dnt shim. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L103)    |
| `runtime` |                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/registry.ts#L226) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/platform/env`

Public environment facade for the `veryfront/platform/env` subpath. Exposes only project-scoped readers. Privileged or mutating accessors (`getHostEnv`, `env`, `setEnv`, `deleteEnv`) stay internal so a tenant project cannot read or alter the host process environment through a supported package export.

```ts
import { getEnv, getEnvBoolean, getEnvNumber } from "veryfront/platform/env";
```

#### Functions

| Name            | Description                                                 | Source                                                                                                  |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getEnv`        | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L229) |
| `getEnvBoolean` |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L283) |
| `getEnvNumber`  |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L269) |
| `getEnvString`  |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L261) |

#### Types

| Name                | Description | Source                                                                                                  |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `EnvBooleanOptions` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L246) |

### `veryfront/platform/path`

Compat - Path

```ts
import { basename, dirname, extname } from "veryfront/platform/path";
```

#### Components

| Name        | Description | Source                                                                                                  |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `SEPARATOR` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L25) |

#### Functions

| Name                   | Description                                                        | Source                                                                                                           |
| ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `basename`             | Return the last path segment.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L43) |
| `dirname`              | Return the parent directory path.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L36) |
| `extname`              | Return the file extension for a path.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L51) |
| `format`               |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/parse-format.ts#L26)     |
| `fromFileUrl`          | Convert a file URL to a runtime-native filesystem path.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/url-conversion.ts#L41)   |
| `isAbsolute`           |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L32)       |
| `join`                 | Join and normalize path segments using their detected path flavor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L23) |
| `normalize`            |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L49)       |
| `parse`                |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/parse-format.ts#L11)     |
| `relative`             |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L40)       |
| `resolve`              | Resolve path segments to an absolute, normalized path.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L24)       |
| `toFileUrl`            |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/url-conversion.ts#L67)   |
| `validatePathSecurity` |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/security.ts#L3)          |

#### Types

| Name             | Description                                                        | Source                                                                                                |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `NodePathModule` |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/types.ts#L24) |
| `PathObject`     |                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/types.ts#L1)  |
| `PosixPath`      | Dependency-free POSIX path operations for every supported runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/posix.ts#L3)  |

#### Constants

| Name          | Description | Source                                                                                                  |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `delimiter`   |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L26) |
| `hasNodePath` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L27) |
| `isDeno`      |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L6)  |
| `nodePath`    |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L8)  |
| `posix`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/posix.ts#L224)  |
| `sep`         |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L25) |

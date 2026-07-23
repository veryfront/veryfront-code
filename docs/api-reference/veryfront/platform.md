---
title: "veryfront/platform"
description: "Cross-runtime abstraction layer for adapter detection, process/env/signal compat, filesystem and KV abstractions for Deno, Node.js, Bun, and Cloudflare Workers."
order: 21
---

## Import

```ts
import {
  chdir,
  createCloudflareAdapter,
  createEscapeBuffer,
  createFileSystem,
  createFSAdapter,
  createKVStore,
} from "veryfront/platform";
```

## Examples

### Detect and access the current runtime

```ts
import { detectRuntimeEnvironment, runtime } from "veryfront/platform";

const adapter = await runtime.get();
console.log(detectRuntimeEnvironment(), adapter.id);
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_VERYFRONT_API_REQUEST_POLICY` | Default lifecycle and response limits for Veryfront API operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/retry-handler.ts#L48) |
| `KV_PORTABLE_LIMITS` | Limits shared by every Veryfront KV adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/types.ts#L2) |
| `RELEASE_ASSET_MAX_SIZE_BYTES` | Maximum body size accepted by the release asset upload endpoint (10 MiB). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/types.ts#L53) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `chdir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L28) |
| `createCloudflareAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/adapter.ts#L71) |
| `createEscapeBuffer` | Create an escape sequence buffer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L622) |
| `createFileSystem` | Create a filesystem implementation for the active runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L338) |
| `createFSAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/factory.ts#L297) |
| `createKVStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L264) |
| `createKVStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L266) |
| `createKVStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L268) |
| `createKVStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L269) |
| `createMockAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/mock.ts#L19) |
| `createWorker` | Create a Workers fetch handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/worker.ts#L39) |
| `cwd` | Return the current working directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L21) |
| `deleteEnv` | Delete a process environment variable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L231) |
| `detectRuntimeEnvironment` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L91) |
| `enhanceAdapterWithFS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/integration.ts#L91) |
| `env` | Read and write process environment variables. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L32) |
| `exists` | Check whether a path exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L370) |
| `exit` | Exit the process with an optional code (cross-runtime: Deno.exit or process.exit). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L13) |
| `getAdapter` | Get the runtime adapter for the current environment | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/detect.ts#L26) |
| `getArgs` | Get command-line arguments (cross-runtime: Deno.args or process.argv). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L5) |
| `getDenoRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L95) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L119) |
| `getLocalAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/registry.ts#L379) |
| `getOsType` | Get the operating system type Returns: "darwin" (macOS), "linux", "windows", or the raw platform string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L137) |
| `getRuntimeVersion` | Get runtime version string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L122) |
| `getStdinReader` | Get a reader for stdin (for raw mode character reading) Returns an object with read() and releaseLock() methods | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L524) |
| `getStdout` | Get stdout stream for writing Returns null if not available (e.g., in browser/workers) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L333) |
| `getTerminalSize` | Get terminal size (columns and rows) Returns default fallback values if terminal size cannot be determined | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L92) |
| `isExtendedFSAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/wrapper.ts#L47) |
| `isInteractive` | Check if stdin is a TTY (terminal) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L71) |
| `isStdoutTTY` | Check if stdout is a TTY (terminal) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L81) |
| `lookupMimeType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/media-types.ts#L53) |
| `mkdir` | Create a directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L387) |
| `onGlobalError` | Register global error handlers for uncaught exceptions and unhandled promise rejections. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L177) |
| `onSignal` | Register a signal handler (SIGINT, SIGTERM) for graceful shutdown | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L151) |
| `polyfillDenoKv` | Install Veryfront's string-key, JSON-value KV subset as `Deno.openKv`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L300) |
| `promptSync` | Synchronous prompt function that works across Deno and Bun. Displays a message and reads user input from stdin. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L382) |
| `readDir` | Read directory entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L397) |
| `readStdinByteSync` | Read a single byte from stdin synchronously. Requires raw mode to be enabled for character-by-character reading. Returns null on EOF or if stdin is not available. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L392) |
| `readTextFile` | Read a file as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L350) |
| `remove` | Remove a file or directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L392) |
| `resolveHostAddresses` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/dns.ts#L243) |
| `runCommand` | Run a command and return the result. Works across Deno, Node.js, and Bun. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/command.ts#L349) |
| `setEnv` | Sets env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L211) |
| `setRawMode` | Set raw mode on stdin (enables character-by-character input) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L177) |
| `writeStdout` | Write text directly to stdout (sync) No-op if stdout is not available | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L350) |
| `writeStdoutAsync` | Write data to stdout asynchronously Returns a promise that resolves when the write is complete | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L358) |
| `writeTextFile` | Write text to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L360) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryKv` | Bounded in-memory implementation of the portable Veryfront KV contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/memory-adapter.ts#L15) |
| `VeryfrontApiClient` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/client.ts#L258) |
| `VeryfrontFSAdapter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/fs/veryfront/adapter.ts#L109) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CloudflareAdapterOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/adapter.ts#L18) |
| `CloudflareEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/types.ts#L90) |
| `CloudflareExecutionContext` | Cloudflare Workers execution context. Defined locally to keep adapters module isolated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/worker.ts#L9) |
| `CloudflarePipelineSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/worker.ts#L27) |
| `CloudflareRequestPipeline` | Structural request-pipeline contract accepted by Cloudflare workers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/worker.ts#L19) |
| `CloudflareWorker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/worker.ts#L14) |
| `CommandOptions` | Options for executing a bounded cross-runtime child command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/command.ts#L20) |
| `CommandResult` | Result of a cross-runtime child command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/command.ts#L6) |
| `CreateKVStoreOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L28) |
| `DetectedRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L1) |
| `DnsAddressRecordType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/dns.ts#L9) |
| `FileSystem` | Public API contract for file system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L19) |
| `Kv` | Portable key-value operations shared by every Veryfront KV adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/types.ts#L54) |
| `KvBackend` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/factory.ts#L19) |
| `KvEntry` | A versioned entry returned by a Veryfront KV list operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/types.ts#L28) |
| `KvJsonValue` | A value that every Veryfront KV adapter stores without type or value loss. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/types.ts#L19) |
| `KvListOptions` | Selection and work limits for a bounded Veryfront KV list operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/kv/types.ts#L35) |
| `KVNamespace` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/runtime/cloudflare/types.ts#L68) |
| `ListAllFilesOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/operations.ts#L129) |
| `ResolveHostAddressesOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/dns.ts#L11) |
| `RuntimeAdapter` | Core runtime adapter interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L12) |
| `RuntimeRequestHandler` | Request handler accepted by runtime server adapters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L116) |
| `RuntimeResponse` | Response values a runtime server can return from a request handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L113) |
| `ServeOptions` | Options for starting and stopping a runtime HTTP server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L144) |
| `Server` | A running runtime server with an idempotent asynchronous stop operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L157) |
| `StdinReader` | Stdin reader interface for cross-runtime compatibility | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/stdin.ts#L193) |
| `VeryfrontAPIConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/types.ts#L55) |
| `VeryfrontAPIRequestIdentity` | Immutable authorization and routing data for one request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/types.ts#L28) |
| `VeryfrontAPIRequestPolicy` | Lifecycle and response limits for one logical Veryfront API operation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-client/types.ts#L41) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `isBun` | True if running in Bun. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L139) |
| `isCloudflare` | True if running in Cloudflare Workers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L148) |
| `isDeno` | True if running in native Deno rather than a compatibility shim. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L145) |
| `isNode` | True if running in Node.js. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L142) |
| `runtime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/registry.ts#L375) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/platform/http`

Compat - Http

```ts
import { badGateway, badRequest, convertNodeRequestToWebRequest } from "veryfront/platform/http";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `HttpStatus` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L1) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `badGateway` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L144) |
| `badRequest` | Create a 400 Bad Request response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L125) |
| `convertNodeRequestToWebRequest` | Convert a Node `http.IncomingMessage` into a WHATWG `Request`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/request-adapter.ts#L18) |
| `created` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L173) |
| `createHttpServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/factory.ts#L6) |
| `errorResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L46) |
| `forbidden` | Create a 403 Forbidden response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L135) |
| `internalServerError` | Create a 500 Internal Server Error response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L140) |
| `isWebSocketUpgrade` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/websocket.ts#L20) |
| `jsonErrorResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L190) |
| `jsonResponse` | Create a JSON response with the correct content type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L67) |
| `methodNotAllowed` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L152) |
| `noContent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L185) |
| `notFound` | Create a 404 Not Found response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L120) |
| `ok` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L165) |
| `redirectResponse` | Create an HTTP redirect response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L98) |
| `serviceUnavailable` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L148) |
| `unauthorized` | Create a 401 Unauthorized response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L130) |
| `upgradeWebSocket` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/websocket.ts#L6) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `DenoHttpServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/deno-server.ts#L7) |
| `NodeHttpServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/node-server.ts#L107) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `Handler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/types.ts#L8) |
| `HttpServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/types.ts#L10) |
| `HttpStatusCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/responses.ts#L24) |
| `NodeHttpModule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/node-types.ts#L42) |
| `NodeIncomingMessage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/node-types.ts#L1) |
| `NodeServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/node-types.ts#L35) |
| `NodeServerResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/node-types.ts#L16) |
| `NodeUrlModule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/node-types.ts#L48) |
| `ServeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/types.ts#L1) |
| `WebSocketUpgradeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/types.ts#L20) |
| `WebSocketUpgradeResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/http/types.ts#L15) |

### `veryfront/platform/path`

Compat - Path

```ts
import { basename, dirname, extname } from "veryfront/platform/path";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `SEPARATOR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L38) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `basename` | Return the last path segment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L26) |
| `dirname` | Return the parent directory path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L10) |
| `extname` | Return the file extension for a path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L45) |
| `format` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/parse-format.ts#L20) |
| `fromFileUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/url-conversion.ts#L4) |
| `isAbsolute` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L24) |
| `join` | Join path segments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/basic-operations.ts#L4) |
| `normalize` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L56) |
| `parse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/parse-format.ts#L5) |
| `relative` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L28) |
| `resolve` | Resolve path segments to an absolute path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/resolution.ts#L9) |
| `toFileUrl` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/url-conversion.ts#L27) |
| `validatePathSecurity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/security.ts#L7) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `NodePathModule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/types.ts#L9) |
| `PathObject` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/types.ts#L1) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `delimiter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L39) |
| `hasNodePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L40) |
| `isDeno` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L12) |
| `nodePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L14) |
| `sep` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/path/runtime.ts#L38) |

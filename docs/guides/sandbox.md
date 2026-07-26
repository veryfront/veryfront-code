---
title: "Sandbox"
description: "Run isolated commands and file operations in ephemeral sandbox sessions."
order: 36
---

A sandbox is a short-lived, isolated workspace for executing commands and file operations away from your app process. Use it for code generation, repo inspection, file transformation, or script execution that you do not want to run in your trusted runtime.

The sandbox client talks to an authenticated sandbox session API. You need either Veryfront Cloud credentials or your own compatible backing service for `/sandbox-sessions`.

## Prerequisites

- A sandbox API base URL in `VERYFRONT_API_URL` or the `apiUrl` option. The
  client does not guess or silently default to a production endpoint.
- A Veryfront Cloud token (`VERYFRONT_API_TOKEN`), request-scoped Veryfront
  credentials, or an `authToken` option accepted by your backing service.
- A reachable network from the process that calls `Sandbox.create()`.

## Create a sandbox session

Use `Sandbox.create()` with sandbox API credentials. In local development,
self-hosted apps, CI, and other runtimes outside a Veryfront-hosted request,
set both `VERYFRONT_API_URL` and `VERYFRONT_API_TOKEN`, or pass `apiUrl` and
`authToken` explicitly.

Inside a Veryfront-hosted request, the client can use request-scoped
credentials automatically. The hosted runtime must still provide
`VERYFRONT_API_URL`; you do not need to set `VERYFRONT_API_TOKEN` separately
for the request.

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create();
```

Verify the session with a command before doing longer work:

```ts
const result = await sandbox.executeCommand("pwd");
console.log(result.exitCode);
console.log(result.stdout);
```

You can also reconnect to an existing session:

```ts
const sandbox = await Sandbox.get(sessionId);
```

If you already know both the sandbox session ID and its runtime endpoint, attach without doing a reconnect lookup:

```ts
const sandbox = Sandbox.attach({
  id: sessionId,
  endpoint: sandboxEndpoint,
});
```

If you want to defer session creation until the first command or file operation, use the lazy client:

```ts
const sandbox = Sandbox.createLazy({
  projectId: "proj_123",
});
```

If your project context can change over time, prefer `getProjectId()` so lazy exec and async run calls inherit the latest project reference automatically:

```ts
const sandbox = Sandbox.createLazy({
  getProjectId: () => currentProjectId,
});
```

The lazy client resolves the project once per operation. If it changes between
operations, a client-created session is replaced before the next operation so
the session and command request use the same project.

To override the resolved credentials, pass `authToken` explicitly. This can be a
JWT or a Studio-generated API key.

For project-scoped billing or isolation, pass `projectId` when creating the
session.

```ts
const sandbox = await Sandbox.create({
  projectId: "proj_123",
});
```

## Execute commands

Buffered execution:

```ts
const result = await sandbox.executeCommand("ls -la", {
  timeout_seconds: 120,
});
console.log(result.stdout, result.stderr, result.exitCode);
```

`executeCommand()` buffers at most 64 MiB of combined stdout and stderr by
default. Set `maxOutputBytes` up to 256 MiB when bounded buffering is
appropriate:

```ts
const result = await sandbox.executeCommand("generate-report", {
  maxOutputBytes: 128 * 1024 * 1024,
});
```

Use `executeStream()` instead when output can be larger or should be processed
incrementally. A malformed event, invalid UTF-8, oversized event, error event,
or stream that ends without an exit event fails the operation instead of
returning partial output.

Streaming execution:

```ts
for await (const event of sandbox.executeStream("npm test")) {
  if (event.type === "stdout") process.stdout.write(event.data ?? "");
  if (event.type === "stderr") process.stderr.write(event.data ?? "");
  if (event.type === "exit") console.log("exit:", event.exitCode);
}
```

## Read and write files

```ts
await sandbox.writeFiles([
  { path: "input.txt", content: "hello" },
]);

const content = await sandbox.readFile("input.txt");
console.log(content);
```

A write request is limited to 1,024 files and 64 MiB. A file read is limited to
64 MiB. Split larger transfers at the application boundary.

## Configure client deadlines

Set bounded startup, polling, and control-request timing when the defaults do
not fit your workload:

```ts
const sandbox = Sandbox.createLazy({
  startupTimeoutMs: 180_000,
  pollIntervalMs: 2_000,
  controlRequestTimeoutMs: 15_000,
  execStartTimeoutMs: 30_000,
});
```

`controlRequestTimeoutMs` covers response-body consumption for bounded
control, JSON, and file requests. For command streams, it covers startup
through response headers; use `timeout_seconds` to bound command runtime.
Setting a client deadline to `0` disables that deadline where supported.

## Lifecycle best practices

- Always call `await sandbox.close()` in `finally` blocks.
- Prefer `Sandbox.createLazy()` for agent-style workflows that may not need a session every run.
- The lazy client sends automatic heartbeats. For the eager client, call
  `sandbox.heartbeat()` when a long-lived session would otherwise be idle.
- Persist `sandbox.id` only when you need reconnect semantics.
- Keep auth tokens and API keys server-side only. Do not expose them to browsers.

## Example with cleanup

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create();

try {
  const result = await sandbox.executeCommand("echo 'ready'");
  console.log(result.stdout);
} finally {
  await sandbox.close();
}
```

## Verify it worked

Run the example above in a Node script with the env vars set. A working
sandbox:

- Prints `ready` to stdout from `executeCommand`.
- Returns `exitCode: 0` from the command result.
- Releases its session on `sandbox.close()` without an error.

If configuration fails before a request, verify both the API URL and
credentials. If `Sandbox.create()` throws a `401` or `403`, double-check the
token and project authorization; authorization failures fail immediately
instead of waiting through the startup timeout. If the
session never closes, look in the cloud dashboard for the lingering session
id and close it manually.

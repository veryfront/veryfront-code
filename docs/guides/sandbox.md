---
title: "Sandbox"
description: "Run isolated commands and file operations in ephemeral sandbox sessions."
order: 36
---

A sandbox is a short-lived, isolated workspace for executing commands and file operations away from your app process. Use it for code generation, repo inspection, file transformation, or script execution that you do not want to run in your trusted runtime.

The sandbox client talks to an authenticated sandbox session API. You need either Veryfront Cloud credentials or your own compatible backing service for `/sandbox-sessions`.

## Prerequisites

- A Veryfront Cloud token (`VERYFRONT_API_TOKEN`) or a self-hosted
  `/sandbox-sessions` API and matching `VERYFRONT_API_URL`.
- A reachable network from the process that calls `Sandbox.create()`.

## Create a sandbox session

Use `Sandbox.create()` with sandbox API credentials. In local development,
self-hosted apps, CI, and other runtimes outside a Veryfront-hosted request,
provide credentials explicitly. Set `VERYFRONT_API_TOKEN`, and set
`VERYFRONT_API_URL` when you need a non-default API endpoint.

Inside a Veryfront-hosted request, the client can use request-scoped
credentials automatically. In that path, you do not need to set
`VERYFRONT_API_TOKEN` separately for the request.

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
const result = await sandbox.executeCommand("ls -la");
console.log(result.stdout, result.stderr, result.exitCode);
```

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

## Lifecycle best practices

- Always call `await sandbox.close()` in `finally` blocks.
- Prefer `Sandbox.createLazy()` for agent-style workflows that may not need a session every run.
- Use `sandbox.heartbeat()` during long-running sessions to avoid idle timeouts.
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

If `Sandbox.create()` throws a `401`, double-check the API token. If the
session never closes, look in the cloud dashboard for the lingering session
id and close it manually.

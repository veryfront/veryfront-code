---
title: "Sandbox"
description: "Run commands and manage files in isolated workspaces."
order: 36
---

A sandbox is an isolated workspace for commands and files. Private always-on sandboxes retain workspace files across runtime restarts. Use it for code generation, repo inspection, file transformation, or script execution that you do not want to run in your trusted runtime.

The sandbox client talks to an authenticated sandbox API. You need either Veryfront Cloud credentials or your own compatible backing service for `/sandboxes`.

## Prerequisites

- A Veryfront Cloud token (`VERYFRONT_API_TOKEN`) or a self-hosted
  `/sandboxes` API and matching `VERYFRONT_API_URL`.
- A reachable network from the process that calls `Sandbox.create()`.

## Create a sandbox

Use `Sandbox.create()` with sandbox API credentials. In local development,
self-hosted apps, CI, and other runtimes outside a Veryfront-hosted request,
provide credentials explicitly. Set `VERYFRONT_API_TOKEN`, and set
`VERYFRONT_API_URL` when you need a non-default API endpoint.

Inside a Veryfront-hosted request, the client can use request-scoped
credentials automatically. In that path, you do not need to set
`VERYFRONT_API_TOKEN` separately for the request.

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create({ projectReference: "<PROJECT_ID>" });
```

Verify the sandbox with a command before doing longer work:

```ts
const result = await sandbox.runCommand("pwd");
console.log(result.exitCode);
console.log(result.stdout);
```

You can also reconnect to an existing sandbox:

```ts
const sandbox = await Sandbox.get(sandboxId);
```

If you already know both the sandbox ID and its runtime endpoint, attach without doing a reconnect lookup:

```ts
const sandbox = Sandbox.attach({
  id: sandboxId,
  endpoint: sandboxEndpoint,
});
```

To defer sandbox creation until the first command or file operation, use the lazy client:

```ts
const sandbox = Sandbox.createLazy({
  projectReference: "<PROJECT_ID>",
});
```

Use `getProjectId()` when the billing project is selected at runtime. It is read when the sandbox is created:

```ts
const sandbox = Sandbox.createLazy({
  getProjectId: () => currentProjectId,
});
```

To override the resolved credentials, pass `authToken` explicitly. This can be a
JWT or a Studio-generated API key.

Pass `projectReference` when creating a sandbox to select its billing project.

```ts
const sandbox = await Sandbox.create({
  projectReference: "<PROJECT_ID>",
});
```

## Run commands

Buffered execution:

```ts
const result = await sandbox.runCommand("ls -la");
console.log(result.stdout, result.stderr, result.exitCode);
```

Streaming execution:

```ts
for await (const event of sandbox.streamCommand("npm test")) {
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
- Prefer `Sandbox.createLazy()` for agent-style workflows that may not need a sandbox every run.
- Use `sandbox.heartbeat()` during long operations to avoid idle timeouts.
- Persist `sandbox.id` only when you need reconnect semantics.
- Keep auth tokens and API keys server-side only. Do not expose them to browsers.

## Example with cleanup

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create({ projectReference: "<PROJECT_ID>" });

try {
  const result = await sandbox.runCommand("echo 'ready'");
  console.log(result.stdout);
} finally {
  await sandbox.close();
}
```

## Verify it worked

Run the example above in a Node script with the env vars set. A working
sandbox:

- Prints `ready` to stdout from `runCommand`.
- Returns `exitCode: 0` from the command result.
- Deletes its temporary sandbox on `sandbox.close()`.

If `Sandbox.create()` throws a `401`, double-check the API token. If cleanup fails, find the sandbox by ID in Studio and delete it.

## Use a private always-on workspace

Private access requires creator-owned credentials. Always-on workspaces use the
project's existing entitlement, capacity and billing rules.

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create({
  projectReference: "<PROJECT_ID>",
  accessScope: "private",
  ttlMode: "always_on",
});

await sandbox.runCommand("mkdir -p /workspace/repository");
await sandbox.close();
```

Closing an always-on client keeps the workspace. Files and user-installed tools
under `/workspace` survive runtime replacement. Running processes and changes
outside `/workspace` do not persist. Use `sandbox.delete()` to delete the
sandbox and its workspace files.

`Sandbox.list()` returns access, storage and lifetime metadata. Storage and
lifetime are separate policies. Changing cleanup does not migrate temporary
files to persistent storage.

The SDK uses `/sandboxes`. Command IDs come from `command_id`; command
collections use `data` and `page_info`. Per-file write failures are reported
even when the HTTP request succeeds.

## Inspect and manage a workspace

```ts
const capabilities = await Sandbox.capabilities();
console.log(capabilities.limits.maxCommandTimeoutSeconds);

const sandbox = await Sandbox.get("<SANDBOX_ID>");
const readiness = await sandbox.checkReadiness();
console.log(readiness.ok, readiness.reason);

const files = await sandbox.listFiles({ path: "/workspace", limit: 20 });
console.log(files.data);
if (files.pageInfo.next) {
  const nextPage = await sandbox.listFiles({
    path: "/workspace",
    cursor: files.pageInfo.next,
  });
  console.log(nextPage.data);
}

const environment = await sandbox.getEnvironment();
console.log(Object.keys(environment.env));

await sandbox.updateLifetime({ ttlMode: "duration", ttlHours: 4 });
await sandbox.close();
```

`checkHealth()` and `checkReadiness()` do not record activity. `heartbeat()`
records activity but does not extend fixed expiry. `getEnvironment()` returns
redacted values. Closing a client obtained through `get()` or `attach()` leaves
the sandbox available. Use `delete()` when you intend to remove it.

A retained always-on workspace is not replaced automatically after a missing,
inaccessible or unhealthy runtime response. Its ID stays available on the
client so you can inspect it or reconnect with renewed credentials. Create a
new workspace explicitly when you intend to replace it.

---
title: "Sandbox"
description: "Run isolated commands and file operations in ephemeral sandbox sessions."
order: 25
---

# Sandbox

Run isolated commands and file operations in ephemeral sandbox sessions.

Use the sandbox when your app needs short-lived, isolated execution for tasks like code generation, repo inspection, file transformation, or script execution.

The sandbox client talks to authenticated sandbox session APIs. In practice, that means you need either Veryfront Cloud credentials or your own compatible backing API/service layer for `/sandbox-sessions`.

## Create a sandbox session

Use `Sandbox.create()` with sandbox API credentials. In local development,
`VERYFRONT_API_TOKEN` plus a reachable `VERYFRONT_API_URL` is the default path.
In remote requests, request-scoped credentials can be used automatically.

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create();
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

If your project context can change over time, prefer `getProjectId()` so lazy exec and async job calls inherit the latest project reference automatically:

```ts
const sandbox = Sandbox.createLazy({
  getProjectId: () => currentProjectId,
});
```

If you need to override the resolved credentials, pass `authToken`
explicitly. This can be a JWT or a Studio-generated API key.

If you need project-scoped billing or isolation, pass `projectId` when creating the session.

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

## Next

- [MCP Server](./mcp-server.md): expose tools, prompts, and resources over MCP
- [Agents](./agents.md): orchestrate sandbox-backed workflows with agents

## Related

- [`veryfront/sandbox`](../reference/sandbox.md): sandbox API reference

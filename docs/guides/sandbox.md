---
title: "Sandbox"
description: "Run isolated commands and file operations in ephemeral sandbox sessions."
order: 19
---

# Sandbox

Run isolated commands and file operations in ephemeral sandbox sessions.

Use the sandbox when your app needs short-lived, isolated execution for tasks like code generation, repo inspection, file transformation, or script execution.

## Create a sandbox session

Use `Sandbox.create()` with standard Veryfront Cloud auth. In local development,
`VERYFRONT_API_TOKEN` is enough. In remote requests, request-scoped credentials
are used automatically.

```ts
import { Sandbox } from "veryfront/sandbox";

const sandbox = await Sandbox.create();
```

You can also reconnect to an existing session:

```ts
const sandbox = await Sandbox.get(sessionId);
```

If you need to override the resolved credentials, pass `authToken`
explicitly. This can be a JWT or a Studio-generated API key.

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
  { path: "/workspace/input.txt", content: "hello" },
]);

const content = await sandbox.readFile("/workspace/input.txt");
console.log(content);
```

## Lifecycle best practices

- Always call `await sandbox.close()` in `finally` blocks.
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

- [MCP Server](./mcp-server.md) — expose tools, prompts, and resources over MCP
- [Agents](./agents.md) — orchestrate sandbox-backed workflows with agents

## Related

- [`veryfront/sandbox`](../reference/sandbox.md) — sandbox API reference

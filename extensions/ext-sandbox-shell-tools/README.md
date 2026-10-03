# @veryfront/ext-sandbox-shell-tools

> **Category:** Sandbox | **Contract:** `SandboxShellToolsProvider` |
> **Built-in**

Provides the `SandboxShellToolsProvider` contract using AI SDK tools and Zod schemas.

Core Veryfront code depends on the sandbox shell tools contract only. This
extension creates command, read-file, and write-file tools for the supplied sandbox.
Command output retains the 30,000-character limit for each output stream.

## Supply-chain boundary

This extension is a sensitive sandbox execution boundary. Keep AI SDK, Zod,
`just-bash`, and related shell execution dependencies in this extension instead
of importing them from core, CLI, React, or unrelated extensions.

## Capabilities

- **sandbox `bash`:** Creates shell tools that execute commands through the
  configured sandbox provider. The extension does not spawn local processes
  directly, but it exposes command execution inside the sandbox boundary.

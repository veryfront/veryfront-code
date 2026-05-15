# @veryfront/ext-sandbox-shell-tools

> **Category:** Sandbox | **Contract:** `SandboxShellToolsProvider` |
> **Built-in**

Provides the `SandboxShellToolsProvider` contract using `bash-tool`.

Core Veryfront code depends on the sandbox shell tools contract only. This
extension owns the third-party shell tool implementation and its transitive
dependencies.

## Supply-chain boundary

This extension is a sensitive sandbox execution boundary. Keep `bash-tool`,
`just-bash`, and related shell execution dependencies in this extension instead
of importing them from core, CLI, React, or unrelated extensions.

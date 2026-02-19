---
title: "veryfront/cli"
description: "Veryfront CLI entry point."
order: 21
---

# veryfront/cli

Veryfront CLI entry point.

## Import

```ts
import {
  ensureEnvLoaded,
  args,
  exitProcess,
  getArgs,
  hasEnvLoaded,
  loadEnv,
} from "veryfront/cli";
```

## Examples

```sh
npx veryfront dev
```

## Exports

### Functions

| Name | Description |
|------|-------------|
| `ensureEnvLoaded` | Load `.env` files and initialize environment config if not already done. |

### Constants

| Name | Description |
|------|-------------|
| `args` | Raw command-line arguments array |
| `exitProcess` | Exit the process with the given code |
| `getArgs` | Get command-line arguments (cross-runtime) |
| `hasEnvLoaded` | Check whether `.env` files have already been loaded |
| `loadEnv` | Load environment variables from `.env` files |
| `markEnvLoaded` | Mark environment variables as loaded |
| `parseCliArgs` | Parse raw CLI arguments into a structured object with aliases |
| `routeCommand` | Route and execute the appropriate CLI command |
| `supportsEnvFiles` | Check whether `.env` file loading is supported in the current runtime |

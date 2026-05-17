---
title: "veryfront/utils"
description: "Shared runtime detection, structured logging, constants, hashing, memoization, and feature flag utilities."
order: 26
---

# veryfront/utils

Shared runtime detection, structured logging, constants, hashing, memoization, and feature flag utilities.

## Examples

### Structured logging

```ts
import { serverLogger } from "veryfront/utils";

serverLogger.info("Booting server", { project_id: "proj_123" });
```

## API groups

| Group            | Exports                                                                                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime guards   | `hasDenoRuntime()`, `hasNodeProcess()`, `hasBunRuntime()` and runtime global types.                                                                                                          |
| Logging          | `logger`, `serverLogger`, `agentLogger`, `rendererLogger`, `bundlerLogger`, `createJobUserLogger()`, `refreshLoggerConfig()`, `runWithRequestContextAsync()`, `registerTraceContextGetter()` |
| Constants        | Breakpoints, HTTP status codes, content types, HMR limits, cache defaults, React defaults, internal endpoint names, and build directory constants.                                           |
| Version          | `VERSION`                                                                                                                                                                                    |
| Hashing          | `computeCodeHash()`, `computeHash()`, `fnv1aHash()`, `shortHash()`, `simpleHash()`                                                                                                           |
| Memoization      | `MemoCache`, `memoize()`, `memoizeAsync()`, `memoizeHash()`                                                                                                                                  |
| Paths            | `normalizePath()`                                                                                                                                                                            |
| Bundle manifest  | `getBundleManifestStore()` and bundle metadata types.                                                                                                                                        |
| Feature flags    | `isRSCEnabled()`                                                                                                                                                                             |
| Platform         | `isCompiledBinary()`                                                                                                                                                                         |
| Import lockfiles | `computeIntegrity()`, `createLockfileManager()`                                                                                                                                              |
| Timing           | `startRequest()`, `endRequest()`, `startTimer()`, `timeAsync()`, `isEnabled()`                                                                                                               |
| Concurrency      | `parallelMap()`                                                                                                                                                                              |

The utilities module is a shared framework surface. Prefer more specific
modules, such as `veryfront/observability` or `veryfront/server`, when a helper
has a domain-specific home.

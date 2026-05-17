---
title: "veryfront/utils"
description: "Shared runtime detection, structured logging, constants, hashing, memoization, and feature flag utilities."
order: 18
---

# veryfront/utils

Shared runtime detection, structured logging, constants, hashing, memoization, and feature flag utilities.

## Examples

### Structured logging

```ts
import { serverLogger } from "veryfront/utils";

serverLogger.info("Booting server", { project_id: "proj_123" });
```

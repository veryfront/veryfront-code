# Rate-limit client identity helper

This directory is not a published `veryfront/security/rate-limit` entrypoint.
The supported public rate limiter is owned by
[`veryfront/middleware`](../../middleware/README.md):

```typescript
import { authRateLimit, MemoryRateLimitStore, rateLimit } from "veryfront/middleware";
```

`client-key.ts` is the single source-local file. It resolves a client identity
for the maintained middleware implementation while keeping proxy headers
untrusted unless the caller explicitly enables trusted-proxy handling. No
second limiter, store, strategy, or deep-import compatibility facade lives in
Security.

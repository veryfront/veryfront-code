# module-response.ts extraction — call-site report

New module: `src/modules/server/module-response.ts` (+ `module-response.test.ts`).
Owns construction of every module-serve *failure* Response so the
`Cache-Control` decision (cacheable miss vs. uncacheable rejection) is stated
in one place instead of re-spelled inline at each `createModuleResponse` call.

Exported helpers (each preserves the exact status/header pattern the call
sites already used — no directive was changed):

| Helper | Status | Content-Type | Cache-Control | Meaning |
|---|---|---|---|---|
| `moduleNotFound(method, message?)` | 404 | text/plain | `no-cache` | ordinary miss — safe to revalidate |
| `moduleRejected(method, message?)` | 404 | text/plain | `no-store` | admission/protected-path rejection — never cacheable |
| `moduleBadRequest(method, message)` | 400 | text/plain | `no-cache` | malformed request |
| `moduleMethodNotAllowed(method)` | 405 | text/plain | `no-store` | verb other than GET/HEAD (adds `Allow: GET, HEAD`) |
| `moduleServiceUnavailable(method, message)` | 503 | text/plain | `no-store` | required server-side state (release manifest) not ready |
| `unknownDependencySnapshot(method)` | 409 | text/plain | `no-store` | client's dependency-pinning cache key unrecognized |

Success responses (`HTTP_OK`, `application/javascript`, e.g. transformed
snippet/module code and the two "Transform Error" JS-body catch blocks) were
**left inline**, per scope — they carry varying extra headers (HMR
timestamps, `getModuleHeaders`) and don't share the failure shape.

## Converted call sites (module-server.ts), before → after

All directives below are **unchanged** from the original inline call —
this table is the before/after diff surface for reviewers to check the
security-relevant mapping at a glance.

| Line (pre-change) | Case | Status | Cache-Control (before = after) | New call |
|---|---|---|---|---|
| ~402 | non-GET/HEAD method | 405 | `no-store` | `moduleMethodNotAllowed(method)` |
| ~511 | `not-module` classification | 404 | `no-cache` | `moduleNotFound(method)` |
| ~522 | `invalid-module` classification | 400 | `no-cache` | `moduleBadRequest(method, "Invalid module path")` |
| ~531 | snippet request missing hash | 404 | `no-cache` | `moduleNotFound(method, "Missing snippet hash")` |
| ~551 | snippet not found in cache | 404 | `no-cache` | `moduleNotFound(method, "Snippet not found")` |
| ~571 | server-only snippet rejected from browser endpoint | 404 | `no-store` | `moduleRejected(method)` |
| ~663 | cross-project: missing slug/path | 404 | `no-cache` | `moduleNotFound(method, "Invalid cross-project import path")` |
| ~676 | cross-project: protected path | 404 | `no-store` | `moduleRejected(method)` |
| ~702 | cross-project: source fetch returned null | 404 | `no-cache` | `moduleNotFound(method, \`Cross-project module not found: ${projectRef}/@/${crossPath}\`)` |
| ~722 | cross-project: server-only source rejected | 404 | `no-store` | `moduleRejected(method)` |
| ~818 | protected project path | 404 | `no-store` | `moduleRejected(method)` |
| ~845 | production admission required, no releaseId (pre-lookup) | 404 | `no-store` | `moduleRejected(method)` |
| ~949 | `findSourceFile` returned null | 404 | `no-store` | `moduleRejected(method)` — see note below |
| ~971 | protected resolved source | 404 | `no-store` | `moduleRejected(method)` |
| ~984 | production admission required, no releaseId (post-lookup) | 404 | `no-store` | `moduleRejected(method)` |
| ~999 | production browser module manifest unavailable | 503 | `no-store` | `moduleServiceUnavailable(method, "Browser module manifest unavailable")` |
| ~1017 | source absent from release manifest | 404 | `no-store` | `moduleRejected(method)` |
| ~1109 | rejected protected RSC client dependency | 404 | `no-store` | `moduleRejected(method)` |
| ~1125 | server-only source boundary rejected | 404 | `no-store` | `moduleRejected(method)` |
| ~1296 | catch: `BrowserModuleEntryRejectedError` / `BrowserModuleBoundaryError` | 404 | `no-store` | `moduleRejected(method)` |
| ~1755 (+ 7 call sites at 430, 537, 682, 834, 1051, 1134, 1290) | unknown dependency-pinning snapshot | 409 | `no-store` | `unknownDependencySnapshot(method)`; the local wrapper function `unknownDependencySnapshotModuleResponse` was deleted and all 7 call sites now call the new helper directly |

**Totals: 21 direct call sites converted** (6 × `no-cache`, 15 × `no-store`),
plus 7 indirect call sites through the deleted
`unknownDependencySnapshotModuleResponse` wrapper, now calling
`unknownDependencySnapshot` (409, `no-store`) directly.

## Left inline (out of scope, unchanged)

- Success bodies: lines ~626, ~749, ~1230 (`HTTP_OK`, `application/javascript`).
- "Transform Error" JS-body catch blocks: lines ~634, ~757 (dynamic
  `application/javascript` body, not text/plain).
- Cached release-module passthrough: line ~873 (replays a previously stored
  success response with its own stored headers).
- Final catch-all error response: line ~1257 (`errorBody`/`status`/`headers`
  vary by error kind and file type via `createModuleErrorBody` /
  `getModuleHeaders` — not a fixed text/plain shape).

## Note on the `findSourceFile` miss (~949)

This site logs `"Module not found"` and is semantically an ordinary lookup
miss, but its original `Cache-Control` was `no-store`, not `no-cache`. Per
the instruction to preserve each site's directive exactly rather than
"fixing" an apparent inconsistency, it was converted to `moduleRejected`
(no-store) to match current behavior byte-for-byte. Flagging this for the
reviewer: it may be worth a follow-up discussion on whether this specific
miss should actually be `no-cache` like the other pure "not found" cases, but
that is a behavior change and out of scope for this refactor.

## Verification

- Baseline (`deno task test:unit`, before any change): `3801 passed (27907 steps) | 0 failed | 1 ignored (5 steps)`.
- `src/modules/server/module-server.test.ts` (the fence): `3 passed (88 steps) | 0 failed` — identical to baseline.
- New `src/modules/server/module-response.test.ts`: `6 passed (11 steps) | 0 failed`.
- `deno lint` and `deno check src/modules/index.ts`: clean.

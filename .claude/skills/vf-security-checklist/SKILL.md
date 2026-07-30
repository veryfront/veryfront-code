---
name: vf-security-checklist
description: Use when touching auth, user input validation, file paths, redirects, WebSocket, uploads, rate limiting, CORS, or any security-sensitive code in veryfront
---

# Veryfront security checklist

## Overview

This checklist records Veryfront's current security boundaries and the invariants
that security-sensitive changes must preserve. It does not replace focused
threat analysis and regression tests for the code being changed.

**Core principle:** Validate at boundaries, use framework security utilities, never trust client input.

## Before you ship: quick check

Run through these when modifying security-sensitive code:

### Input and validation

- [ ] User input validated with the provider-neutral schema contracts before use
- [ ] Filesystem paths admitted with `validatePath()` and a runtime adapter, or operated on through `SecureFs`
- [ ] `validateLexicalPath()` used only for stores without symlinks or code that performs its own descriptor-relative checks
- [ ] No string concatenation for SQL or commands; use parameterized queries or array arguments
- [ ] Untrusted HTML escaped or assigned through safe DOM APIs; `validateTrustedHtml()` is not treated as a sanitizer

### Authentication and tokens

- [ ] JWT signatures verified (not just payload extraction)
- [ ] Tokens in headers or cookies (never in URL query params)
- [ ] WebSocket auth uses subprotocol header, not query string
- [ ] Session tokens stored securely (compliance-approved method)

### Network and routing

- [ ] Redirects validate URL scheme (block `javascript:`, `data:`, `vbscript:`)
- [ ] CORS origins explicitly listed (no wildcard `*` in production)
- [ ] Rate limiting imported from `veryfront/middleware` and keyed by verified identity or an explicitly trusted proxy
- [ ] WebSocket enforces `wss://` in production (not plain `ws://`)

### File system

- [ ] File paths validated against traversal (`../`) attacks
- [ ] Use `SecureFs` methods for filesystem operations after constructing the boundary
- [ ] Code does not bypass `SecureFs` through its underlying runtime adapter
- [ ] Upload handlers have auth middleware
- [ ] Sandbox code execution has size/time limits

### Commands

- [ ] External commands use array arguments (no shell interpolation)
- [ ] No `shell: true` option in subprocess calls
- [ ] User input never concatenated into command strings

## Security module utilities

```typescript
import { createSecureFs, validateLexicalPath } from "#veryfront/security";
import type { RuntimeAdapter } from "#veryfront/platform";

export async function readUserFile(
  runtimeAdapter: RuntimeAdapter,
  projectRoot: string,
  userInput: string,
): Promise<string> {
  const secureFs = createSecureFs({
    baseDir: projectRoot,
    adapter: runtimeAdapter,
    context: "user-input",
  });
  return await secureFs.readFile(userInput);
}

// Lexical containment is only for stores that cannot resolve symlinks.
export function admitObjectKey(objectStoreRoot: string, objectKey: string): string {
  const result = validateLexicalPath(objectKey, { baseDir: objectStoreRoot });
  if (!result.valid || !result.canonicalPath) {
    throw new TypeError("Object key is outside the allowed root");
  }
  return result.canonicalPath;
}
```

`validatePath()` returns a promise because physical admission canonicalizes the
path through the supplied runtime adapter and checks symlink policy. Prefer
`SecureFs` when the admitted path is immediately used for a filesystem
operation, so validation and use stay inside the same framework boundary.

`validateTrustedHtml()` is an internal check for framework-generated server
HTML. It detects suspicious patterns but does not sanitize arbitrary HTML.
Escape untrusted text or assign it with `textContent`.

## Secure patterns

### Command execution

```typescript
const cmd = new Deno.Command("git", {
  args: ["log", "--oneline", "-n", "10"],
});
```

Do not pass user input to a shell command string or enable `shell: true`.

### Redirect validation

```typescript
export function resolveSameOriginRedirect(target: string, requestUrl: string): string {
  const request = new URL(requestUrl);
  const redirect = new URL(target, request);
  if (
    !["http:", "https:"].includes(redirect.protocol) ||
    redirect.origin !== request.origin ||
    redirect.username !== "" ||
    redirect.password !== ""
  ) {
    throw new TypeError(
      "Redirect target must be a same-origin HTTP(S) URL without credentials",
    );
  }
  return redirect.href;
}
```

Cross-origin redirects require an explicit origin allowlist in addition to the
scheme check.

### Rate limiting

Import `rateLimit`, `authRateLimit`, and store contracts from
`veryfront/middleware`. Security contains only the shared client-key helper; it
does not expose a second limiter implementation.

| Configuration                 | Client key behavior                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `keyGenerator`                | Uses the caller's verified, stable application identity.                                                                          |
| `trustProxy: false` (default) | Ignores `X-Forwarded-For` and `X-Real-IP`; the default generator uses one fallback bucket.                                        |
| `trustProxy: true`            | Uses the rightmost `X-Forwarded-For` address, then `X-Real-IP`; valid only when the nearest trusted proxy controls those headers. |

Production deployments must either provide a `keyGenerator` based on a
verified identity or enable proxy trust only at a controlled proxy boundary.
The in-memory store is process-local. Distributed deployments supply a
`RateLimitStore` through the extension-backed distributed store contract.

## Security invariants to preserve

- External commands receive argument arrays and do not invoke a shell.
- Untrusted HTML is escaped; trusted server HTML checks remain defense-in-depth.
- Filesystem admission uses adapter-backed canonicalization and explicit symlink policy.
- CSRF token comparison remains constant-time.
- Security tokens use Web Crypto randomness.

These invariants describe the current design. Re-run the focused security and
consumer tests after changing any of their implementation paths.

## Common mistakes

| Mistake                                             | Fix                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Extracting JWT payload without verification         | Verify signature first                                           |
| `trustProxy: true` without a trusted proxy          | Use a verified `keyGenerator`, or keep forwarded headers ignored |
| `ws://` WebSocket in production                     | Enforce `wss://`                                                 |
| `validateLexicalPath()` for a local filesystem path | Use `validatePath()` with an adapter or `SecureFs`               |
| Direct adapter access after creating `SecureFs`     | Perform the operation through `SecureFs`                         |
| Treating `validateTrustedHtml()` as a sanitizer     | Escape untrusted content or assign it with `textContent`         |
| Missing auth on upload endpoint                     | Add auth middleware                                              |
| Redirect without scheme check                       | Validate `http:` / `https:` only                                 |
| String-concatenated commands                        | Use array `args` parameter                                       |

---
name: vf-security-checklist
description: Use when touching auth, user input validation, file paths, redirects, WebSocket, uploads, rate limiting, CORS, or any security-sensitive code in veryfront
---

# Veryfront Security Checklist

## Overview

Veryfront has undergone a comprehensive security audit. This checklist captures the verified patterns and known pitfalls.

**Core principle:** Validate at boundaries, use framework security utilities, never trust client input.

## Before You Ship: Quick Check

Run through these when modifying security-sensitive code:

### Input & Validation
- [ ] User input validated with Zod schemas before use
- [ ] Path inputs validated with `validatePathSync()` from `#veryfront/security`
- [ ] No string concatenation for SQL/commands — use parameterized queries / array args
- [ ] HTML user content escaped or wrapped with `validateTrustedHtml()`

### Authentication & Tokens
- [ ] JWT signatures verified (not just payload extraction)
- [ ] Tokens in headers or cookies (never in URL query params)
- [ ] WebSocket auth uses subprotocol header, not query string
- [ ] Session tokens stored securely (compliance-approved method)

### Network & Routing
- [ ] Redirects validate URL scheme (block `javascript:`, `data:`, `vbscript:`)
- [ ] CORS origins explicitly listed (no wildcard `*` in production)
- [ ] Rate limiting keys use actual connection IP, not `X-Forwarded-For` alone
- [ ] WebSocket enforces `wss://` in production (not plain `ws://`)

### File System
- [ ] File paths validated against traversal (`../`) attacks
- [ ] Use `SecureFS` methods for file operations
- [ ] `SecureFS` unsafe methods (`unsafeReadFile`, etc.) not used in production paths
- [ ] Upload handlers have auth middleware
- [ ] Sandbox code execution has size/time limits

### Commands
- [ ] External commands use array arguments (no shell interpolation)
- [ ] No `shell: true` option in subprocess calls
- [ ] User input never concatenated into command strings

## Security Module Utilities

```typescript
import {
  validatePathSync,
  validateTrustedHtml,
  // Rate limiting, CORS, input validation
} from "#veryfront/security";

// Path validation — prevents traversal
const safePath = validatePathSync(userInput, { baseDir: projectRoot });

// HTML safety — wraps trusted HTML
const html = validateTrustedHtml(content);
```

## Secure Patterns

### Command Execution (Safe)
```typescript
// Correct: array arguments, no shell
const cmd = new Deno.Command("git", {
  args: ["log", "--oneline", "-n", "10"],
});

// Wrong: string interpolation
const cmd = new Deno.Command("sh", {
  args: ["-c", `git log ${userInput}`],  // INJECTION RISK
});
```

### Redirect Validation
```typescript
// Correct: validate scheme
const url = new URL(redirectTarget);
if (!["http:", "https:"].includes(url.protocol)) {
  throw SECURITY_VIOLATION.create({
    detail: "Invalid redirect scheme",
    context: { protocol: url.protocol },
  });
}

// Wrong: no validation
res.redirect(userProvidedUrl);  // javascript: XSS risk
```

### Rate Limiting
```typescript
// Correct: use connection info
const clientIp = request.connection.remoteAddr;

// Wrong: trust client header
const clientIp = request.headers.get("X-Forwarded-For");  // SPOOFABLE
```

## Verified Secure Areas

These have been audited and are safe — don't over-engineer:
- Command injection: protected (array args throughout)
- XSS: protected (`validateTrustedHtml` wrapper)
- HTML escaping: comprehensive (5 characters: `& < > " '`)
- Path traversal: protected (`src/security/path-validation/`)
- CSRF: protected (double-submit, constant-time compare)
- Cryptographic randomness: uses `crypto.getRandomValues()`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Extracting JWT payload without verification | Verify signature first |
| `X-Forwarded-For` for rate limit key | Use `request.connection.remoteAddr` |
| `ws://` WebSocket in production | Enforce `wss://` |
| `SecureFS.unsafeReadFile` in prod code | Use safe variant with path validation |
| Missing auth on upload endpoint | Add auth middleware |
| Redirect without scheme check | Validate `http:` / `https:` only |
| String-concatenated commands | Use array `args` parameter |

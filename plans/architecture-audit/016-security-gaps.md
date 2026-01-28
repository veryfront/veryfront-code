# 016: Security Vulnerability Gaps

## Overview

Security vulnerabilities discovered during gap analysis that are NOT covered by existing tasks 001-039.

## Risk Summary (Updated)

| Severity | Count | Status |
|----------|-------|--------|
| HIGH | 1 | ✅ Fixed (016.1) |
| FALSE POSITIVE | 2 | ❌ 016.2, 016.4 |
| DOWNGRADED | 2 | ⚠️ 016.3 (LOW), 016.5 (LOW) |

## Sub-Analyses

| Doc | Issue | Original | Validated | Status |
|-----|-------|----------|-----------|--------|
| [016.1](./016.1-timing-attack.md) | Timing Attack in Auth | HIGH | ✅ HIGH | **FIXED** (eafa78c1) |
| [016.2](./016.2-innerhtml-sanitization.md) | innerHTML Without Sanitization | HIGH | ❌ FALSE POSITIVE | File doesn't use innerHTML; sanitizer exists |
| [016.3](./016.3-sandbox-escape.md) | Sandbox Escape via Function() | HIGH | ⚠️ LOW | Worker permissions: "none" already sandboxes |
| [016.4](./016.4-path-traversal.md) | Path Traversal in Adapters | MEDIUM | ❌ FALSE POSITIVE | SecureFs with multi-layer validation exists |
| [016.5](./016.5-json-parse-validation.md) | Unvalidated JSON.parse() | MEDIUM | ⚠️ LOW | 85% already protected; 2 remaining fixed |

## Impact Matrix

```
TIMING ATTACK (016.1)
├── Token comparison uses ===
├── Attacker can measure response time
└── Token bytes leaked incrementally

innerHTML (016.2)
├── AI tool renders untrusted content
├── XSS injection possible
└── User session compromise

SANDBOX ESCAPE (016.3)
├── new Function(code) bypasses Deno sandbox
├── Config execution has full access
└── RCE if malicious config

PATH TRAVERSAL (016.4)
├── Missing ../ validation
├── Access files outside project
└── Credential/secret exposure

JSON.parse (016.5)
├── No try/catch on parse
├── Malformed JSON crashes request
└── DoS potential
```

## Relationship to Existing Tasks

| Gap | Related Task | Gap Coverage |
|-----|--------------|--------------|
| Timing attack | None | NEW - Task 040 |
| innerHTML | None | NEW - Task 041 |
| Sandbox escape | 001 (Sandbox Config) | PARTIAL - Task 001 covers config, not Function() |
| Path traversal | 016 (Adapter Interface) | PARTIAL - Task 016 covers interface, not validation |
| JSON.parse | 024 (Error Handling) | PARTIAL - Error handling, not validation |

## Tasks Created

| Task | Issue | Priority |
|------|-------|----------|
| [040](./tasks/040-timing-safe-compare.md) | Timing-safe token comparison | P0 |
| [041](./tasks/041-innerhtml-sanitization.md) | Sanitize innerHTML usage | P0 |
| [042](./tasks/042-sandbox-function-restriction.md) | Restrict Function() in sandbox | P0 |
| [043](./tasks/043-path-traversal-validation.md) | Add path traversal validation | P1 |
| [044](./tasks/044-json-parse-safety.md) | Safe JSON.parse wrapper | P1 |

## Decisions Required

- **D011**: Path validation strategy - centralized vs per-adapter

# 016: Security Vulnerability Gaps

## Overview

Security vulnerabilities discovered during gap analysis that are NOT covered by existing tasks 001-039.

## Risk Summary

| Severity | Count | Immediate Action |
|----------|-------|------------------|
| HIGH | 3 | Block deployment |
| MEDIUM | 2 | Fix within sprint |

## Sub-Analyses

| Doc | Issue | Severity | Location |
|-----|-------|----------|----------|
| [016.1](./016.1-timing-attack.md) | Timing Attack in Auth | HIGH | `src/security/http/auth.ts:104-124` |
| [016.2](./016.2-innerhtml-sanitization.md) | innerHTML Without Sanitization | HIGH | `src/ai/tools/advanced-tools.ts` |
| [016.3](./016.3-sandbox-escape.md) | Sandbox Escape via Function() | HIGH | `src/security/sandbox/deno-sandbox.ts:46-56` |
| [016.4](./016.4-path-traversal.md) | Path Traversal in Adapters | MEDIUM | FS adapter operations |
| [016.5](./016.5-json-parse-validation.md) | Unvalidated JSON.parse() | MEDIUM | 40+ locations |

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

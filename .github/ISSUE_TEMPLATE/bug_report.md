---
name: Bug Report
about: Report a bug with clear reproduction steps
title: ''
labels: bug
assignees: ''
---

## Summary

<!-- One-line description of the bug -->

---

## Problem

<!-- Explain the root cause if known. Include relevant code snippets with file paths. -->

**File:** `src/path/to/file.ts:line`
```typescript
// Relevant code
```

---

## Current Outcome

<!-- What happens now? Include error messages, logs, or HTTP responses if applicable. -->

```
// Error or unexpected output
```

---

## Expected Outcome

<!-- What should happen instead? -->

---

## How to Test

<!-- Step-by-step instructions to verify the fix -->

```bash
# Commands to reproduce or test
curl -s -o /dev/null -w "%{http_code}" 'https://example.preview.veryfront.com/'
```

1. Step one
2. Step two
3. **Verify:** Expected result

---

## Environment

- **Mode:** Proxy / Direct
- **Runtime:** Deno version
- **Component:** Proxy / Renderer / Both

---

## Files

<!-- List of files that need to be modified -->

- `src/path/to/file.ts` — Description of change needed

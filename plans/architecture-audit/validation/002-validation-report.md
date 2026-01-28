# Chapter 002 Validation Report

> Generated: 2026-01-28
> Validators: Claude Code-Reviewer (3 parallel agents)
> Secondary: Gemini (rate-limited), Codex (requires interactive)

## Executive Summary

| Issue | Claimed Severity | Validated Severity | Status |
|-------|------------------|-------------------|--------|
| 002.1 Head Collector | CRITICAL | **CRITICAL** | ✅ CONFIRMED |
| 002.2 SSR Globals | CRITICAL | **LOW** | ⚠️ FALSE POSITIVE |
| 002.3 React Cache | CRITICAL | **LOW** | ⚠️ PARTIAL - Downgraded |

**Recommendation**: Proceed with 002.1 fix only. Issues 002.2 and 002.3 are not production-impacting as documented.

---

## Issue 002.1: Head Collector SSR Metadata Leakage

### Validation Result: ✅ CONFIRMED

**Severity**: CRITICAL (unchanged)

### Evidence

| Claim | Verified |
|-------|----------|
| Global mutable state at line 37 | ✅ Yes - `let collected: CollectedHead = createEmpty();` |
| collectHead() mutates global | ✅ Yes - Lines 43-58 |
| flushHeadCollector() returns/resets global | ✅ Yes - Lines 64-68 |
| No AsyncLocalStorage isolation | ✅ Yes - Not present |
| SSR orchestrator uses reset/flush pattern | ✅ Yes - Lines 61, 78 |

### Production Impact

**Race Condition Window**: Between `resetHeadCollector()` and `flushHeadCollector()` calls in SSR pipeline.

```
Request A: reset → [render] → flush
Request B:    reset → [render] → flush
                ↑
             Clears A's collected head data!
```

**Impact**:
- Wrong SEO metadata (titles, descriptions, OG tags)
- Cross-project data leakage
- Brand confusion in browser tabs
- Social sharing shows wrong content

### Recommendation

**Proceed with fix using AsyncLocalStorage pattern as documented in 002.1-head-collector-leakage.md**

---

## Issue 002.2: SSR Globals Context Domain/State Leakage

### Validation Result: ⚠️ FALSE POSITIVE

**Severity**: LOW (downgraded from CRITICAL)

### Evidence

| Claim | Verified |
|-------|----------|
| Global variables exist (lines 6-9) | ✅ Yes |
| setSSRProjectDomain called at runtime | ❌ No - Deprecated, never called |
| Domain leakage between requests | ❌ No - getSSRProjectDomain() always returns null |
| enableSSRClientOnlyFetching per-request | ❌ No - Only called at server startup |

### Why It's Not a Problem

1. **Explicit Documentation** (lines 5-9):
   > "These are process-wide globals set ONCE at server startup. They are NOT per-request state."

2. **Setter is Deprecated**:
   ```typescript
   /** @deprecated Not called from any active code path */
   export function setSSRProjectDomain(domain: string | null): void
   ```

3. **Architectural Constraint**:
   - Production: Each pod runs single server instance
   - Setters called once at startup, not per-request
   - Domain routing handled by proxy/ingress, not SSR globals

### Recommendation

**No fix needed.** The audit document describes a hypothetical vulnerability that doesn't exist in the actual codebase. The design is intentional.

---

## Issue 002.3: React Module Cache Version Mismatch

### Validation Result: ⚠️ PARTIAL

**Severity**: LOW (downgraded from CRITICAL)

### Evidence

| Claim | Verified |
|-------|----------|
| Global React cache exists | ✅ Yes - `let projectReactCache` |
| Projects get wrong React version | ❌ No - Framework bundles single React 19.1.1 |
| Version detection is global | ⚠️ Partial - Has project-scoped cache but also global fallback |

### Why It's Not Critical

1. **Framework Bundles React**:
   - All projects use `https://esm.sh/react@19.1.1` from deno.json
   - Projects don't bring their own React runtime
   - No actual "wrong React code" scenario

2. **Version Detection Has Mitigation**:
   - `getReactVersionInfoForProject(projectDir)` already exists
   - Project-scoped cache in `projectVersionCache` Map
   - Only `defaultVersionInfo` global is problematic

3. **Actual Bug (Minor)**:
   - `stream-renderer.ts` uses `hasFeature()` without project context
   - Could misapply streaming feature flag if first request has different React declared
   - **Impact**: Minor - streaming vs non-streaming, not crashes

### Recommendation

**Low priority fix.** Update `stream-renderer.ts` to pass version info from context instead of using global `hasFeature()`. Not production-breaking.

---

## Validated Priority Order

Based on validation results, updated execution order for Chapter 002:

| Priority | Issue | Action |
|----------|-------|--------|
| **P0** | 002.1 Head Collector | Fix immediately - real multi-tenant bug |
| **P3** | 002.3 React Cache | Low priority - minor feature flag issue |
| **Skip** | 002.2 SSR Globals | No action needed - false positive |

---

## Remaining Issues to Validate

The following issues from Chapter 002 still need validation:

| Issue | Title | Claimed Severity |
|-------|-------|------------------|
| 002.4 | Semaphore Starvation | HIGH |
| 002.5 | AI Registry Leakage | HIGH |
| 002.6 | In-Progress Deadlock | HIGH |
| 002.7 | Failed Components Collision | HIGH |
| 002.8 | Tailwind Compiler State | MEDIUM |
| 002.9 | Tailwind Cache Environment Scope | HIGH |

---

## Appendix: Validation Methodology

1. **Code Location Verification**: Confirmed file paths and line numbers exist
2. **Pattern Matching**: Verified code matches documented problem description
3. **Mitigation Check**: Searched for existing AsyncLocalStorage or scoping
4. **Production Path Analysis**: Traced actual call paths, not hypothetical ones
5. **Multi-AI Consensus**: Used 3 parallel Claude code-reviewer agents

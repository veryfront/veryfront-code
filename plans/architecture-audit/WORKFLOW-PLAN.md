# Architecture Audit Workflow Plan

## Overview

This document defines the systematic workflow for processing the veryfront-renderer architecture audit using the **Full Double Diamond Process** with **Multi-AI Validation**.

**Goal**: Validate & prioritize issues before planning fixes
**Validation Method**: Multi-AI code review + Reproducing tests + Peer consensus
**Autonomy**: Full autonomy with end-of-phase review
**Constraints**: Test coverage required, One PR per issue, Documentation updates

---

## Audit Inventory Summary

| Chapter | Topic | Sub-Issues | Critical | High | Medium |
|---------|-------|------------|----------|------|--------|
| 001 | Adapter Divergence | 6 | 2 | 3 | 1 |
| 002 | Global State & Multi-Tenant | 9 | 3 | 4 | 2 |
| 003 | Cache Behavior | 4 | 2 | 2 | 0 |
| 004 | Bundle Dependencies | 6 | 0 | 3 | 3 |
| 005 | Router Divergence | 5 | 0 | 2 | 3 |
| 006 | Runtime Conditionals | 3 | 0 | 1 | 2 |
| 007 | Config Normalization | 7 | 1 | 3 | 3 |
| 008 | Userland Config | 5 | 1 | 2 | 2 |
| 009 | Timeout Handling | 6 | 1 | 3 | 2 |
| 010 | Error Handling | 6 | 0 | 4 | 2 |
| 011 | Import Rewriting | 5 | 0 | 2 | 3 |
| 012 | HTTP Clients | 5 | 0 | 3 | 2 |
| 013 | Cache Key Patterns | 3 | 0 | 2 | 1 |
| 014 | Deployment Modes | 2+ | 0 | 1 | 1+ |
| **Total** | | **~72** | **10** | **35** | **27** |

---

## The Double Diamond Process

```
    DISCOVER          DEFINE           DEVELOP          DELIVER
   ◢████████◣      ◢████████◣      ◢████████◣      ◢████████◣
  ◢██████████◣    ◢██████████◣    ◢██████████◣    ◢██████████◣
 ◢████████████◣  ◢████████████◣  ◢████████████◣  ◢████████████◣
◢██████████████◣◢██████████████◣◢██████████████◣◢██████████████◣
     DIVERGE         CONVERGE        DIVERGE         CONVERGE

   Research &        Problem         Solution         Final
   Exploration       Definition      Generation       Delivery
```

For each issue, we apply this process with multi-AI validation gates.

---

## Phase 1: DISCOVER (Research & Validation)

### Objective
Validate that each documented issue is real and accurately described.

### Process Per Chapter

```
┌─────────────────────────────────────────────────────────────────┐
│ DISCOVER PHASE - Multi-AI Issue Validation                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. READ ISSUE DOCUMENTATION                                    │
│     └─ Load chapter summary + all sub-issue files               │
│                                                                 │
│  2. MULTI-AI CODE ANALYSIS                                      │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Claude (Code Reviewer Persona)                       │    │
│     │ • Verify code locations exist                        │    │
│     │ • Confirm problematic patterns match description     │    │
│     │ • Identify any additional instances not documented   │    │
│     └─────────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Gemini (Second Opinion)                              │    │
│     │ • Independent verification of the issue              │    │
│     │ • Challenge severity assessment                      │    │
│     │ • Suggest alternative interpretations                │    │
│     └─────────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Codex (Implementation Focus)                         │    │
│     │ • Assess fix complexity                              │    │
│     │ • Identify breaking change risk                      │    │
│     │ • Estimate effort                                    │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. REPRODUCE WITH TEST                                         │
│     └─ Write failing test that demonstrates the issue           │
│                                                                 │
│  4. CONSENSUS MEETING                                           │
│     └─ AI debate on severity, impact, and prioritization        │
│                                                                 │
│  OUTPUT: Validated Issue Report                                 │
│  • Confirmed: Yes/No/Partial                                    │
│  • Adjusted Severity: Same/Higher/Lower                         │
│  • Reproduction Test: Path to test file                         │
│  • Consensus Notes: Key points of agreement/disagreement        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Output Artifacts

For each chapter, produce:
- `{chapter}-validation-report.md` - Multi-AI validation results
- `tests/validation/{chapter}/*.test.ts` - Reproduction tests

---

## Phase 2: DEFINE (Problem Scoping)

### Objective
Precisely define what needs to be fixed, boundaries, and dependencies.

### Process Per Validated Issue

```
┌─────────────────────────────────────────────────────────────────┐
│ DEFINE PHASE - Problem Scoping                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SCOPE DEFINITION                                            │
│     • What exactly is broken?                                   │
│     • What is the expected behavior?                            │
│     • What is the current behavior?                             │
│     • What should NOT change?                                   │
│                                                                 │
│  2. DEPENDENCY MAPPING                                          │
│     • Which other issues depend on this fix?                    │
│     • Which fixes must come before this one?                    │
│     • What code will be affected?                               │
│                                                                 │
│  3. ACCEPTANCE CRITERIA                                         │
│     • Specific, measurable conditions for "fixed"               │
│     • Test scenarios that must pass                             │
│     • Performance/regression requirements                       │
│                                                                 │
│  4. RFC REVIEW (for CRITICAL/HIGH issues)                       │
│     └─ Multi-AI review of the RFC document                      │
│                                                                 │
│  OUTPUT: Issue Definition Document                              │
│  • Problem statement (1-2 sentences)                            │
│  • Scope boundaries                                             │
│  • Dependencies (before/after)                                  │
│  • Acceptance criteria checklist                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Dependency Graph

Build a directed graph of issue dependencies:

```
001.1-layout-bug ──────────────────┐
                                   ▼
001.4-layout-cache ──────────► UNIFIED-ADAPTER-RFC (001.0)
                                   ▲
001.5-config-loading ─────────────┘

002.1-head-collector ─────────┐
                              ▼
002.2-ssr-globals ────────► REQUEST-SCOPED-STATE-RFC (002.0)
                              ▲
002.3-react-cache ────────────┘
```

---

## Phase 3: DEVELOP (Solution Generation)

### Objective
Generate and validate fix implementations.

### Process Per Issue

```
┌─────────────────────────────────────────────────────────────────┐
│ DEVELOP PHASE - Implementation                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. SOLUTION DESIGN                                             │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Claude (Backend Architect)                           │    │
│     │ • Design the fix architecture                        │    │
│     │ • Consider multi-tenant implications                 │    │
│     │ • Identify edge cases                                │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  2. ALTERNATIVE EXPLORATION                                     │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Gemini (Alternative Approaches)                      │    │
│     │ • Propose 2-3 different solutions                    │    │
│     │ • Compare trade-offs                                 │    │
│     │ • Challenge the primary approach                     │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  3. IMPLEMENTATION                                              │
│     • Write the fix code                                        │
│     • Write/update tests                                        │
│     • Update documentation                                      │
│                                                                 │
│  4. SELF-REVIEW                                                 │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Claude (Code Reviewer)                               │    │
│     │ • Review own implementation                          │    │
│     │ • Check against acceptance criteria                  │    │
│     │ • Verify no regressions                              │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  OUTPUT: Implementation Package                                 │
│  • Code changes (staged, not committed)                         │
│  • Test changes                                                 │
│  • Documentation updates                                        │
│  • Self-review notes                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 4: DELIVER (Validation & Release)

### Objective
Final multi-AI validation before committing.

### Process Per Implementation

```
┌─────────────────────────────────────────────────────────────────┐
│ DELIVER PHASE - Final Validation                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. MULTI-AI CODE REVIEW                                        │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Claude (Security Auditor)                            │    │
│     │ • Check for security implications                    │    │
│     │ • Verify no new vulnerabilities introduced           │    │
│     │ • Review for OWASP top 10                            │    │
│     └─────────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Gemini (Fresh Eyes Review)                           │    │
│     │ • Review without prior context                       │    │
│     │ • Check code clarity and maintainability             │    │
│     │ • Verify the fix actually addresses the issue        │    │
│     └─────────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────────┐    │
│     │ Codex (Test Coverage)                                │    │
│     │ • Verify test coverage is adequate                   │    │
│     │ • Check edge cases are tested                        │    │
│     │ • Run mutation testing if applicable                 │    │
│     └─────────────────────────────────────────────────────┘    │
│                                                                 │
│  2. AUTOMATED VALIDATION                                        │
│     • Run full test suite                                       │
│     • Run linter and type checker                               │
│     • Run any integration tests                                 │
│                                                                 │
│  3. FINAL CONSENSUS                                             │
│     └─ AI debate: Is this ready to ship?                        │
│                                                                 │
│  4. COMMIT & PR                                                 │
│     • Atomic commit with detailed message                       │
│     • Create PR with full context                               │
│     • Link to issue documentation                               │
│                                                                 │
│  OUTPUT: Merged PR                                              │
│  • PR URL                                                       │
│  • Commit SHA                                                   │
│  • Updated issue status                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Execution Order

### Priority Tiers

**Tier 0: CRITICAL Issues (Fix First)**
Must be validated and fixed before anything else.

| Issue | Chapter | Title |
|-------|---------|-------|
| 001.1 | Adapter | The Layout Bug - App Router nested layouts ignored |
| 001.4 | Adapter | Layout Cache Without Project Scoping |
| 002.1 | Global State | Head Collector SSR Metadata Leakage |
| 002.2 | Global State | SSR Globals Domain/State Leakage |
| 002.3 | Global State | React Module Cache Version Mismatch |
| 003.1 | Cache | SSR Module Path Mismatch |
| 003.3 | Cache | Multi-tenancy Cache Isolation |
| 007.3 | Config | Default Config Shared Reference |
| 008.2 | Userland | Unsafe Config Execution |
| 009.1 | Timeout | Global Semaphores No Project Isolation |

**Tier 1: HIGH Issues (Fix Next)**
Important but not immediately breaking.

**Tier 2: MEDIUM Issues (Systematic Cleanup)**
Technical debt and maintainability improvements.

### Recommended Chapter Order

Based on dependencies and impact:

```
1. Chapter 002 (Global State)     - Foundation for multi-tenancy
   └─ Unlocks safe fixes for everything else

2. Chapter 001 (Adapter)          - Core abstraction layer
   └─ Many issues stem from adapter divergence

3. Chapter 003 (Cache)            - Depends on proper isolation
   └─ Can't fix caching without proper state isolation

4. Chapter 009 (Timeout)          - Critical for reliability
   └─ Prevents cascading failures

5. Chapter 010 (Error Handling)   - Improves debugging
   └─ Makes subsequent work easier

6. Chapter 007 (Config)           - Framework behavior
   └─ Affects many downstream features

7. Chapter 008 (Userland Config)  - User-facing
   └─ Builds on normalized config

8. Chapter 005 (Router)           - After adapter unification
   └─ Benefits from unified adapter interface

9. Chapter 004 (Dependencies)     - Build correctness
   └─ Can be done in parallel with others

10. Chapter 011 (Import Rewriting) - Advanced transforms
    └─ Lower priority, more complex

11. Chapter 012 (HTTP Clients)    - Infrastructure
    └─ Incremental improvements

12. Chapter 013 (Cache Keys)      - Standardization
    └─ Polish after main fixes

13. Chapter 006 (Runtime)         - Cleanup
    └─ Low impact improvements

14. Chapter 014 (Deployment)      - Environment handling
    └─ Final polish
```

---

## Multi-AI Orchestration

### Available Providers

| Provider | CLI Tool | Strengths | Use For |
|----------|----------|-----------|---------|
| Claude | `claude` | Architecture, Security, Deep Analysis | Primary implementation, security review |
| Gemini | `gemini` | Fresh perspective, Alternative approaches | Second opinion, challenging assumptions |
| Codex | `codex` | Implementation, Test coverage | Effort estimation, test validation |

### AI Assignment Matrix

| Phase | Primary AI | Secondary AI | Validator AI |
|-------|------------|--------------|--------------|
| DISCOVER | Claude (Reviewer) | Gemini | Codex |
| DEFINE | Claude (Architect) | - | Gemini |
| DEVELOP | Claude (Developer) | Gemini | Claude (Reviewer) |
| DELIVER | Claude (Security) | Gemini | Codex |

### Consensus Protocol

For CRITICAL issues, require 2/3 AI agreement before proceeding:

```
IF all_agree:
  PROCEED with confidence
ELIF two_agree:
  PROCEED with the majority view, document dissent
ELIF none_agree:
  ESCALATE to human review
```

---

## Tracking & Status

### Issue Status Flow

```
DOCUMENTED → VALIDATING → VALIDATED → DEFINING → DEFINED →
DEVELOPING → DEVELOPED → REVIEWING → APPROVED → MERGED
```

### Progress Dashboard

Update `WORKFLOW-STATUS.md` after each phase:

```markdown
# Architecture Audit Progress

## Summary
- Total Issues: 72
- Validated: 0
- In Progress: 0
- Completed: 0

## Chapter Status

| Chapter | Status | Critical | High | Medium | Progress |
|---------|--------|----------|------|--------|----------|
| 001 | Not Started | 2 | 3 | 1 | ░░░░░░░░░░ 0% |
| 002 | Not Started | 3 | 4 | 2 | ░░░░░░░░░░ 0% |
| ... | ... | ... | ... | ... | ... |
```

---

## Commands Reference

### Starting the Workflow

```bash
# Begin with Chapter 002 (Global State) - highest priority
/octo:probe "Validate architecture audit issues in chapter 002"

# Or start full embrace workflow
/octo:embrace "Process architecture audit chapter 002"
```

### Phase Commands

```bash
# Discovery phase with multi-AI
/octo:discover "Validate issue 002.1 head collector leakage"

# Definition phase
/octo:define "Scope fix for issue 002.1"

# Development phase with TDD
/octo:tdd "Fix issue 002.1 with test-first approach"

# Delivery phase with review
/octo:review "Review implementation of issue 002.1 fix"
```

### Multi-AI Commands

```bash
# Force parallel AI execution
/octo:multi "Review issue 002.1 - is this really CRITICAL?"

# AI debate on approach
/octo:debate "Best approach to fix head collector leakage"
```

---

## Next Steps

1. **Create session intent contract** at `.claude/session-intent.md`
2. **Start with Chapter 002** (Global State) - foundation for everything
3. **Validate CRITICAL issues first** using multi-AI review
4. **Build reproduction tests** before fixing
5. **Track progress** in `WORKFLOW-STATUS.md`

---

## Appendix: File Paths

### Audit Documents
- `/plans/architecture-audit/001-adapter-divergence.md`
- `/plans/architecture-audit/002-global-state.md`
- `/plans/architecture-audit/003-cache-behavior.md`
- ... (14 chapters total)

### RFC Documents
- `/plans/architecture-audit/001.0-unified-adapter-rfc.md`
- `/plans/architecture-audit/002.0-request-scoped-state-rfc.md`
- `/plans/architecture-audit/003.0-cache-consistency-rfc.md`
- ... (one RFC per chapter)

### Output Locations
- `/plans/architecture-audit/validation/` - Validation reports
- `/plans/architecture-audit/status/` - Progress tracking
- `/tests/validation/` - Reproduction tests

# 040 - Timing-Safe Token Comparison

## Priority: P0 - SECURITY

## North Star
All token/secret comparisons use constant-time algorithms. Timing attacks impossible.

## References
- Issue: [016.1-timing-attack.md](../016.1-timing-attack.md)

## The Problem

Token comparison with `===` leaks timing information, allowing attackers to extract secrets byte-by-byte.

## Checklist
- [ ] Add `timingSafeEqual` utility to security module
- [ ] Audit all auth-related string comparisons
- [ ] Replace `===` with `timingSafeEqual` for secrets
- [ ] Add constant-time length comparison
- [ ] Add timing attack test

## Acceptance Criteria
- [ ] All token comparisons use `timingSafeEqual`
- [ ] No `===` on secrets in auth paths
- [ ] Response time consistent regardless of match position

## Quality Gates
- [ ] Security audit passes
- [ ] Test verifies constant time behavior
- [ ] No performance regression (overhead < 1ms)

## Test Coverage
- [ ] Unit: timingSafeEqual returns correct results
- [ ] Unit: Response time consistent for different inputs
- [ ] Integration: Auth timing doesn't leak token info

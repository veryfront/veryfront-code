# 041 - innerHTML Sanitization

## Priority: P0 - SECURITY

## North Star
All dynamic HTML rendering sanitized. XSS impossible through AI tool outputs.

## References
- Issue: [016.2-innerhtml-sanitization.md](../016.2-innerhtml-sanitization.md)

## The Problem

AI tools render content to DOM using `innerHTML` without sanitization, enabling XSS attacks.

## Checklist
- [ ] Add DOMPurify dependency
- [ ] Create `safeInnerHTML` utility
- [ ] Audit all `innerHTML` assignments
- [ ] Replace with sanitized version
- [ ] Add CSP headers as defense-in-depth
- [ ] Add XSS payload test suite

## Acceptance Criteria
- [ ] No direct `innerHTML` assignments with untrusted data
- [ ] All AI outputs sanitized before rendering
- [ ] CSP blocks inline script execution

## Quality Gates
- [ ] XSS payload suite passes (no alerts)
- [ ] Allowed HTML still renders correctly
- [ ] Performance overhead < 10ms per sanitization

## Test Coverage
- [ ] Unit: safeInnerHTML strips dangerous content
- [ ] Unit: Allowed tags/attrs preserved
- [ ] Integration: AI tool outputs safe

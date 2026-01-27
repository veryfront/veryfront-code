# 052 - Event Listener Cleanup Pattern

## Priority: P3 - MEMORY

## North Star
All event listeners cleaned up on unmount. No listener accumulation on global objects.

## References
- Issue: [018.3-event-listener-cleanup.md](../018.3-event-listener-cleanup.md)

## The Problem

`addEventListener` on window/document without corresponding `removeEventListener` on cleanup.

## Checklist
- [ ] Audit global event listener registrations
- [ ] Implement AbortController pattern
- [ ] Add cleanup to component effects
- [ ] Document listener cleanup pattern
- [ ] Consider ESLint rule

## Acceptance Criteria
- [ ] All global listeners have cleanup
- [ ] AbortController pattern documented
- [ ] No listener accumulation on navigation

## Quality Gates
- [ ] Navigation doesn't accumulate listeners
- [ ] Component mount/unmount balanced
- [ ] Memory stable during SPA navigation

## Test Coverage
- [ ] Unit: Listener removed on abort
- [ ] Unit: Multiple listeners all cleaned
- [ ] Integration: SPA navigation memory stable

## Implementation

```typescript
function setupComponent(element: HTMLElement): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  window.addEventListener("resize", handleResize, { signal });
  document.addEventListener("click", handleClick, { signal });

  return () => controller.abort();
}
```

# 016 - Unified Adapter Interface

## Priority: P3 - FOUNDATION

## North Star
Single adapter interface. Business logic never branches on adapter type.

## References
- Issue: [001-adapter-divergence.md](../001-adapter-divergence.md)
- RFC: [001.0-unified-adapter-rfc.md](../001.0-unified-adapter-rfc.md)

## Checklist
- [ ] Define `UnifiedFSAdapter` interface with primitives only
- [ ] `readFile(path): Promise<string>`
- [ ] `readFileBinary(path): Promise<Uint8Array>`
- [ ] `fileExists(path): Promise<boolean>`
- [ ] `walkDirectory(root, filter?): AsyncIterable<string>`
- [ ] `getProjectMetadata?(): { updatedAt?, id? }`
- [ ] Implement interface in Local, Veryfront, GitHub adapters
- [ ] Add conformance tests run against all adapters

## Acceptance Criteria
- [ ] All three adapters implement same interface
- [ ] No `isVeryfrontAdapter` checks in business logic
- [ ] No `isVirtualFilesystem` checks in business logic
- [ ] Same test suite passes for all adapters

## Quality Gates
- [ ] `grep -r "isVeryfrontAdapter\|isVirtualFilesystem" src/` returns 0 (outside adapter layer)
- [ ] Interface documented with behavior contracts
- [ ] All adapters pass conformance test suite

## Test Coverage
- [ ] Unit: Each adapter implements full interface
- [ ] Conformance: Same test file runs against all 3 adapters
- [ ] Integration: Render same page via all 3 adapters, compare output

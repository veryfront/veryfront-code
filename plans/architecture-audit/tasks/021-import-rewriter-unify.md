# 021 - Import Rewriter Unification

## Priority: P4 - MAINTENANCE

## North Star
Single import rewriter implementation. No duplicate regex/lexer code.

## References
- Issues: [011.1](../011.1-global-warning-state-pollution.md), [011.2](../011.2-ssr-browser-resolution-divergence.md), [011.3](../011.3-regex-vs-lexer-inconsistencies.md)
- RFC: [011.0-import-rewriting-rfc.md](../011.0-import-rewriting-rfc.md)

## Checklist
- [ ] Create `UnifiedImportRewriter` class
- [ ] Standardize on es-module-lexer (not regex)
- [ ] Single parse pass for all import types
- [ ] Remove warning state global (use request context)
- [ ] Support strategies: SSR, browser, MDX
- [ ] Reduce from 7 implementations to 1

## Acceptance Criteria
- [ ] Single import rewriter used by all code paths
- [ ] ~1,000 lines reduced to ~400 lines
- [ ] Same import resolves identically SSR vs browser
- [ ] No regex-based import parsing

## Quality Gates
- [ ] Single UnifiedImportRewriter class
- [ ] No `import.*rewriter` files outside unified module
- [ ] All imports parsed with es-module-lexer

## Test Coverage
- [ ] Unit: Static imports rewritten correctly
- [ ] Unit: Dynamic imports rewritten correctly
- [ ] Unit: Multi-line imports handled
- [ ] Conformance: SSR and browser resolve same URL

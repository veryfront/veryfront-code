# Packaging Plan: Preserve Capabilities While Slimming the Default Install

> Improve package/security posture without removing the features that make Veryfront differentiated.

## Goal

Keep Veryfront's current capabilities available, while making the default install and default npm package surface smaller, safer, and easier to justify in package scanning tools.

## Current Repo Facts

- The root package exposes a broad surface through `/home/runner/work/veryfront-code/veryfront-code/deno.json`, including framework, AI, embedding, workflow, MCP, provider, and CLI entrypoints.
- The npm build injects a `postinstall` script in `/home/runner/work/veryfront-code/veryfront-code/scripts/build/build-npm-dnt.ts`.
- Native install scripts are explicitly allowed for `sharp` and `onnxruntime-node` in `/home/runner/work/veryfront-code/veryfront-code/deno.json`.
- Local AI capabilities live under `/home/runner/work/veryfront-code/veryfront-code/src/provider/local/` and depend on `@huggingface/transformers` plus ONNX runtime.
- Embedding and RAG APIs live under `/home/runner/work/veryfront-code/veryfront-code/src/embedding/` and are part of the exported package surface.
- The README positions Veryfront as a full-stack React framework with built-in AI capabilities, so any packaging change must preserve that product story.

## Constraints

- Do not remove major capabilities such as agents, providers, embeddings, workflows, MCP, or CLI delivery.
- Keep the core SSR/routing/rendering/server framework usable with the default install.
- Avoid breaking current users without a deliberate compatibility path.
- Prefer explicit opt-in installation for heavier or higher-risk features rather than deleting them.

## Plan

### Phase 1: Inventory and Boundary Definition

- [ ] Classify the current public surface into:
  - core framework
  - cloud AI features
  - local AI features
  - embedding / upload extraction features
  - CLI / binary distribution features
- [ ] Identify which dependencies and install-time behaviors most affect package scanning and default install risk.
- [ ] Decide the smallest boundary that separates "default framework" from "optional heavy capabilities" without weakening the product.

### Phase 2: Preserve API Shape While Changing Packaging

- [ ] Keep the main `veryfront` package focused on framework fundamentals and stable high-value APIs.
- [ ] Move local AI functionality behind an explicit opt-in package or install target.
- [ ] Move embedding and upload-extraction functionality behind the same opt-in boundary when they require the heavier AI/runtime stack.
- [ ] Re-evaluate whether CLI binary bootstrap belongs in the main npm package or a dedicated CLI distribution package.
- [ ] Keep compatibility shims or stable entrypoints where practical so migration is additive, not disruptive.

### Phase 3: User Experience Safeguards

- [ ] Ensure optional features fail with direct install guidance instead of generic runtime errors.
- [ ] Preserve automatic capability detection when optional packages are installed.
- [ ] Document the new install matrix clearly:
  - framework only
  - framework + cloud AI
  - framework + local AI
  - framework + embeddings / RAG
  - CLI / binary install paths

### Phase 4: Validation

- [ ] Verify that the default install still supports the core framework story in the README.
- [ ] Verify that local AI still works when the opt-in package is installed.
- [ ] Verify that embedding / RAG flows still work when the opt-in package is installed.
- [ ] Verify that npm/binary distribution remains documented and testable.
- [ ] Re-check package/security scanning posture after the dependency tree is reduced.

## Recommended Implementation Order

1. Isolate `/home/runner/work/veryfront-code/veryfront-code/src/provider/local/`
2. Isolate `/home/runner/work/veryfront-code/veryfront-code/src/embedding/`
3. Revisit npm `postinstall` and CLI/binary packaging
4. Update docs, export verification, and migration guidance

## Success Criteria

- Default install remains strong for SSR, routing, rendering, middleware, and server use cases.
- Local AI, embeddings, and related advanced features still exist and still work when explicitly installed.
- The package story becomes easier to defend in security/package scanning tools because the default package no longer pulls in all heavy capabilities automatically.
- Existing users have a clear migration path instead of a surprise capability loss.

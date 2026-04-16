# Architecture Issues and Strengthening Directions

This document records current architectural pressure points in `veryfront-code`.

It is not a generic backlog. It exists to make the architecture more truthful, easier to evolve, and easier to document without overstating boundaries that are not actually enforced.

## Scope

Use this page for issues that affect:

- dependency boundaries,
- public vs internal contracts,
- platform portability,
- framework-native AI integration,
- and architectural documentation accuracy.

Do not use it for isolated bugs, minor refactors, or feature requests.

## Current Issues

### 1. The layer model is cleaner than the codebase

The current architecture docs describe strict bottom-up dependency layers.

That is useful as an aspiration, but it is not the current reality. Some modules cross the proposed boundaries for valid practical reasons, especially around:

- platform cloud/bootstrap logic,
- filesystem invalidation hooks,
- rendering context,
- chat UI facades,
- and discovery/bootstrap code.

Impact:

- the docs can overclaim architectural enforcement,
- contributors can get the wrong picture of what boundaries are real,
- cleanup work becomes harder because intended and actual boundaries are mixed.

Target direction:

- document preferred dependency direction, not fake-strict layering,
- explicitly identify bridge modules,
- only call a boundary enforced if tooling actually checks it.

### 2. AI is native, but the boundaries should reflect that more honestly

Veryfront's AI primitives are first-class framework primitives, not optional add-ons.

That should remain true in the docs and architecture. At the same time, the AI surface should not be described as an isolated leaf layer if it already participates in shared framework concerns like:

- transport contracts,
- workflow types,
- chat UI integration,
- and platform-aware runtime selection.

Impact:

- AI can look bolted on in one diagram and over-isolated in another,
- boundary work gets framed as optional instead of core framework design.

Target direction:

- model AI as a native platform domain,
- separate primitives, orchestration, and bridge/facade surfaces,
- avoid describing AI as depending on "foundation only" unless that is actually enforced.

### 3. Bridge modules are real and should be named explicitly

Some modules exist specifically to cross domain boundaries. Today they are easy to mistake for cleanly layered internals.

Examples of bridge/facade roles include:

- chat surfaces that span React UI and agent runtime,
- discovery/bootstrap code that touches multiple registries and runtimes,
- AG-UI adapters and internal compatibility wrappers,
- cloud bootstrap/context resolution,
- and invalidation hooks that coordinate rendering, modules, transforms, and styles.

Impact:

- bridge code can look like accidental layering violations,
- reviewers and contributors lack a shared standard for what cross-domain code is allowed to do.

Target direction:

- define bridge modules as a first-class concept,
- keep them thin and explicit,
- prefer contracts and narrow interfaces over incidental reach-through imports.

### 4. `platform/` mixes low-level runtime concerns with higher-level integration concerns

The platform area contains true runtime abstractions, but it also contains logic that is specific to Veryfront cloud/bootstrap/invalidation behavior.

That makes "platform" mean two different things:

- core runtime portability,
- and framework/platform integration glue.

Impact:

- low-level abstractions become harder to reason about,
- platform portability and Veryfront-specific integration are harder to separate.

Target direction:

- split platform-core from platform-integrations conceptually, and eventually structurally where it pays off,
- keep adapters and compat utilities lower-level,
- move cloud/bootstrap/invalidation glue behind explicit integration surfaces where possible.

### 5. Server, rendering, and build form a coupled runtime cluster

The docs currently present these areas as cleaner layers than they are.

In practice, server, rendering, build, cache, module loading, and request context participate in one runtime cluster with a lot of coordination.

Impact:

- contributors may expect stricter separations than the implementation provides,
- refactors can fail because they target the diagram instead of the real runtime shape.

Target direction:

- document these as closely related runtime subsystems,
- reserve strict layering claims for boundaries that are actually maintained.

### 6. Public contracts and compatibility wrappers need clearer separation

This came up most clearly in MCP vs internal AG-UI transport, but the pattern is broader.

The codebase has both:

- canonical package-level contracts,
- and internal/control-plane compatibility wrappers.

Impact:

- docs can accidentally teach wrapper routes as if they were the stable contract,
- future cleanup gets harder because wrappers acquire accidental authority.

Target direction:

- label wrappers as wrappers everywhere,
- keep canonical contracts easy to identify,
- prefer package-level contract docs over route-specific implementation details.

## Strengthening Directions

### 1. Replace strict layers with domains and bridges

Prefer an architecture model built from:

- native domains,
- shared contracts,
- bridge modules,
- and entrypoints/orchestrators.

This is closer to the codebase and closer to modern framework architecture practice.

### 2. Add boundary checks only where we want enforcement

If a boundary matters, enforce it with tooling.

Examples:

- import boundary linting,
- dependency graph checks,
- allowed-import rules for bridge modules.

Until then, describe such boundaries as intended, not enforced.

### 3. Keep bridge modules thin

Bridge modules are acceptable when they are explicit.

They become a problem when they silently become new centers of gravity.

Rule of thumb:

- orchestration is fine,
- hidden ownership of multiple domains is not.

### 4. Keep AI native in the architecture story

The right question is not whether AI belongs in the framework. It does.

The right question is how to keep AI-native architecture understandable:

- primitives,
- orchestration,
- transport/contracts,
- UI/facades,
- and platform-aware runtime integration.

### 5. Keep this document small and current

This page should stay short.

If an issue becomes resolved, remove it or turn the outcome into:

- a decision record,
- a stronger architecture diagram,
- or an enforced boundary rule.

# Runtime adapters

This page describes runtime adapter capability boundaries. It does not cover
deployment targets or build output generation.

## Responsibility

Runtime adapters normalize Deno, Node.js, Bun, and constrained edge runtime
capabilities behind shared server, filesystem, and environment access patterns.

Primary source areas:

- `src/platform/`
- `src/platform/adapters/`
- `src/platform/cloud/`
- `src/fs/`
- `src/server/project-env/`

## Runtime flow

1. Runtime detection selects an adapter for the current host.
2. Adapter code exposes HTTP serving, filesystem, environment, and process
   capabilities in a shared shape.
3. Virtual filesystem adapters can replace or augment local file access.
4. Project environment helpers resolve framework and project variables.

## Boundaries

- Runtime adapter support is separate from deployment product support.
- Build pipeline code can target a runtime, but adapters own runtime capability
  normalization.
- Security checks for paths and sandbox behavior belong in dedicated security
  modules.

## Change checks

- Update [support matrix](./18-support-matrix.md) when runtime support changes.
- Add runtime-specific tests or compatibility tests for adapter behavior changes.

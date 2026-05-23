---
title: "Extension system"
description: "How Veryfront Code extension factories, contracts, capabilities, setup, and teardown compose runtime behavior."
order: 7
---

Extensions package runtime capabilities behind contracts. They let a project add
providers, storage, parsing, auth, schema validation, observability, and other
infrastructure without changing the application code that consumes those
capabilities.

The extension system exists to keep infrastructure replaceable. Application code
should depend on a cache, provider, parser, or auth contract, not on the package
that happens to implement it.

## Core concepts

| Concept    | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| Extension  | A package or local module that adds one focused runtime capability.    |
| Factory    | A function that accepts config and returns an extension object.        |
| Contract   | A TypeScript interface consumed by framework code or other extensions. |
| Capability | A declared runtime permission or resource requirement.                 |
| Preset     | A grouped set of extensions that usually load together.                |

## Lifecycle

Veryfront discovers extension factories, expands presets, orders providers
before consumers, runs setup, serves the app, and runs teardown in reverse order
during shutdown or reload. This lifecycle makes shared resources explicit and
gives extensions a predictable place to open and release runtime resources.

Contracts are the important boundary. Consumers depend on contracts, not on a
specific package implementation. That keeps app code stable when a project swaps
a local adapter for a hosted or third-party implementation.

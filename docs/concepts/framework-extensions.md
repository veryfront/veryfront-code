---
title: "Framework extensions"
description: "How extensions package runtime infrastructure behind contracts."
order: 7
---

An extension packages runtime infrastructure behind a contract. Use one when
multiple parts of a project need the same configured capability, such as auth,
cache, a model provider, observability, content parsing, schema validation, or
sandboxing.

An extension is not an app feature. App code asks for the contract. The
extension decides which package, provider, setup, and teardown back that
contract.

## What extensions own

- **Factory**: Turns configuration into an extension.
- **Contract**: Defines what app code uses.
- **Capabilities**: Declare runtime needs such as filesystem, network, environment,
  process, or sandbox access.
- **Lifecycle**: Opens resources during setup and releases them during teardown.
- **Presets**: Group extensions that load together.

## When to use extensions

Use an extension when a runtime capability has to be configured once and reused
behind the same interface. Veryfront discovers extension factories, orders
providers before consumers, runs setup, serves the app, and runs teardown in
reverse order.

Do not create an extension for code that belongs to one app route or one
feature. Use a normal project module for that.

For implementation steps, see [Extensions](../guides/extensions.md) and
[Author extensions](../guides/extension-authoring.md).

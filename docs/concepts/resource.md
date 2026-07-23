---
title: "Resource"
description: "How resources expose readable project data through MCP."
order: 28
---

A resource owns readable project data. It defines a URI pattern, parameters, and
a loader that returns content.

Resources exist so assistants can inspect context without performing an action.
They are useful for documentation, project state, generated summaries, or other
data that should be loaded by name.

## Characteristics

- A URI pattern names the resource.
- Parameters select the specific data to load.
- A loader returns content.
- Optional subscriptions can expose updates when the resource changes.

Dynamic parameters use `:name` placeholders, such as `docs/:section`. Veryfront
decodes matched URI values, validates them through the resource schema, and
gives the parsed result to the loader or subscription. This keeps URI matching
separate from data validation and allows schemas to normalize values.
Each slash-delimited segment can contain at most one placeholder, so capture
boundaries stay deterministic. Inline suffixes such as `files/:name.json` are
supported.

In a URI with a scheme, colons in the opaque scheme payload remain literal.
For example, `urn:example:animal:ferret:nose` is one static resource URI, while
`resource://animals/:name` defines a parameter named `name`. Veryfront uses the
same compiled pattern for registry matching and MCP URI-template metadata.

Auto-discovered resources can receive their pattern from the source path.
Directly registered resources use an explicit pattern. Resource definitions are
immutable after creation, and a project registry rejects conflicting identities
or overlapping patterns with ambiguous specificity.

Loaders and subscriptions receive a lifecycle context with an optional abort
signal. Veryfront checks cancellation before validation and after loading.
Subscriptions also close their source iterator when cancellation happens,
iteration fails, or the consumer stops. Loaders must pass the signal to
cancellable downstream work.

MCP resource reads accept only JSON-serializable results within the transport
output limit. Direct resource calls return the loader's typed value without
transport serialization.

## Boundary

A resource is read. A tool is called. A prompt gives instructions. MCP servers
can expose all three, but each has a different contract.

This distinction matters because assistants should read context without calling
a mutating tool.

## Wrong fit

Do not use a resource for work that changes state, starts a process, or needs
approval. Use a tool, workflow, task, or run for executable work.

For API details, see [veryfront/resource](../api-reference/veryfront/resource.md).

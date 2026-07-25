---
title: "Resource"
description: "Why resources own readable project data and how they differ from tools."
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
- Direct application consumers can optionally subscribe to updates.

## Boundary

A resource is read. A tool is called. A prompt gives instructions. MCP servers
can expose all three, but each has a different contract.

This distinction matters because assistants should read context without calling
a mutating tool.

The current Veryfront MCP transport exposes resource reads and URI templates.
It does not advertise resource subscriptions. A resource's optional
`subscribe` function is therefore an application-level capability, not an MCP
subscription contract.

Resources can also remain available to application code while being hidden from
MCP clients. Setting `mcp.enabled` to `false` excludes the resource from MCP
lists, templates, and reads.

`mcp.cachePolicy` is currently a reserved compatibility field, not an enforced
cache contract. Do not rely on it for freshness or isolation until cache keys,
lifetimes, and invalidation semantics are defined.

## Wrong fit

Do not use a resource for work that changes state, starts a process, or needs
approval. Use a tool, workflow, task, or run for executable work.

For API details, see [veryfront/resource](../api-reference/veryfront/resource.md).

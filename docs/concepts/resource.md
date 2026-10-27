---
title: "Resource"
description: "How resources expose readable project data through MCP."
order: 28
---

A resource owns readable project data. It defines a URI pattern, parameters, and
a loader that returns content.

Assistants use resources to read documentation, project state, generated
summaries or other named context without changing it.

## Characteristics

- A URI pattern names the resource.
- Parameters select the specific data to load.
- A loader returns content.
- Optional subscriptions can expose updates when the resource changes.

## Boundary

A resource is read. A tool is called. A prompt gives instructions. MCP servers
can expose all three, but each has a different contract.

## Wrong fit

Do not use a resource for work that changes state, starts a process, or needs
approval. Use a tool, workflow, task, or run for executable work.

For API details, see [veryfront/resource](../api-reference/veryfront/resource.md).

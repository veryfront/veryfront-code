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

Resource URI identity is exact. Query and fragment variants do not silently
become part of a path parameter; reserved delimiters inside a parameter must be
percent-encoded. This keeps lookup, parameter validation, and the URI template
advertised to MCP clients aligned.

JSON is the default MCP content mode because it gives loaders a bounded,
data-only transport contract. A resource can instead declare text or binary
content together with its media type. The declared mode is checked against the
loader result before content crosses the MCP boundary. JSON and text content
fields are limited to four mebibytes. Blob content is limited to three
mebibytes of source bytes so its base64-encoded MCP field remains within the
same four-mebibyte bound.

Resource construction and registration capture the schema parser, loader,
subscription callback, metadata, and read context instead of retaining
caller-controlled accessors. Later mutation therefore cannot change the
advertised contract or swap runtime validation after registration. Unknown MCP
metadata fields fail at the boundary rather than being silently discarded.
Descriptions, titles, and definition IDs also have explicit limits so
discovery and list responses cannot grow from unbounded metadata.

MCP cancellation reaches the loader through its optional read context. The
server can stop waiting even when a loader ignores the signal, but the loader
must cooperate to stop its own I/O and side effects.

Resources can also remain available to application code while being hidden from
MCP clients. Setting `mcp.enabled` to `false` excludes the resource from MCP
lists, templates, and reads.

Resource MCP metadata does not accept `cachePolicy`. Earlier releases accepted
that field without enforcing it; it is now rejected instead of implying a
freshness or isolation guarantee that the transport cannot provide. Put caching
behind the loader or its data backend, where the application can define
credential-safe keys, lifetimes, invalidation, and failure behavior explicitly.

## Wrong fit

Do not use a resource for work that changes state, starts a process, or needs
approval. Use a tool, workflow, task, or run for executable work.

For API details, see [veryfront/resource](../api-reference/veryfront/resource.md).

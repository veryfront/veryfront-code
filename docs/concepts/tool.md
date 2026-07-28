---
title: "Tool"
description: "How tools expose one typed capability to agents, workflows, or MCP servers."
order: 22
---

A tool owns one callable capability. It defines input, output, and execution.

Tools exist because agents and workflows need safe ways to act. The model can
choose a tool, but the tool owns the deterministic code that runs.

## Characteristics

- Typed input describes what the caller must provide.
- Execution performs one operation.
- Output returns a structured result the caller can use.
- Errors describe why the operation could not complete.

## Boundary

Tools can be local project files, remote integration tools, or MCP-exposed
capabilities. The caller chooses when to invoke them. The tool owns how the work
runs.

Tool construction is an admission boundary. Veryfront snapshots provider-facing
JSON Schemas and MCP metadata and captures the parser and callbacks that define
execution. Later mutation of the configuration object cannot silently change
the admitted contract. Remote MCP sources apply the same rule to static
transport configuration; explicit resolver callbacks remain the request-time
extension point for rotating credentials or context-dependent routing.

A validator-backed schema serves two roles: it describes input to the model and
parses input before local execution. A raw JSON Schema serves only as
provider-facing metadata; the remote system or tool implementation owns its
semantic validation.

Remote catalogs are untrusted data. Veryfront bounds and validates definitions,
rejects partial or ambiguous catalogs, and revalidates project-scoped visibility
at execution time. Discovery therefore informs availability but does not grant
permanent execution authority.

Keep tools focused. A tool should do one thing, validate its input, and return a
clear result. If the operation grows into multiple stages, approvals, or retries,
move the coordination into a workflow.

## Wrong fit

Do not use a tool as a hidden workflow, long-running run, or large integration
layer. Use a workflow for process, a run for durable execution, and an
integration for reusable external service access.

For implementation steps, see [Tools](../guides/tools.md).

---
title: "Integration runtime"
description: "How Veryfront Code connector config, OAuth, token state, and remote tool execution interact."
order: 6
---

Integrations connect Veryfront agents and tools to external services. They keep
connector metadata, authorization state, and remote execution separate from
local agent behavior.

## Runtime flow

| Layer                   | Responsibility                                               |
| ----------------------- | ------------------------------------------------------------ |
| Project config          | Selects providers, tool allowlists, and per-user behavior.   |
| Connector catalog       | Describes available services and remote tools.               |
| OAuth and token storage | Owns user or project authorization state.                    |
| Remote execution        | Calls the external service through the configured API layer. |
| Agent or tool           | Decides when the integration capability is useful.           |

Config determines which integration tools are available. OAuth and token storage
determine which account can call them. The agent or workflow only sees a
callable capability; it does not own the provider authorization model.

## Project and per-user authorization

Project-level credentials fit service-owned automation. Per-user tokens fit
actions that must happen on behalf of the current user. Veryfront keeps those
modes explicit so a tool call cannot accidentally blur whose authority it uses.

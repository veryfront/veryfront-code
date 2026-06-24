---
title: "Integration"
description: "How integrations expose external service capabilities."
order: 30
---

An integration owns connector metadata, auth configuration, token state, and
remote tool discovery for an external service.

Integrations exist because external services have more than one concern. They
need metadata, OAuth or token setup, tool definitions, prompts, and sometimes
shared client code.

## Characteristics

- Metadata describes the external service.
- Auth configuration defines how users or projects connect.
- Token state records access for later calls.
- Remote tools expose service actions.
- Prompts and resources can describe common service workflows and context.

## Boundary

Use an integration when a project needs a third-party service such as GitHub,
Slack, or Google Drive. The integration owns access to the service. Agents,
tools, and workflows use the capabilities it exposes.

Keep product logic outside the integration. The integration should describe and
authorize the external capability.

Some integrations need a governed agent-facing layer rather than a raw provider
surface. Salesforce is the clearest example: see
[Salesforce integration](./salesforce-integration.md) for the rationale.

## Wrong fit

Do not create an integration for one small local helper. Use a tool when the
capability belongs only to one project and does not need shared auth, metadata,
or discovery behavior.

For implementation steps, see [Integrations](../guides/integrations.md).

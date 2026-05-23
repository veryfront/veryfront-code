---
title: "Integration"
description: "How integrations expose external service capabilities."
order: 27
---

An integration owns connector metadata, auth configuration, token state, and
remote tool discovery for an external service.

Use an integration when a project needs a third-party service such as GitHub,
Slack, or Google Drive. The integration owns access to the service. Agents and
tools use the capabilities it exposes.

Keep product logic outside the integration. The integration should describe and
authorize the external capability.

For implementation steps, see [Integrations](../guides/integrations.md).

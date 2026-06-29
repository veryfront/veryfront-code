---
title: "veryfront/webhook"
description: "Source-defined webhooks for Veryfront projects."
order: 35
---

## Import

```ts
import { discoverWebhooks, isWebhookDefinition, webhook } from "veryfront/webhook";
```

## Examples

### Run a workflow for urgent customer events

```ts
import { webhook } from "veryfront/webhook";

export default webhook({
  id: "customer-escalation",
  target: { kind: "workflow", id: "escalate-ticket" },
  eventFilter: {
    mode: "any",
    conditions: [
      { path: "severity", operator: "equals", value: "high" },
      { path: "priority", operator: "equals", value: "urgent" },
    ],
  },
});
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `discoverWebhooks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L17) |
| `isWebhookDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L36) |
| `webhook` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/factory.ts#L46) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `WebhookAgentMessageMapping` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L21) |
| `WebhookConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L34) |
| `WebhookDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L25) |
| `WebhookDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L8) |
| `WebhookDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L15) |
| `WebhookEventFilter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L16) |
| `WebhookEventFilterCondition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L10) |
| `WebhookEventFilterMode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L2) |
| `WebhookEventFilterOperator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L4) |

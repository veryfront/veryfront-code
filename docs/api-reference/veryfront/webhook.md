---
title: "veryfront/webhook"
description: "Source-defined webhooks for Veryfront projects."
order: 37
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
| `discoverWebhooks` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L18) |
| `isWebhookDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L37) |
| `webhook` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/factory.ts#L54) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `WebhookAgentMessageMapping` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L22) |
| `WebhookConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L35) |
| `WebhookDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L26) |
| `WebhookDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L9) |
| `WebhookDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L16) |
| `WebhookEventFilter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L17) |
| `WebhookEventFilterCondition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L11) |
| `WebhookEventFilterMode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L3) |
| `WebhookEventFilterOperator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L5) |

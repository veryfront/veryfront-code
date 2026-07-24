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
| `discoverWebhooks` | Discover and validate source-defined webhooks beneath the configured directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L19) |
| `isWebhookDefinition` | Return true only when every webhook field and nested invariant is valid. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L39) |
| `webhook` | Validate and normalize a source-defined webhook configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/factory.ts#L10) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `WebhookAgentMessageMapping` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L23) |
| `WebhookConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L36) |
| `WebhookDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L27) |
| `WebhookDiscoveryOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L9) |
| `WebhookDiscoveryResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L16) |
| `WebhookEventFilter` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L18) |
| `WebhookEventFilterCondition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L12) |
| `WebhookEventFilterMode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L4) |
| `WebhookEventFilterOperator` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L6) |

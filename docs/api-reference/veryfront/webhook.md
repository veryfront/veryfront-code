---
title: "veryfront/webhook"
description: "Source-defined webhooks for Veryfront projects."
order: 38
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
| `discoverWebhooks` | Discover, validate, and detach source-defined project webhooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L50) |
| `isWebhookDefinition` | Return whether a value satisfies the complete webhook definition contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L58) |
| `webhook` | Create a validated, detached source-defined webhook. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/factory.ts#L5) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `SourceTriggerDiscoveryError` | Sanitized failure reported while discovering one source-defined trigger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L36) |
| `SourceTriggerDiscoveryErrorCode` | Stable classification for a source-trigger discovery failure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L26) |
| `SourceTriggerDiscoveryResult` | Definitions and contained failures returned by source-trigger discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L54) |
| `SourceTriggerKind` | Source-defined trigger categories supported by discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/discovery.ts#L23) |
| `TriggerTarget` | Identifies the runtime primitive that a trigger starts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L7) |
| `TriggerTargetKind` | Trigger target categories supported by source-defined schedules and webhooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/trigger/target.ts#L4) |
| `WebhookAgentMessageMapping` | Prompt mapping required when a webhook starts an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L33) |
| `WebhookConfig` | Author input accepted by the webhook factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L55) |
| `WebhookDefinition` | Canonical source-defined webhook returned by validation and discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L39) |
| `WebhookDiscoveryOptions` | Options for discovering source-defined webhooks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L12) |
| `WebhookDiscoveryResult` | Valid webhooks and contained source-file failures. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L26) |
| `WebhookEventFilter` | Filter evaluated before a webhook starts its target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L25) |
| `WebhookEventFilterCondition` | One bounded event-field condition evaluated before a webhook starts its target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L15) |
| `WebhookEventFilterMode` | Combination rule applied to webhook filter conditions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L5) |
| `WebhookEventFilterOperator` | Supported comparison applied to one webhook event field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L8) |

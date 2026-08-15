---
title: "veryfront/webhook"
description: "Source-defined webhooks for Veryfront projects."
order: 42
---

## Import

```ts
import {
  discoverWebhooks,
  isWebhookDefinition,
  isWebhookId,
  prepareWebhookInvocation,
  webhook,
} from "veryfront/webhook";
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

| Name                       | Description                                                                   | Source                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `discoverWebhooks`         | Discover and validate source-defined webhooks across configured directories.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L29)   |
| `isWebhookDefinition`      | Return true only when every webhook field and nested invariant is valid.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L85)       |
| `isWebhookId`              | Return true for source webhook identifiers accepted by hosted reconciliation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/validation.ts#L247) |
| `prepareWebhookInvocation` | Revalidate and own a definition and payload before local webhook execution.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/runtime.ts#L168)    |
| `webhook`                  | Validate and normalize a source-defined webhook configuration.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/factory.ts#L10)     |

### Types

| Name                           | Description                                                          | Source                                                                                       |
| ------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `PreparedWebhookInvocation`    | Owned, cloud-compatible inputs for one local webhook target run.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/runtime.ts#L16)   |
| `WebhookAgentConversationMode` | Hosted conversation behavior for an agent-target webhook.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L38)     |
| `WebhookAgentMessageMapping`   | Prompt and optional hosted conversation mapping for an agent target. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L41)     |
| `WebhookConfig`                | Author-facing webhook configuration accepted by `webhook`.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L79)     |
| `WebhookDefinition`            | Validated source definition for one webhook trigger.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L63)     |
| `WebhookDiscoveryOptions`      | Inputs for deterministic source webhook discovery.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L12) |
| `WebhookDiscoveryResult`       | Valid webhooks and bounded per-file discovery diagnostics.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/discovery.ts#L26) |
| `WebhookEventFilter`           | Optional gate evaluated before a webhook target starts.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L30)     |
| `WebhookEventFilterCondition`  | One dot-path comparison against the webhook JSON payload.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L20)     |
| `WebhookEventFilterMode`       | Whether every filter condition or at least one condition must match. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L9)      |
| `WebhookEventFilterOperator`   | Comparisons supported by hosted and local webhook filtering.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/webhook/types.ts#L12)     |

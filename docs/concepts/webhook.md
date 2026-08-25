---
title: "Webhook"
description: "How webhooks turn external JSON events into filtered runs."
order: 33
---

A webhook owns an event trigger definition. It receives one bounded JSON
payload, optionally filters that payload, and starts one task, workflow, or
agent target. The target owns the business logic.

Source-defined `webhook()` configurations reconcile to hosted webhook records.
The local `veryfront webhook run` command applies the same payload limit,
filter, and prompt-template semantics to a fixture before it executes the
project target.

## Characteristics

- The webhook owns event acceptance, filtering, and target selection.
- A filtered event is ignored and does not start its target.
- The target owns retries, durable execution, tools, and business behavior.
- The webhook definition never owns the HTTP provider's signing or retry
  protocol.

Use an app or API route when the project needs to implement a provider-specific
HTTP endpoint itself. Use a source webhook when Veryfront should own the
hosted webhook endpoint and reconcile the trigger from project source.

## Payload boundary

A webhook payload must be data-only JSON whose serialized form is no larger
than 64 KiB. Nullish input becomes an empty object. Accessors, custom
prototypes, sparse arrays, cycles, non-finite numbers, and unsupported values
fail before local target discovery.

Target input follows the hosted run model:

- A task receives an object payload as its task configuration. A primitive
  payload is available under `payload`.
- A workflow receives `{ payload }`.
- An agent receives the rendered prompt and an isolated `payload` value in its
  forwarded context.

## Event filters

Filter paths are dot-separated object paths such as
`pull_request.state`. A path can select an array as its final value, but paths
do not traverse through array indexes.

```ts
import { webhook } from "veryfront/webhook";

export default webhook({
  id: "pull-request-review",
  target: { kind: "workflow", id: "review-pull-request" },
  eventFilter: {
    mode: "all",
    conditions: [
      { path: "action", operator: "in", value: ["opened", "reopened"] },
      { path: "pull_request.draft", operator: "equals", value: false },
      { path: "pull_request.labels", operator: "contains", value: "backend" },
    ],
  },
});
```

`all` requires every condition; `any` requires at least one. An empty
condition collection matches every payload. The supported comparisons are:

| Operator     | Match                                                                  |
| ------------ | ---------------------------------------------------------------------- |
| `equals`     | Structural JSON equality                                               |
| `not_equals` | Structural inequality; a missing path differs from a supplied value    |
| `in`         | The actual value structurally equals one entry in the configured array |
| `exists`     | The path resolves to a JSON value, including `null`                    |
| `contains`   | String substring or structurally equal array member                    |

## Agent prompt mapping

Agent targets require `agentMessage.promptTemplate`. Use `{{payload}}` for the
pretty-printed complete payload or `{{payload.dot.path}}` for one nested value:

```ts
import { webhook } from "veryfront/webhook";

export default webhook({
  id: "support-escalation",
  target: { kind: "agent", id: "support-agent", conversationMode: "create_new" },
  agentMessage: {
    promptTemplate: "Triage {{payload.summary}} for account {{payload.account.id}}.",
  },
});
```

If a template has no recognized payload placeholder, the complete payload is
appended in a JSON code block. Missing and null placeholder values render as an
empty string; objects and arrays render as formatted JSON.

Payload text is inserted verbatim. Template rendering is not an input-safety or
prompt-injection boundary. Agents that act on untrusted event fields should
apply an explicit input policy and keep authorization in application code.

## Agent conversation addressing

Conversation addressing belongs on the target. `conversationMode` may be
`create_new`, `existing`, or `none`, and `existing` requires a `conversationId`
UUID on the target. `none` is the default, and it is the wrong choice for an
agent that delegates: `invoke_agent` needs a hosted conversation to attach the
child run to. Local runs execute standalone and therefore reject attempts to
attach to an existing cloud conversation.

`agentMessage.conversationMode` and `agentMessage.conversationId` are the
legacy location for the same pair. They still work unchanged, and they are
removed in the next major release.

Declaring the pair in both places with the same value is accepted. That is how
one definition spans a platform upgrade: a hosted platform that predates
target-level addressing reads `agentMessage`, a platform that reads the target
reads the target, and both find the value you wrote.

```ts
import { webhook } from "veryfront/webhook";

export default webhook({
  id: "support-escalation",
  target: { kind: "agent", id: "support-agent", conversationMode: "create_new" },
  agentMessage: {
    promptTemplate: "Triage {{payload.summary}} for account {{payload.account.id}}.",
    conversationMode: "create_new",
  },
});
```

The two declarations must agree. `webhook()` rejects a disagreement with
`webhook-config-invalid` instead of choosing a winner, because honoring one
copy would detach the deployed webhook from the conversation the other copy
names.

For API details, see
[veryfront/webhook](../api-reference/veryfront/webhook.md).

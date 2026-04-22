---
title: "Conversation-backed lifecycle adapters"
description: "Higher-level hosted lifecycle adapters for conversation-backed root runs and child runs."
order: 2
---

# Conversation-backed lifecycle adapters

These helpers package the most repetitive control-plane lifecycle composition
for hosts that already use `veryfront/agent` public exports.

## Root runs

Use `createConversationHostedLifecycleAdapter()` when your host already knows
how to:

- start a conversation-owned run
- encode runtime chunks into control-plane events
- decide the final model/provider/usage payload

The adapter then owns:

- appending events through the canonical conversation-run events route
- mutating the live run cursor after successful appends
- finalizing or cancelling the canonical conversation run

## Child runs

Use `createConversationChildLifecycleAdapter()` when your host wants the
framework to own the default child lifecycle progression:

- pending
- running
- completed
- failed
- cancelled

The adapter composes:

- `publishInvokeAgentChildRunProgress()`
- `finalizeConversationAgentRun()`

and can either:

- publish lifecycle events through a shared parent-run publisher, or
- fall back to the canonical conversation-run events route.

## Host-local responsibilities that remain

Keep these concerns local to the host:

- auth / project access policy
- prompt and child-selection semantics
- transcript persistence rules
- retry / backoff / cursor-recovery policy
- product-specific logging and tracing

These helpers are meant to remove duplicated lifecycle plumbing, not to absorb
product policy.

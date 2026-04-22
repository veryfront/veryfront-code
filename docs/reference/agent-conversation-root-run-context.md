---
title: "Conversation root-run helpers"
description: "Helpers for starting and carrying conversation-backed root-run lineage through host execution flows."
order: 4
---

# Conversation root-run helpers

Use these helpers when a host wants to:

- start a canonical conversation-backed root run
- reuse an existing provided root-run descriptor
- derive one canonical context object that carries both durable run lineage and
  effective parent lineage

These helpers intentionally stay small. They package the repeated context and
lineage wiring, but they do not own:

- auth policy
- transcript persistence rules
- retry / cursor recovery policy
- host-specific tracing or logging

## Prepared context

Use `prepareConversationRootRunContext()` when your host wants one call that:

- starts or normalizes the root run
- derives effective parent lineage
- preserves an optional shared parent-run publisher

---
title: "Conversation run context helpers"
description: "Helpers for carrying conversation-backed run lineage and parent context through host execution flows."
order: 3
---

# Conversation run context helpers

Use `createConversationRunContext()` when your host wants one canonical object
for:

- the current conversation-backed run projection
- the effective parent run id
- the effective parent message id
- an optional shared parent-run publisher

This keeps parent lineage and durable run lineage aligned without re-deriving
those values in multiple host modules.

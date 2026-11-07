---
title: "Salesforce integration"
description: "Why Veryfront exposes Salesforce through a governed integration layer."
order: 35
---

Veryfront exposes Salesforce through its integration layer so project policy
controls the accounts and tools an agent can use.

For installation, OAuth, and service-account setup, see
[Set up Salesforce](../guides/integrations/salesforce.md).

## The design choice

Salesforce owns CRM data and CRM permissions. Veryfront owns the agent runtime:
which tools an agent can discover, which user or project connection is used,
which write actions are allowed, how tool calls are audited, and how Salesforce
context is combined with other systems such as Outlook, Gmail, Slack,
Confluence, Zendesk, or internal knowledge.

A support agent may need Salesforce records, email history and project knowledge
to answer one request. Veryfront applies project policy across those systems.

## Why not expose raw Salesforce MCP directly

The integration exposes customer lookup, account search, case activity,
knowledge search and selected writes. Read-only SOQL supports queries the
curated tools do not cover.

Read tools can be available by default. Writes such as creating a case, adding
a comment or updating a case can require explicit allowlisting before an agent
sees or calls them.

## Why this scales across Salesforce orgs

Salesforce orgs model customers differently: Accounts and Contacts, Person
Accounts, custom objects or combinations of these. Tools must preserve those
differences.

Veryfront instead keeps the durable layer close to Salesforce primitives:
Account, Contact, Case, CaseComment, Knowledge, Opportunity, Lead, object
metadata, and read-only SOQL. The agent can use prompts, skills, project
instructions, and org metadata to learn what "customer" means in a specific org.
That is more scalable than hard-coding one universal customer model.

The curated tools still use business names where they are stable enough, for
example "Find Customer" for support triage. Underneath, the implementation stays
grounded in Salesforce objects and metadata, so consultants can adapt behavior
to each customer org without replacing the integration architecture.

## What Veryfront adds

Veryfront adds a control plane around Salesforce access:

- Project and user-scoped OAuth connections.
- Environment-specific credentials for staging and production.
- Tool discovery that matches runtime execution policy.
- Explicit write-tool allowlisting for higher-risk operations.
- Integration with agent skills, prompts, evals, metrics, traces, and run logs.
- One agent workflow across Salesforce and non-Salesforce systems.

## When direct Salesforce MCP still makes sense

Direct Salesforce MCP can be the right choice for exploratory admin work, data
inspection, or a single assistant whose only job is to operate inside
Salesforce. It is less suitable as the default surface for Veryfront production
agents because it bypasses the product-level policy, observability, and
cross-system orchestration that Veryfront provides.

For production agents, start with the curated integration tools. Use metadata
and read-only queries for org-specific needs, and enable only the writes the
project requires.

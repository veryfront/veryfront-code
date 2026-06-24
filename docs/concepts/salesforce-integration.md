---
title: "Salesforce integration"
description: "Why Veryfront exposes Salesforce through a governed integration layer."
order: 35
---

Veryfront treats Salesforce as an integration behind the Veryfront tool and MCP
control plane, rather than asking agents to connect directly to Salesforce MCP.

This is not because Salesforce MCP is the wrong protocol. Salesforce MCP is a
useful provider surface for generic Salesforce access. The reason to route
Salesforce through Veryfront is that customer support agents need a governed
workflow surface, not only a raw CRM protocol surface.

## The design choice

Salesforce owns CRM data and CRM permissions. Veryfront owns the agent runtime:
which tools an agent can discover, which user or project connection is used,
which write actions are allowed, how tool calls are audited, and how Salesforce
context is combined with other systems such as Outlook, Gmail, Slack,
Confluence, Zendesk, or internal knowledge.

That split matters because "customer support" is rarely only Salesforce. A
support agent may need to read an Account and open Cases, inspect email history,
search knowledge, draft a response, add an internal case comment, and escalate
to a human. Direct Salesforce MCP can expose Salesforce capabilities, but it
does not by itself define the whole cross-system workflow or the Veryfront
project policy around that workflow.

## Why not expose raw Salesforce MCP directly

Raw provider MCP is attractive because it is broad and close to the source. For
expert users, broad access can be useful. For production agents, broad access is
also where most of the risk appears.

Veryfront needs the agent-visible surface to be stable, scoped, and explainable.
The Salesforce integration therefore exposes curated tools such as customer
lookup, account search, case listing, case activity, knowledge search, and
selected write actions. It also keeps a read-only SOQL escape hatch for expert
inspection when the curated tools are not enough.

This gives agents enough flexibility to work across Salesforce orgs while
avoiding a brittle tool list full of every possible provider operation. It also
lets Veryfront apply product policy consistently: read tools can be available by
default, while mutating tools such as creating a case, adding a case comment, or
updating a case can require explicit allowlisting before the agent sees or calls
them.

## Why this scales across Salesforce orgs

Salesforce orgs differ. One org may model customers with Accounts and Contacts.
Another may rely on Person Accounts, record types, custom fields, queues,
entitlements, or custom objects. A tool literally named `list_customers` would
hide those decisions behind an assumption that is often wrong.

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

The result is a smaller but more useful agent surface. It is not a claim that
Veryfront should reimplement every Salesforce API. The goal is to expose the
right Salesforce capabilities at the right abstraction level, with enough
metadata escape hatches for consultants and advanced agents to adapt to real
orgs.

## When direct Salesforce MCP still makes sense

Direct Salesforce MCP can be the right choice for exploratory admin work, data
inspection, or a single assistant whose only job is to operate inside
Salesforce. It is less suitable as the default surface for Veryfront production
agents because it bypasses the product-level policy, observability, and
cross-system orchestration that Veryfront provides.

Veryfront can still consume external MCP servers where that is the right
integration shape. For Salesforce, the preferred production path is the
Veryfront Salesforce integration: curated tools first, metadata and read-only
query escape hatches second, and explicitly enabled writes only where the
project has chosen to allow them.

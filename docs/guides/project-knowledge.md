---
title: "Search project knowledge"
description: "Search source-controlled knowledge by manifest metadata or semantic similarity."
order: 25
---

Use `veryfront/knowledge` when an agent, tool, or route needs files from the
project's `knowledge/` directory. Choose one of two paths:

- Manifest lookup searches canonical paths and YAML frontmatter without
  embeddings. It is deterministic and can retrieve one exact document.
- RAG retrieval indexes document bodies, performs semantic search, and formats
  the matches as prompt-ready context.

For turning PDFs, Office documents, and uploads into Markdown first, see
[CLI-first knowledge ingestion](./cli-knowledge-ingestion.md).

## Add knowledge files

Create Markdown files under `knowledge/`. YAML frontmatter must be a mapping:

```md title="knowledge/support/sso.md"
---
title: SSO recovery
description: Restore access after an identity-provider configuration change.
owner: support-platform
---

# SSO recovery

Verify the issuer, audience, callback URL, and current signing key.
```

Malformed YAML, scalar or sequence frontmatter, duplicate canonical paths, and
documents above the supported resource limits fail the lookup. They are not
silently treated as documents with empty metadata.

## Search paths and frontmatter

Create one helper and call `lookup()`:

```ts
import { projectKnowledge } from "veryfront/knowledge";

const knowledge = projectKnowledge({ projectDir: "." });
const page = await knowledge.lookup({
  query: "SSO recovery",
  limit: 8,
});

for (const item of page.data) {
  console.log(item.path, item.matched_fields, item.frontmatter);
}
```

Manifest search matches paths, frontmatter keys, and frontmatter values. It
does not search document bodies and does not return body content for ordinary
query results.

Inspect `page.mode` before treating results as evidence:

- `search` means at least one path or frontmatter field matched.
- `browse` means nothing matched. The returned data is a deterministic browse
  page, not an answer to the query.

This explicit browse mode lets an interactive agent discover available
knowledge without representing unrelated files as matches.

## Continue with a cursor

Pass the opaque `page_info.next` cursor back with the same query and pagination
options:

```ts
const first = await knowledge.lookup({
  query: "incident",
  limit: 8,
  shard_count: 4,
  shard_index: 0,
});

const second = first.page_info.next
  ? await knowledge.lookup({
    query: "incident",
    cursor: first.page_info.next,
    limit: 8,
    shard_count: 4,
    shard_index: 0,
  })
  : null;
```

Do not decode, edit, or persist a cursor as application data. A cursor binds
the normalized query, offset, page size, and shard selection. Mismatched or
non-canonical cursors fail before local traversal or hosted API calls.

## Retrieve one exact document

Use `lookup_target` when the caller already knows the canonical path:

```ts
const result = await knowledge.lookup({
  lookup_target: { path: "knowledge/support/sso.md" },
});

const document = result.data[0];
if (document) {
  console.log(document.content);
}
```

Exact lookup is the only manifest operation that returns `content`. Empty
documents are returned with `content: ""`; a missing path returns an empty
`data` array.

## Expose the lookup as a tool

Create the hosted-compatible `search_knowledge` tool when an agent should
choose queries and cursors:

```ts
import { createSearchKnowledgeTool } from "veryfront/knowledge";

export default createSearchKnowledgeTool({
  id: "search_knowledge",
  description: "Search the project's reviewed support knowledge.",
});
```

Tool metadata and knowledge configuration are snapshotted at construction.
Unknown, accessor-backed, blank, or out-of-range options fail immediately
instead of changing behavior later.

## Use hosted project content

When a lookup receives an authenticated hosted execution context, it reads the
request-scoped project source rather than the process's local `projectDir`.
This keeps a deployed production lookup on release-backed content even if the
same helper also has a local development path configured.

Production lookup requires a project identity, a non-empty request credential,
and either an immutable release ID or an environment name. A release ID takes
precedence when the runtime provides both release and environment metadata.
Preview lookup uses the request branch. An explicit empty credential or a
`project_reference` that differs from the request scope fails closed; it does
not inherit another request's authority.

## Index and retrieve semantically

Indexing is an explicit setup or deployment operation. Keep it out of a chat
request path:

```ts
import { projectKnowledge } from "veryfront/knowledge";

const knowledge = projectKnowledge({
  projectDir: ".",
  contentDir: "knowledge",
  storagePath: "data/knowledge-index.json",
  topK: 5,
});

await knowledge.index();
```

Retrieve semantic matches and formatted context later:

```ts
const controller = new AbortController();

const result = await knowledge.retrieve("How do I restore SSO?", {
  topK: 5,
  threshold: 0.65,
  abortSignal: controller.signal,
});

console.log(result.matches);
console.log(result.context);
```

`search()` returns the raw RAG matches. `retrieve()` returns the normalized
query, matches, and a deterministic context block. Treat retrieved text as
untrusted source material: require citations or another application-level
evidence policy rather than letting document text override system policy.

Cancellation propagates through RAG search, hosted listing requests, retry
backoff, and local/hosted manifest processing.

## Work within the limits

The public boundaries reject resource-amplifying inputs before work starts:

- Manifest queries are at most 500 normalized code units and 16 distinct
  searchable tokens.
- A lookup page contains 1 to 12 results; sharding supports 1 to 256 shards.
- A manifest contains at most 10,000 Markdown documents and 16 MiB of document
  text; one document is at most 1 MiB.
- Frontmatter is a bounded, acyclic, data-only mapping. At most 64 fields are
  searchable and six compact fields are returned.
- RAG calls return at most 100 matches. Formatted prompt context accepts at
  most 100 results and 1 MiB of UTF-8 text.
- Hosted listing is capped at 100 pages and rejects missing, empty, invalid, or
  repeated continuation cursors.

These are failure boundaries, not truncation targets. Lookup rejects an
oversized query instead of silently searching for a shortened value.

## Verify it worked

Test all three outcomes your application uses:

1. A metadata query returns `mode: "search"` and the expected canonical path.
2. An unrelated query returns `mode: "browse"` and is not treated as evidence.
3. An exact target returns the expected content, including an intentionally
   empty document.

For semantic retrieval, index a fixture, search for text that appears only in
that fixture, and assert its source path. Also abort one request in a test so
the application does not accidentally turn cancellation into a retry.

## Related

- [Build a RAG app](./build-a-rag-app.md): Add uploads, embeddings, and
  generated answers
- [CLI-first knowledge ingestion](./cli-knowledge-ingestion.md): Convert source
  documents into project knowledge
- [veryfront/knowledge](../api-reference/veryfront/knowledge.md): Full API
  reference

---
title: "Project knowledge"
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

Create Markdown files under `knowledge/`. Write YAML frontmatter as a mapping:

```md
---
title: SSO recovery
description: Restore access after an identity-provider configuration change.
owner: support-platform
---

# SSO recovery

Verify the issuer, audience, callback URL, and current signing key.
```

A file whose frontmatter fails to parse is still listed in the manifest, but
with no searchable metadata, so metadata queries cannot find it. Keep
frontmatter a valid YAML mapping so path and frontmatter search both work.

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
query results. Each result includes up to six compact frontmatter fields, with
`title`, `name`, `description`, `summary`, `source`, `source_type`, and
`added` prioritized and long values truncated.

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
the query, offset, page size, and shard selection. An invalid cursor, or a
cursor combined with a different query, fails with a validation error instead
of returning unrelated results.

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

Exact lookup is the only manifest operation that returns `content`. A missing
path returns an empty `data` array.

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

The tool validates its input, accepts the same query, cursor, limit, and shard
options as `lookup()`, and returns the same compact response shape as
Veryfront Cloud's hosted `search_knowledge` tool.

## Use hosted project content

When no local `projectDir` is configured and the lookup runs with an
authenticated request context (a request credential plus a project slug or
ID), it reads the request-scoped project source through the Veryfront API
instead of local files.

Production requests read release-backed content: an immutable release ID takes
precedence, then the environment name. Non-production requests read the
request branch, defaulting to `main`. Configuring `projectDir` keeps the
lookup on local files.

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
const result = await knowledge.retrieve("How do I restore SSO?", {
  topK: 5,
  threshold: 0.65,
});

console.log(result.matches);
console.log(result.context);
```

`search()` returns the raw RAG matches. `retrieve()` returns the normalized
query, matches, and a deterministic context block. Treat retrieved text as
untrusted source material: require citations or another application-level
evidence policy rather than letting document text override system policy.

## Work within the limits

- Queries are normalized before search: whitespace collapses to single spaces
  and text beyond 500 characters is dropped. Set `maxQueryChars` to change the
  bound.
- A manifest lookup requires a non-empty query or a lookup target.
- A lookup page contains at most 12 results; `limit` is clamped to the 1-12
  range and defaults to 8.
- `shard_count` must be at least 1 and `shard_index` must be inside the shard
  range; out-of-range values fail with a validation error.
- Each result carries at most 6 frontmatter fields, and each value is
  truncated to 240 characters.
- Semantic search defaults to the top 3 matches; set `topK` per helper or per
  call.

## Verify it worked

Test all three outcomes your application uses:

1. A metadata query returns `mode: "search"` and the expected canonical path.
2. An unrelated query returns `mode: "browse"` and is not treated as evidence.
3. An exact target returns the expected content.

For semantic retrieval, index a fixture, search for text that appears only in
that fixture, and assert its source path.

## Related

- [Build a RAG app](./build-a-rag-app.md): Add uploads, embeddings, and
  generated answers
- [CLI-first knowledge ingestion](./cli-knowledge-ingestion.md): Convert source
  documents into project knowledge
- [veryfront/knowledge](../api-reference/veryfront/knowledge.md): Full API
  reference

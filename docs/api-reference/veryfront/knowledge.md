---
title: "veryfront/knowledge"
description: "Project knowledge retrieval helpers."
order: 13
---

## Import

```ts
import {
  createSearchKnowledgeTool,
  formatKnowledgeContext,
  normalizeKnowledgeQuery,
  projectKnowledge,
  searchProjectKnowledge,
} from "veryfront/knowledge";
```

## Examples

### Search OKF knowledge metadata locally

Use this for the same compact frontmatter lookup shape as Veryfront Cloud's `search_knowledge` tool.

```ts
import { projectKnowledge } from "veryfront/knowledge";

const knowledge = projectKnowledge();

const result = await knowledge.lookup({
  query: "billing escalation",
  limit: 5,
});
```

### Expose local knowledge as the standard tool

Use this when local development needs the same `search_knowledge` tool contract that Veryfront Studio and Cloud provide through the platform.

```ts
import { createSearchKnowledgeTool } from "veryfront/knowledge";

export default createSearchKnowledgeTool();
```

### Retrieve embedded knowledge context

Use this when you want body-content retrieval for prompt context. Indexing remains explicit.

```ts
import { projectKnowledge } from "veryfront/knowledge";

const knowledge = projectKnowledge();
await knowledge.index();
const result = await knowledge.retrieve("SSO login failure");
```

## Exports

### Functions

| Name                        | Description                                                              | Source                                                                                      |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `createSearchKnowledgeTool` | Create a local `search_knowledge` tool backed by OKF frontmatter files.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)      |
| `formatKnowledgeContext`    | Format search results into a deterministic prompt context block.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L102) |
| `normalizeKnowledgeQuery`   | Normalize a knowledge query before retrieval.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L94)  |
| `projectKnowledge`          | Create a project knowledge helper backed by the configured RAG store.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L109) |
| `searchProjectKnowledge`    | Search local OKF frontmatter with the `search_knowledge` response shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)      |

### Types

| Name                                     | Description                                                        | Source                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `CreateSearchKnowledgeToolOptions`       | Options for the local `search_knowledge` tool factory.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledge`                       | Helper for indexing, looking up, and retrieving project knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledgeConfig`                 | Configuration for project knowledge indexing and retrieval.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L30) |
| `ProjectKnowledgeLookupFrontmatterField` | Frontmatter key/value returned by local knowledge lookup.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledgeLookupInput`            | Input compatible with the hosted `search_knowledge` tool.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledgeLookupItem`             | One local knowledge lookup result.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledgeLookupOutput`           | Output compatible with the hosted `search_knowledge` tool.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledgeLookupPageInfo`         | Cursor page info returned by local knowledge lookup.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledgeLookupShard`            | Shard metadata returned by local knowledge lookup.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |
| `ProjectKnowledgeResult`                 | Result returned from project knowledge retrieval.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L66) |
| `ProjectKnowledgeRetrieveOptions`        | Per-call options for project knowledge retrieval.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L61) |
| `SearchKnowledgeTool`                    | Tool type returned by `createSearchKnowledgeTool`.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts)     |

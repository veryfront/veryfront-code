---
title: "veryfront/knowledge"
description: "Project knowledge retrieval helpers."
order: 15
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

```ts
import { projectKnowledge } from "veryfront/knowledge";

const knowledge = projectKnowledge();
await knowledge.index();
const result = await knowledge.retrieve("SSO login failure");
```

## Exports

### Functions

| Name                        | Description                                                                                                                | Source                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `createSearchKnowledgeTool` | Create a local tool with the same id and response shape as hosted `search_knowledge`.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `formatKnowledgeContext`    | Format search results into a deterministic prompt context block.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `normalizeKnowledgeQuery`   | Normalize a knowledge query before retrieval.                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `projectKnowledge`          | Create a project knowledge helper backed by the configured RAG store.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `searchProjectKnowledge`    | Search the local OKF knowledge manifest with the same input/output shape as Veryfront Cloud's `search_knowledge` MCP tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |

### Types

| Name                                     | Description                                                 | Source                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `CreateSearchKnowledgeToolOptions`       |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledge`                       | Helper for indexing and retrieving project knowledge.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeConfig`                 | Configuration for project knowledge indexing and retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeLookupFrontmatterField` |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeLookupInput`            |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeLookupItem`             |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeLookupOutput`           |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeLookupPageInfo`         |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeLookupShard`            |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeResult`                 | Result returned from project knowledge retrieval.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `ProjectKnowledgeRetrieveOptions`        | Per-call options for project knowledge retrieval.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |
| `SearchKnowledgeTool`                    |                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts) |

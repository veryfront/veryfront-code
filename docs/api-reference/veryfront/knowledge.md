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

```ts
import { projectKnowledge } from "veryfront/knowledge";

const knowledge = projectKnowledge();
await knowledge.index();
const result = await knowledge.retrieve("SSO login failure");
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createSearchKnowledgeTool` | Create a project knowledge tool that uses local or active hosted content. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L1355) |
| `formatKnowledgeContext` | Format search results into a deterministic prompt context block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L1329) |
| `normalizeKnowledgeQuery` | Normalize and bound a knowledge query before retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L1310) |
| `projectKnowledge` | Create a project knowledge helper backed by the configured RAG store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L1389) |
| `searchProjectKnowledge` | Search the active OKF knowledge manifest with the same input and output shape locally and in Veryfront Cloud. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L1343) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateSearchKnowledgeToolOptions` | Options used to create a `search_knowledge` tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L234) |
| `ProjectKnowledge` | Helper for indexing and retrieving project knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L514) |
| `ProjectKnowledgeConfig` | Configuration for project knowledge indexing and retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L102) |
| `ProjectKnowledgeLookupFrontmatterField` | One compact frontmatter field returned by manifest lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L174) |
| `ProjectKnowledgeLookupInput` | Input accepted by manifest-based project knowledge lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L156) |
| `ProjectKnowledgeLookupItem` | One project knowledge manifest result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L182) |
| `ProjectKnowledgeLookupOutput` | Paginated output returned by manifest-based project knowledge lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L216) |
| `ProjectKnowledgeLookupPageInfo` | Cursor links for one knowledge lookup page. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L194) |
| `ProjectKnowledgeLookupShard` | Deterministic shard metadata for a knowledge lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L206) |
| `ProjectKnowledgeResult` | Result returned from project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L146) |
| `ProjectKnowledgeRetrieveOptions` | Per-call options for project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L140) |
| `RagSearchOptions` | Options accepted by RAG search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L179) |
| `RagSearchResult` | Result returned from RAG search. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L163) |
| `RagStoreBackend` | Supported RAG persistence backends. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/embedding/types.ts#L136) |
| `SearchKnowledgeTool` | Typed local or hosted project knowledge search tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L242) |

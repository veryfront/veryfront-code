---
title: "veryfront/knowledge"
description: "Project knowledge retrieval helpers."
order: 14
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
| `createSearchKnowledgeTool` | Create a local tool with the same id and response shape as hosted `search_knowledge`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/lookup.ts#L1485) |
| `formatKnowledgeContext` | Format search results into a deterministic, bounded prompt context block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/query.ts#L56) |
| `normalizeKnowledgeQuery` | Normalize and bound a knowledge query before retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/query.ts#L29) |
| `projectKnowledge` | Create a project knowledge helper backed by the configured RAG store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L63) |
| `searchProjectKnowledge` | Search the local OKF knowledge manifest with the same input/output shape as Veryfront Cloud's `search_knowledge` MCP tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/lookup.ts#L1459) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateSearchKnowledgeToolOptions` | Options for constructing the local search_knowledge tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L111) |
| `ProjectKnowledge` | Helper for indexing and retrieving project knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L123) |
| `ProjectKnowledgeConfig` | Configuration for project knowledge indexing and retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L9) |
| `ProjectKnowledgeLookupFrontmatterField` | Compact frontmatter field returned by manifest lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L70) |
| `ProjectKnowledgeLookupInput` | Input accepted by local and hosted OKF knowledge lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L52) |
| `ProjectKnowledgeLookupItem` | One knowledge manifest match. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L76) |
| `ProjectKnowledgeLookupOutput` | Hosted-compatible knowledge lookup response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L100) |
| `ProjectKnowledgeLookupPageInfo` | Cursor links returned by knowledge lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L85) |
| `ProjectKnowledgeLookupShard` | Shard metadata returned by knowledge lookup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L93) |
| `ProjectKnowledgeResult` | Result returned from project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L45) |
| `ProjectKnowledgeRetrieveOptions` | Per-call options for project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L40) |
| `SearchKnowledgeTool` | Local tool matching the hosted search_knowledge contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/types.ts#L117) |

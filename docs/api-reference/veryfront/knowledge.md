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
| `createSearchKnowledgeTool` | Create a local tool with the same id and response shape as hosted `search_knowledge`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L879) |
| `formatKnowledgeContext` | Format search results into a deterministic prompt context block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L859) |
| `normalizeKnowledgeQuery` | Normalize a knowledge query before retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L851) |
| `projectKnowledge` | Create a project knowledge helper backed by the configured RAG store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L895) |
| `searchProjectKnowledge` | Search the local OKF knowledge manifest with the same input/output shape as Veryfront Cloud's `search_knowledge` MCP tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L869) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateSearchKnowledgeToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L142) |
| `ProjectKnowledge` | Helper for indexing and retrieving project knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L223) |
| `ProjectKnowledgeConfig` | Configuration for project knowledge indexing and retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L55) |
| `ProjectKnowledgeLookupFrontmatterField` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L107) |
| `ProjectKnowledgeLookupInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L97) |
| `ProjectKnowledgeLookupItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L112) |
| `ProjectKnowledgeLookupOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L132) |
| `ProjectKnowledgeLookupPageInfo` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L119) |
| `ProjectKnowledgeLookupShard` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L126) |
| `ProjectKnowledgeResult` | Result returned from project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L91) |
| `ProjectKnowledgeRetrieveOptions` | Per-call options for project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L86) |
| `SearchKnowledgeTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L147) |

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
| `createSearchKnowledgeTool` | Create a local tool with the same id and response shape as hosted `search_knowledge`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L881) |
| `formatKnowledgeContext` | Format search results into a deterministic prompt context block. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L861) |
| `normalizeKnowledgeQuery` | Normalize a knowledge query before retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L853) |
| `projectKnowledge` | Create a project knowledge helper backed by the configured RAG store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L897) |
| `searchProjectKnowledge` | Search the local OKF knowledge manifest with the same input/output shape as Veryfront Cloud's `search_knowledge` MCP tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L871) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateSearchKnowledgeToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L141) |
| `ProjectKnowledge` | Helper for indexing and retrieving project knowledge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L222) |
| `ProjectKnowledgeConfig` | Configuration for project knowledge indexing and retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L54) |
| `ProjectKnowledgeLookupFrontmatterField` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L106) |
| `ProjectKnowledgeLookupInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L96) |
| `ProjectKnowledgeLookupItem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L111) |
| `ProjectKnowledgeLookupOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L131) |
| `ProjectKnowledgeLookupPageInfo` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L118) |
| `ProjectKnowledgeLookupShard` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L125) |
| `ProjectKnowledgeResult` | Result returned from project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L90) |
| `ProjectKnowledgeRetrieveOptions` | Per-call options for project knowledge retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L85) |
| `SearchKnowledgeTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L146) |

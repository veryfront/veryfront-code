---
title: "veryfront/knowledge"
description: "Project knowledge retrieval helpers."
order: 13
---

## Import

```ts
import {
  formatKnowledgeContext,
  normalizeKnowledgeQuery,
  projectKnowledge,
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

| Name                      | Description                                                           | Source                                                                                      |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `formatKnowledgeContext`  | Format search results into a deterministic prompt context block.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L102) |
| `normalizeKnowledgeQuery` | Normalize a knowledge query before retrieval.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L94)  |
| `projectKnowledge`        | Create a project knowledge helper backed by the configured RAG store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L109) |

### Types

| Name                              | Description                                                 | Source                                                                                     |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `ProjectKnowledge`                | Helper for indexing and retrieving project knowledge.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L73) |
| `ProjectKnowledgeConfig`          | Configuration for project knowledge indexing and retrieval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L30) |
| `ProjectKnowledgeResult`          | Result returned from project knowledge retrieval.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L66) |
| `ProjectKnowledgeRetrieveOptions` | Per-call options for project knowledge retrieval.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/knowledge/index.ts#L61) |

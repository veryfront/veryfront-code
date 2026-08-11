---
title: "veryfront/scaffold"
description: "Public scaffold surface - `veryfront/scaffold`. The starter templates live in this repository as real files (`cli/templates/files/`), compiled into `cli/templates/manifest.json` and shipped with every release. This module is how a caller outside the CLI - a hosted \"create project\" flow, for instance - gets the exact same bytes `veryfront init` writes, instead of maintaining its own copy of a starter project that drifts (veryfront-issue-inbox #475)."
order: 30
---

## Import

```ts
import {
  listScaffoldTemplates,
  materializeScaffold,
  resolveScaffoldTemplate,
  SCAFFOLD_TEMPLATE_ALIASES,
} from "veryfront/scaffold";
```

## Examples

### Materialize a project without touching a disk

```ts
import { materializeScaffold } from "veryfront/scaffold";

const { files } = await materializeScaffold({ template: "blank", projectName: "my-app" });
for (const file of files) await store(file.path, file.content);
```

## Exports

### Components

| Name                        | Description                                                                 | Source                                                                                              |
| --------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `SCAFFOLD_TEMPLATE_ALIASES` | Slugs other product surfaces use for a template this CLI names differently. | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L588) |

### Functions

| Name                      | Description                                                             | Source                                                                                              |
| ------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `listScaffoldTemplates`   | Every template slug a caller may ask for, canonical names and aliases.  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L603) |
| `materializeScaffold`     | Produce the complete contents of a new project without touching a disk. | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L638) |
| `resolveScaffoldTemplate` | Canonical starter template for a slug, or `null` when nothing matches.  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L595) |

### Types

| Name                         | Description | Source                                                                                              |
| ---------------------------- | ----------- | --------------------------------------------------------------------------------------------------- |
| `MaterializedScaffold`       |             | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L620) |
| `MaterializeScaffoldRequest` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L607) |
| `TemplateFile`               |             | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/templates/types.ts#L17)          |

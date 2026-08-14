---
title: "veryfront/scaffold"
description: "Create a Veryfront project from a starter template. `materializeScaffold()` returns the complete contents of a new project - every file `veryfront init` writes, including `package.json`, `AGENTS.md` and `.gitignore` - without touching a disk. A service that creates projects on a user's behalf can write them wherever it stores project files and get a project identical to one scaffolded on the command line. Templates are addressed by name (`minimal`, `ai-agent`, `docs-agent`, `agentic-workflow`, `multi-agent-system`, `coding-agent`, `saas-starter`). `listScaffoldTemplates()` enumerates every accepted name and `resolveScaffoldTemplate()` reports which starter a name selects."
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

### Create a project and store its files

```ts
import { materializeScaffold } from "veryfront/scaffold";

const { files } = await materializeScaffold({
  template: "minimal",
  projectName: "my-app",
});

for (const file of files) {
  console.log(file.path, file.content.length);
}
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
| `materializeScaffold`     | Produce the complete contents of a new project without touching a disk. | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L643) |
| `resolveScaffoldTemplate` | Canonical starter template for a slug, or `null` when nothing matches.  | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L595) |

### Types

| Name                         | Description                                                                       | Source                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `MaterializedScaffold`       | A new project: every file it starts with, plus anything worth telling the author. | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L625) |
| `MaterializeScaffoldRequest` | What to build: which starter, under what name, for which runtime.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/cli/shared/project-creation.ts#L608) |
| `TemplateFile`               |                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/templates/types.ts#L17)              |

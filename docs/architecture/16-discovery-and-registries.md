# Discovery and registries

This page describes project primitive discovery and registry population. It does
not cover extension package discovery.

## Responsibility

Discovery code scans project conventions, imports primitives, and registers
tools, agents, workflows, prompts, resources, and related runtime definitions.

Primary source areas:

- [`src/discovery/`](../../src/discovery/)
- [`src/registry/`](../../src/registry/)
- [`src/modules/`](../../src/modules/)
- [`src/tool/registry.ts`](../../src/tool/registry.ts)
- [`src/resource/registry.ts`](../../src/resource/registry.ts)
- [`src/workflow/registry.ts`](../../src/workflow/registry.ts)
- [`src/skill/registry.ts`](../../src/skill/registry.ts)

## Runtime flow

1. Discovery scans configured project directories for project primitives such as
   agents, tools, skills, prompts, resources, workflows, and tasks.
2. Module loading and transpilation prepare TypeScript or framework source for
   import.
3. Handlers identify supported primitive exports.
4. Registry managers store project-scoped definitions.
5. Runtime surfaces read from registries during server, agent, workflow, MCP,
   and Studio operations.

## Boundaries

- Discovery imports project primitives. Extension lifecycle is documented in
  [extension system](./12-extension-system.md).
- Registries provide storage and lookup. They do not execute primitives.

## Change checks

- Add fixture-based discovery tests when changing convention paths or export
  detection.
- Preserve project scoping to avoid cross-project registry leakage.

## Related guides

- [Project structure](../guides/project-structure.md)

## Related reference

- [`veryfront/agent`](../api-reference/veryfront/agent.md)
- [`veryfront/tool`](../api-reference/veryfront/tool.md)
- [`veryfront/workflow`](../api-reference/veryfront/workflow.md)

/**
 * Create a Veryfront project from a starter template.
 *
 * `materializeScaffold()` returns the complete contents of a new project -
 * every file `veryfront init` writes, including `package.json`, `AGENTS.md`
 * and `.gitignore` - without touching a disk. A service that creates projects
 * on a user's behalf can write them wherever it stores project files and get
 * a project identical to one scaffolded on the command line.
 *
 * Templates are addressed by name (`minimal`, `ai-agent`, `docs-agent`,
 * `agentic-workflow`, `multi-agent-system`, `coding-agent`, `saas-starter`).
 * `listScaffoldTemplates()` enumerates every accepted name and
 * `resolveScaffoldTemplate()` reports which starter a name selects.
 *
 * @module templates/scaffold
 *
 * @example Create a project and store its files
 * ```ts
 * import { materializeScaffold } from "veryfront/scaffold";
 *
 * const { files } = await materializeScaffold({
 *   template: "minimal",
 *   projectName: "my-app",
 * });
 *
 * for (const file of files) {
 *   console.log(file.path, file.content.length);
 * }
 * ```
 */

export {
  listScaffoldTemplates,
  materializeScaffold,
  resolveScaffoldTemplate,
  SCAFFOLD_TEMPLATE_ALIASES,
} from "../cli/shared/project-creation.ts";
export type {
  MaterializedScaffold,
  MaterializeScaffoldRequest,
} from "../cli/shared/project-creation.ts";
export type { TemplateFile } from "./types.ts";

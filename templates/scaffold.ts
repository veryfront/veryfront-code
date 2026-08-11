/**
 * Public scaffold surface — `veryfront/scaffold`.
 *
 * The starter templates live in this repository as real files
 * (`templates/files/`), compiled into `templates/manifest.json` and
 * shipped with every release. This module is how a caller outside the CLI —
 * a hosted "create project" flow, for instance — gets the exact same bytes
 * `veryfront init` writes, instead of maintaining its own copy of a starter
 * project that drifts (veryfront-issue-inbox #475).
 *
 * @module templates/scaffold
 *
 * @example Materialize a project without touching a disk
 * ```ts
 * import { materializeScaffold } from "veryfront/scaffold";
 *
 * const { files } = await materializeScaffold({ template: "blank", projectName: "my-app" });
 * for (const file of files) await store(file.path, file.content);
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

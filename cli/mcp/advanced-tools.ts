import type { MCPTool } from "./tools.ts";

import {
  vfCreateProject,
  vfListExamples,
  vfListIntegrations,
  vfListTemplates,
  vfListUsecases,
} from "./tools/catalog-tools.ts";
import {
  vfGetDebugContext,
  vfGetFlywheelStatus,
  vfHotReload,
  vfPreviewRoute,
  vfTriggerHmr,
  vfWaitForReady,
} from "./tools/dev-tools.ts";
import {
  vfGetComponentTree,
  vfGetProjectContext,
  vfListLocalProjects,
  vfListRoutes,
} from "./tools/project-tools.ts";
import { vfBuild } from "./tools/build-tool.ts";
import { vfRunLint } from "./tools/run-lint-tool.ts";
import { vfRunTests } from "./tools/run-tests-tool.ts";
import { vfGetConventions, vfScaffold } from "./tools/scaffold-tools.ts";
import { vfGetSkillReference, vfGetSkills } from "./tools/skill-tools.ts";
import { vfBootstrap } from "./tools/bootstrap-tool.ts";
import { cicdTools } from "./tools/cicd-tools.ts";
import { introspectionTools } from "./tools/introspection-tools.ts";

export const advancedTools: MCPTool[] = [
  ...cicdTools,
  ...introspectionTools,
  vfBootstrap,
  vfGetSkills,
  vfGetSkillReference,
  vfListLocalProjects,
  vfListExamples,
  vfListTemplates,
  vfListIntegrations,
  vfListUsecases,
  vfCreateProject,
  vfGetProjectContext,
  vfListRoutes,
  vfGetConventions,
  vfScaffold,
  vfPreviewRoute,
  vfGetDebugContext,
  vfGetComponentTree,
  vfBuild,
  vfHotReload,
  vfTriggerHmr,
  vfWaitForReady,
  vfRunLint,
  vfGetFlywheelStatus,
  vfRunTests,
];

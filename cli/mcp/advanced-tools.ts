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
import { vfRunLint } from "./tools/run-lint-tool.ts";
import { vfRunTests } from "./tools/run-tests-tool.ts";
import { vfGetConventions, vfScaffold } from "./tools/scaffold-tools.ts";
import { vfGetSkillReference, vfGetSkills } from "./tools/skill-tools.ts";
import { cicdTools } from "./tools/cicd-tools.ts";
import { introspectionTools } from "./tools/introspection-tools.ts";

export const advancedTools: MCPTool[] = [
  ...cicdTools,
  ...introspectionTools,
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
  vfHotReload,
  vfTriggerHmr,
  vfWaitForReady,
  vfRunLint,
  vfGetFlywheelStatus,
  vfRunTests,
];

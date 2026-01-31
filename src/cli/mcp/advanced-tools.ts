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
import { vfGetConventions, vfScaffold } from "./tools/scaffold-tools.ts";
import { vfGetSkillReference, vfGetSkills } from "./tools/skill-tools.ts";

export const advancedTools: MCPTool[] = [
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
  vfGetFlywheelStatus,
];

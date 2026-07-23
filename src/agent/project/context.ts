/** Context for mutable agent project. */
export interface MutableAgentProjectContext {
  /** Project ID value. */
  projectId: string;
  /** Branch ID value. */
  branchId?: string | null;
  /** Runtime target kind value. */
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
  /** Runtime target environment ID value. */
  runtimeTargetEnvironmentId?: string | null;
  /** Available skill IDs value. */
  availableSkillIds?: string[];
  /** Per-run skill id -> discovered SKILL.md source path (owner-aware catalog). */
  skillSourcePaths?: Readonly<Record<string, string>>;
}

/** Apply agent project context change helper. */
export function applyAgentProjectContextChange(
  context: MutableAgentProjectContext,
  projectId: string,
): boolean {
  if (projectId === context.projectId) {
    return false;
  }

  context.projectId = projectId;
  context.branchId = null;
  context.runtimeTargetKind = "main_branch";
  context.runtimeTargetEnvironmentId = null;
  context.availableSkillIds = undefined;
  context.skillSourcePaths = undefined;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isProjectContextSwitchContent(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof Reflect.get(value, "success") === "boolean" &&
    typeof Reflect.get(value, "project_id") === "string"
  );
}

function getProjectContextSwitchContent(result: unknown): Record<string, unknown> | null {
  if (isRecord(result)) {
    const structuredContent = Reflect.get(result, "structuredContent");
    if (isProjectContextSwitchContent(structuredContent)) {
      return structuredContent;
    }
  }

  if (isProjectContextSwitchContent(result)) {
    return result;
  }

  return null;
}

/** Return confirmed project context switch ID. */
export function getConfirmedProjectContextSwitchId(
  result: unknown,
  requestedProjectId: string,
): string | null {
  const content = getProjectContextSwitchContent(result);
  if (!content || Reflect.get(content, "success") !== true) {
    return null;
  }

  const projectId = Reflect.get(content, "project_id");
  if (typeof projectId !== "string") {
    return null;
  }

  return projectId === requestedProjectId ? projectId : null;
}

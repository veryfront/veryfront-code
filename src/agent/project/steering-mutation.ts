import {
  isErroredToolExecutionResult,
  readToolResultOwnDataProperty,
  UNREADABLE_TOOL_RESULT_PROPERTY,
} from "#veryfront/tool/result.ts";
import { SKILL_READABLE_DIRS } from "#veryfront/skill/types.ts";

/** Default value for project steering paths. */
export const DEFAULT_PROJECT_STEERING_PATHS = {
  instructions: ["AGENTS.md"],
  skills: ["skills", ".veryfront/skills"],
} as const;

/** Shared project steering file mutation tool names value. */
export const PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES = [
  "create_file",
  "update_file",
  "delete_file",
  "move_file",
] as const;

/** Public API contract for project steering paths. */
export type ProjectSteeringPaths = {
  instructions: readonly string[];
  skills: readonly string[];
};

/** Input payload for project steering mutation. */
export type ProjectSteeringMutationInput = {
  toolName: string;
  toolInput: Record<string, unknown>;
  activeProjectId?: string | null;
  activeBranchId?: string | null;
  steeringPaths?: ProjectSteeringPaths;
};

/** Result returned from project steering mutation. */
export type ProjectSteeringMutationResult = {
  instructionsChanged: boolean;
  skillsChanged: boolean;
};

const NO_MUTATION: ProjectSteeringMutationResult = {
  instructionsChanged: false,
  skillsChanged: false,
};

function getPathMutationFlags(
  path: string,
  steeringPaths: ProjectSteeringPaths,
): ProjectSteeringMutationResult {
  return {
    instructionsChanged: steeringPaths.instructions.includes(path),
    skillsChanged: isProjectSkillMutationPath(path, steeringPaths),
  };
}

function isProjectSkillMutationPath(
  path: string,
  steeringPaths: ProjectSteeringPaths,
): boolean {
  if (steeringPaths.skills.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
    return true;
  }

  const segments = path.split("/");
  if (segments[0] !== "agents" || !segments[1] || !segments[2]) {
    return false;
  }

  if (segments.length === 3) {
    return segments[2] === "AGENT.md" || segments[2] === "SKILL.md";
  }

  if (SKILL_READABLE_DIRS.some((directory) => segments[2] === directory)) {
    return true;
  }

  return segments[2] === "skills" && Boolean(segments[3]) && segments.length >= 5;
}

function mergeMutationFlags(
  flags: readonly ProjectSteeringMutationResult[],
): ProjectSteeringMutationResult {
  return {
    instructionsChanged: flags.some((flag) => flag.instructionsChanged),
    skillsChanged: flags.some((flag) => flag.skillsChanged),
  };
}

function matchesActiveProjectTarget(input: {
  toolInput: Record<string, unknown>;
  activeProjectId?: string | null;
  activeBranchId?: string | null;
}): boolean {
  if (!input.activeProjectId) {
    return false;
  }

  const projectReference = input.toolInput.project_reference;
  if (typeof projectReference !== "string" || projectReference !== input.activeProjectId) {
    return false;
  }

  const targetBranchId = typeof input.toolInput.branch_id === "string"
    ? input.toolInput.branch_id
    : null;
  return targetBranchId === (input.activeBranchId ?? null);
}

/** Return project steering mutation. */
export function getProjectSteeringMutation(
  input: ProjectSteeringMutationInput,
): ProjectSteeringMutationResult {
  if (
    !matchesActiveProjectTarget({
      toolInput: input.toolInput,
      activeProjectId: input.activeProjectId,
      activeBranchId: input.activeBranchId,
    })
  ) {
    return NO_MUTATION;
  }

  const steeringPaths = input.steeringPaths ?? DEFAULT_PROJECT_STEERING_PATHS;

  if (
    input.toolName === "create_file" || input.toolName === "update_file" ||
    input.toolName === "delete_file"
  ) {
    const path = input.toolInput.path;
    return typeof path === "string" ? getPathMutationFlags(path, steeringPaths) : NO_MUTATION;
  }

  if (input.toolName === "move_file") {
    const paths = [input.toolInput.source_path, input.toolInput.destination_path].filter((
      path,
    ): path is string => typeof path === "string");

    return mergeMutationFlags(paths.map((path) => getPathMutationFlags(path, steeringPaths)));
  }

  return NO_MUTATION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Result returned from is successful project steering mutation. */
export function isSuccessfulProjectSteeringMutationResult(result: unknown): boolean {
  if (isErroredToolExecutionResult(result)) {
    return false;
  }

  if (!isRecord(result)) {
    return true;
  }

  const success = readToolResultOwnDataProperty(result, "success");
  if (success === false || success === UNREADABLE_TOOL_RESULT_PROPERTY) {
    return false;
  }

  const structuredContent = readToolResultOwnDataProperty(result, "structuredContent");
  if (structuredContent === UNREADABLE_TOOL_RESULT_PROPERTY) {
    return false;
  }

  const structuredSuccess = readToolResultOwnDataProperty(structuredContent, "success");
  return !(
    isErroredToolExecutionResult(structuredContent) ||
    structuredSuccess === false ||
    structuredSuccess === UNREADABLE_TOOL_RESULT_PROPERTY
  );
}

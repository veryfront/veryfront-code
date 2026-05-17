import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  getProjectSteeringMutation,
  isSuccessfulProjectSteeringMutationResult,
  PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES,
} from "./steering-mutation.ts";

Deno.test("PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES contains canonical file mutation tools", () => {
  assertEquals(PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES, [
    "create_file",
    "update_file",
    "delete_file",
    "move_file",
  ]);
});

Deno.test("getProjectSteeringMutation detects instruction file writes for the active project", () => {
  assertEquals(
    getProjectSteeringMutation({
      toolName: "update_file",
      toolInput: {
        project_reference: "project-1",
        path: "AGENTS.md",
      },
      activeProjectId: "project-1",
      activeBranchId: null,
    }),
    { instructionsChanged: true, skillsChanged: false },
  );
});

Deno.test("getProjectSteeringMutation detects skill directory moves", () => {
  assertEquals(
    getProjectSteeringMutation({
      toolName: "move_file",
      toolInput: {
        project_reference: "project-1",
        branch_id: "branch-1",
        source_path: "src/old.ts",
        destination_path: ".veryfront/skills/react/SKILL.md",
      },
      activeProjectId: "project-1",
      activeBranchId: "branch-1",
    }),
    { instructionsChanged: false, skillsChanged: true },
  );
});

Deno.test("getProjectSteeringMutation ignores mutations for other projects", () => {
  assertEquals(
    getProjectSteeringMutation({
      toolName: "update_file",
      toolInput: {
        project_reference: "project-2",
        path: "AGENTS.md",
      },
      activeProjectId: "project-1",
      activeBranchId: null,
    }),
    { instructionsChanged: false, skillsChanged: false },
  );
});

Deno.test("isSuccessfulProjectSteeringMutationResult rejects errored tool results", () => {
  assertEquals(isSuccessfulProjectSteeringMutationResult({ isError: true }), false);
  assertEquals(
    isSuccessfulProjectSteeringMutationResult({ structuredContent: { success: false } }),
    false,
  );
  assertEquals(
    isSuccessfulProjectSteeringMutationResult({ structuredContent: { success: true } }),
    true,
  );
  assertEquals(isSuccessfulProjectSteeringMutationResult("plain result"), true);
});

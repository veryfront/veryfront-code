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

// Driven off the exported constant so the single-path dispatch and the constant
// cannot drift apart. `move_file` reads two paths and is covered separately.
const SINGLE_PATH_MUTATION_TOOL_NAMES = PROJECT_STEERING_FILE_MUTATION_TOOL_NAMES.filter(
  (toolName) => toolName !== "move_file",
);

Deno.test("getProjectSteeringMutation detects instruction file writes for the active project", () => {
  for (const toolName of SINGLE_PATH_MUTATION_TOOL_NAMES) {
    assertEquals(
      getProjectSteeringMutation({
        toolName,
        toolInput: {
          project_reference: "project-1",
          path: "AGENTS.md",
        },
        activeProjectId: "project-1",
        activeBranchId: null,
      }),
      { instructionsChanged: true, skillsChanged: false },
      `${toolName} on AGENTS.md flags an instruction change`,
    );
  }
});

Deno.test("getProjectSteeringMutation detects skill file writes for the active project", () => {
  for (const toolName of SINGLE_PATH_MUTATION_TOOL_NAMES) {
    assertEquals(
      getProjectSteeringMutation({
        toolName,
        toolInput: {
          project_reference: "project-1",
          path: "skills/react/SKILL.md",
        },
        activeProjectId: "project-1",
        activeBranchId: null,
      }),
      { instructionsChanged: false, skillsChanged: true },
      `${toolName} on a skill file flags a skills change`,
    );
  }
});

Deno.test("getProjectSteeringMutation detects skill directory moves", () => {
  assertEquals(
    getProjectSteeringMutation({
      toolName: "move_file",
      toolInput: {
        project_reference: "project-1",
        branch_id: "branch-1",
        source_path: "src/old.ts",
        destination_path: "skills/react/SKILL.md",
      },
      activeProjectId: "project-1",
      activeBranchId: "branch-1",
    }),
    { instructionsChanged: false, skillsChanged: true },
  );
});

Deno.test("getProjectSteeringMutation detects legacy hidden skill directory moves", () => {
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

Deno.test("getProjectSteeringMutation detects colocated skill writes", () => {
  for (
    const path of [
      "agents/researcher/AGENT.md",
      "agents/researcher/SKILL.md",
      "agents/researcher/references/style.md",
      "agents/researcher/resources/schema.json",
      "agents/researcher/assets/template.txt",
      "agents/researcher/skills/cite/references/style.md",
      "agents/researcher/skills/cite/resources/schema.json",
      "agents/researcher/skills/cite/assets/template.txt",
    ]
  ) {
    assertEquals(
      getProjectSteeringMutation({
        toolName: "update_file",
        toolInput: {
          project_reference: "project-1",
          branch_id: "branch-1",
          path,
        },
        activeProjectId: "project-1",
        activeBranchId: "branch-1",
      }),
      { instructionsChanged: false, skillsChanged: true },
    );
  }
});

Deno.test("getProjectSteeringMutation ignores unrelated colocated files", () => {
  for (
    const path of [
      "agents/researcher/notes.md",
      "agents/researcher/scripts/build.ts",
      "agents/researcher/skills/cite.md",
    ]
  ) {
    assertEquals(
      getProjectSteeringMutation({
        toolName: "update_file",
        toolInput: {
          project_reference: "project-1",
          branch_id: "branch-1",
          path,
        },
        activeProjectId: "project-1",
        activeBranchId: "branch-1",
      }),
      { instructionsChanged: false, skillsChanged: false },
    );
  }
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

Deno.test("getProjectSteeringMutation ignores mutations targeting another branch", () => {
  assertEquals(
    getProjectSteeringMutation({
      toolName: "update_file",
      toolInput: {
        project_reference: "project-1",
        branch_id: "branch-2",
        path: "AGENTS.md",
      },
      activeProjectId: "project-1",
      activeBranchId: "branch-1",
    }),
    { instructionsChanged: false, skillsChanged: false },
    "a write on another branch must not invalidate steering for the active branch",
  );

  assertEquals(
    getProjectSteeringMutation({
      toolName: "update_file",
      toolInput: {
        project_reference: "project-1",
        path: "AGENTS.md",
      },
      activeProjectId: "project-1",
      activeBranchId: "branch-1",
    }),
    { instructionsChanged: false, skillsChanged: false },
    "a branchless write must not match a branch-pinned run",
  );
});

Deno.test("getProjectSteeringMutation detects skill and instruction files moved out of steering locations", () => {
  assertEquals(
    getProjectSteeringMutation({
      toolName: "move_file",
      toolInput: {
        project_reference: "project-1",
        branch_id: "branch-1",
        source_path: "skills/react/SKILL.md",
        destination_path: "archive/old.md",
      },
      activeProjectId: "project-1",
      activeBranchId: "branch-1",
    }),
    { instructionsChanged: false, skillsChanged: true },
    "moving a skill file out of the skills directory must still report a skills change",
  );

  assertEquals(
    getProjectSteeringMutation({
      toolName: "move_file",
      toolInput: {
        project_reference: "project-1",
        branch_id: "branch-1",
        source_path: "AGENTS.md",
        destination_path: "archive/old.md",
      },
      activeProjectId: "project-1",
      activeBranchId: "branch-1",
    }),
    { instructionsChanged: true, skillsChanged: false },
    "moving AGENTS.md out of the project root must still report an instruction change",
  );
});

Deno.test("isSuccessfulProjectSteeringMutationResult rejects errored tool results", () => {
  assertEquals(isSuccessfulProjectSteeringMutationResult({ isError: true }), false);
  assertEquals(
    isSuccessfulProjectSteeringMutationResult({ error: "tool_error", message: "failed" }),
    false,
  );
  assertEquals(
    isSuccessfulProjectSteeringMutationResult({ output: { isError: true } }),
    false,
  );
  assertEquals(isSuccessfulProjectSteeringMutationResult({ success: false }), false);
  assertEquals(
    isSuccessfulProjectSteeringMutationResult({ structuredContent: { success: false } }),
    false,
  );
  assertEquals(
    isSuccessfulProjectSteeringMutationResult({
      structuredContent: { success: true, error: "tool_error" },
    }),
    false,
  );
  assertEquals(
    isSuccessfulProjectSteeringMutationResult({ structuredContent: { success: true } }),
    true,
  );
  assertEquals(isSuccessfulProjectSteeringMutationResult("plain result"), true);
});

Deno.test("isSuccessfulProjectSteeringMutationResult never invokes accessors", () => {
  let accessorCalls = 0;
  const result = {
    get structuredContent(): unknown {
      accessorCalls += 1;
      return { success: true };
    },
  };

  assertEquals(isSuccessfulProjectSteeringMutationResult(result), false);
  assertEquals(accessorCalls, 0);
});

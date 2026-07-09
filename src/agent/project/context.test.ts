import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  applyAgentProjectContextChange,
  getConfirmedProjectContextSwitchId,
  type MutableAgentProjectContext,
} from "./context.ts";

Deno.test("applyAgentProjectContextChange updates project and resets branch and skill context", () => {
  const context: MutableAgentProjectContext & { steeringRevision: number } = {
    projectId: "project-1",
    branchId: "branch-1",
    availableSkillIds: ["skill-a"],
    skillSourcePaths: { "skill-a": "skills/skill-a/SKILL.md" },
    steeringRevision: 3,
  };

  const changed = applyAgentProjectContextChange(context, "project-2");

  assertEquals(changed, true);
  assertEquals(context, {
    projectId: "project-2",
    branchId: null,
    runtimeTargetKind: "main_branch",
    runtimeTargetEnvironmentId: null,
    availableSkillIds: undefined,
    skillSourcePaths: undefined,
    steeringRevision: 3,
  });
});

Deno.test("applyAgentProjectContextChange leaves context unchanged when project is already active", () => {
  const context: MutableAgentProjectContext = {
    projectId: "project-1",
    branchId: "branch-1",
    availableSkillIds: ["skill-a"],
  };

  const changed = applyAgentProjectContextChange(context, "project-1");

  assertEquals(changed, false);
  assertEquals(context, {
    projectId: "project-1",
    branchId: "branch-1",
    availableSkillIds: ["skill-a"],
  });
});

Deno.test("getConfirmedProjectContextSwitchId reads matching successful structured content", () => {
  assertEquals(
    getConfirmedProjectContextSwitchId(
      {
        structuredContent: {
          success: true,
          project_id: "project-2",
        },
      },
      "project-2",
    ),
    "project-2",
  );
});

Deno.test("getConfirmedProjectContextSwitchId reads matching successful direct content", () => {
  assertEquals(
    getConfirmedProjectContextSwitchId(
      {
        success: true,
        project_id: "project-2",
      },
      "project-2",
    ),
    "project-2",
  );
});

Deno.test("getConfirmedProjectContextSwitchId ignores failed, missing, or mismatched content", () => {
  assertEquals(
    getConfirmedProjectContextSwitchId({ success: false, project_id: "project-2" }, "project-2"),
    null,
  );
  assertEquals(getConfirmedProjectContextSwitchId({ success: true }, "project-2"), null);
  assertEquals(
    getConfirmedProjectContextSwitchId({ success: true, project_id: "project-3" }, "project-2"),
    null,
  );
  assertEquals(getConfirmedProjectContextSwitchId(null, "project-2"), null);
});

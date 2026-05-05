import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { buildHostedChildForkInstructions } from "./hosted-child-fork-instructions.ts";

Deno.test("buildHostedChildForkInstructions includes base instructions", () => {
  const result = buildHostedChildForkInstructions({ projectId: "" });

  assert(result.includes("child fork"));
  assert(result.includes("Guidelines"));
});

Deno.test("buildHostedChildForkInstructions includes project context when projectId is provided", () => {
  const result = buildHostedChildForkInstructions({ projectId: "proj-123" });

  assert(result.includes("<project_context>"));
  assert(result.includes('project_reference: "proj-123"'));
});

Deno.test("buildHostedChildForkInstructions scopes project_reference guidance", () => {
  const result = buildHostedChildForkInstructions({ projectId: "proj-123" });

  assert(
    result.includes("Use project_reference only for tools whose schema requires project_reference"),
  );
  assert(result.includes("sandbox command tools use the sandbox session id"));
  assert(!result.includes("Almost ALL MCP tools require project_reference"));
});

Deno.test("buildHostedChildForkInstructions includes provided branch_id", () => {
  const result = buildHostedChildForkInstructions({
    projectId: "proj-123",
    branchId: "branch-456",
  });

  assert(result.includes('branch_id: "branch-456"'));
});

Deno.test("buildHostedChildForkInstructions shows main branch without branch_id", () => {
  const result = buildHostedChildForkInstructions({ projectId: "proj-123", branchId: null });

  assert(result.includes("branch_id: main"));
});

Deno.test("buildHostedChildForkInstructions omits project context when projectId is empty", () => {
  const result = buildHostedChildForkInstructions({ projectId: "" });

  assert(!result.includes('project_reference: ""'));
});

Deno.test("buildHostedChildForkInstructions includes sorted available skills", () => {
  const result = buildHostedChildForkInstructions({
    projectId: "proj-123",
    availableSkillIds: ["z-skill", "a-skill", "m-skill"],
  });

  assert(result.includes("## Available Skills"));
  assert(result.includes("a-skill, m-skill, z-skill"));
});

Deno.test("buildHostedChildForkInstructions omits empty available skills", () => {
  const result = buildHostedChildForkInstructions({ projectId: "proj-123", availableSkillIds: [] });

  assertEquals(result.includes("## Available Skills"), false);
});

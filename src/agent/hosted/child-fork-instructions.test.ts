import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { buildHostedChildForkInstructions } from "./child-fork-instructions.ts";

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

Deno.test("buildHostedChildForkInstructions states project context without tool argument recipes", () => {
  const result = buildHostedChildForkInstructions({ projectId: "proj-123" });

  assert(result.includes("Project source edits belong to the branch above."));
  assertEquals(result.includes("create_sandbox"), false);
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

Deno.test("buildHostedChildForkInstructions lists available skills without prescribing the resolved loader", () => {
  const result = buildHostedChildForkInstructions({
    projectId: "proj-123",
    availableSkillIds: ["design"],
    skillLoaderToolName: "veryfront__load_skill",
  });

  assertEquals(result.includes("load_skill"), false);
  assert(result.includes("Available: design"));
  assertEquals(result.includes("Use `load_skill`"), false);
  assertEquals(result.includes("Use load_skill to load instructions"), false);
});

Deno.test("buildHostedChildForkInstructions omits empty available skills", () => {
  const result = buildHostedChildForkInstructions({ projectId: "proj-123", availableSkillIds: [] });

  assertEquals(result.includes("## Available Skills"), false);
});

Deno.test("child fork guidance leaves invocation to the tool contract", () => {
  const result = buildHostedChildForkInstructions({
    skillLoaderToolName: "veryfront__load_skill",
    availableSkillIds: ["plan"],
  });
  assertEquals(result.includes("load_skill"), false);
  assert(result.includes("Available: plan"));
  assert(!result.includes("Use `load_skill`"));
});

Deno.test("root and child artifact guidance matches the canonical platform catalog without tool recipes", async () => {
  const { canonicalPlatformHostTools, withPlatformHostToolAliases } = await import(
    "../platform-host-tools.ts"
  );
  const { buildDefaultResearchArtifactPathReminder } = await import(
    "../artifacts/default-research-artifact-policy.ts"
  );
  const names = [
    "create_file",
    "update_file",
    "delete_file",
    "load_skill",
    "form_input",
    "create_sandbox",
    "generate_image",
    "web_fetch",
  ];
  const catalog = canonicalPlatformHostTools(
    withPlatformHostToolAliases(Object.fromEntries(names.map((id) => [id, {
      id,
      description: id,
      inputSchemaJson: { type: "object" },
      execute: () => ({ ok: true }),
    }]))),
  );
  assertEquals(Object.keys(catalog).sort(), names.map((name) => `veryfront__${name}`).sort());
  const root = buildDefaultResearchArtifactPathReminder({
    description: "Research",
    prompt: "Research the topic and save the report to the project",
    runId: "run_prompt",
  });
  assert(root);
  const child = buildHostedChildForkInstructions({
    projectId: "project",
    availableSkillIds: ["design"],
  });
  const policy = await import("../conversation/delegation-policy.ts");
  for (
    const prompt of [
      root,
      child,
      policy.buildStarterIntentRootOwnershipReminder(),
      policy.buildStarterIntentRootOwnershipBlockMessage(),
      policy.LOAD_SKILL_CONTINUATION_REMINDER,
    ]
  ) {
    for (const name of names) {
      assertEquals(
        new RegExp(`(?<![a-zA-Z0-9_])${name}\\b`).test(prompt),
        false,
        `prompt must not prescribe unavailable ${name}`,
      );
    }
  }
});

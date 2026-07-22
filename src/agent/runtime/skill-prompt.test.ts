import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import {
  buildRuntimeAvailableSkillsPromptBlock,
  formatRuntimeSkillMetadata,
  MAX_RUNTIME_SKILL_PROMPT_ENTRIES,
} from "./skill-prompt.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

function createSkill(
  input: Partial<RuntimeSkillDefinition> & Pick<RuntimeSkillDefinition, "id">,
): RuntimeSkillDefinition {
  return {
    description: `Description for ${input.id}`,
    instructions: `Instructions for ${input.id}`,
    allowedTools: [],
    name: input.id,
    ...input,
  };
}

Deno.test("formatRuntimeSkillMetadata renders structured skill defaults", () => {
  assertEquals(
    formatRuntimeSkillMetadata(
      createSkill({
        id: "knowledge",
        allowedTools: ["knowledge_lookup", "read_file"],
        model: "sonnet",
        thinking: 4096,
        maxSteps: 120,
      }),
    ),
    " (tools: knowledge_lookup, read_file; model: sonnet; thinking: 4096; max-steps: 120)",
  );
});

Deno.test("formatRuntimeSkillMetadata renders false thinking as off", () => {
  assertEquals(
    formatRuntimeSkillMetadata(createSkill({ id: "quick", thinking: false })),
    " (thinking: off)",
  );
});

Deno.test("formatRuntimeSkillMetadata returns an empty suffix without structured defaults", () => {
  assertEquals(formatRuntimeSkillMetadata(createSkill({ id: "plain" })), "");
});

Deno.test("buildRuntimeAvailableSkillsPromptBlock renders skills and delegation policy", () => {
  const block = buildRuntimeAvailableSkillsPromptBlock([
    createSkill({
      id: "build-ui",
      name: "Build UI guidance",
      description: "Build UI",
      allowedTools: ["bash", "writeFile"],
    }),
  ]);

  assertStringIncludes(block, "<available_skills>");
  assertStringIncludes(block, "</available_skills>");
  assertStringIncludes(block, "Use load_skill to load full instructions when needed.");
  assertStringIncludes(block, "load_skill only loads instructions plus metadata.");
  assertStringIncludes(block, "Continue the same turn after calling it");
  assertStringIncludes(block, "Keep the root assistant visibly owning the work.");
  assertStringIncludes(
    block,
    "When delegating, use the platform orchestration tool `invoke_agent`.",
  );
  assertStringIncludes(
    block,
    "Delegate only when isolation, parallelism, or a different tool/model budget materially helps.",
  );
  assertStringIncludes(block, "Pass through any returned model, thinking, or maxSteps overrides");
  assertStringIncludes(block, "Do not mention child agents, delegation, or tool/process narration");
  assertStringIncludes(
    block,
    "- Build UI guidance (`build-ui`): Build UI (tools: bash, writeFile)",
  );
});

Deno.test("buildRuntimeAvailableSkillsPromptBlock does not repeat an id-only name", () => {
  const block = buildRuntimeAvailableSkillsPromptBlock([
    createSkill({ id: "code-review", description: "Review code" }),
  ]);

  assertStringIncludes(block, "- code-review: Review code");
  assertEquals(block.includes("code-review (`code-review`)"), false);
});

Deno.test("buildRuntimeAvailableSkillsPromptBlock truncates long skill lists", () => {
  const skills = Array.from(
    { length: MAX_RUNTIME_SKILL_PROMPT_ENTRIES + 2 },
    (_unused, index) =>
      createSkill({
        id: `skill-${index + 1}`,
        description: `Skill ${index + 1}`,
      }),
  );

  const block = buildRuntimeAvailableSkillsPromptBlock(skills);

  assertStringIncludes(block, "- skill-1: Skill 1");
  assertStringIncludes(
    block,
    `- skill-${MAX_RUNTIME_SKILL_PROMPT_ENTRIES}: Skill ${MAX_RUNTIME_SKILL_PROMPT_ENTRIES}`,
  );
  assertEquals(
    block.includes(
      `- skill-${MAX_RUNTIME_SKILL_PROMPT_ENTRIES + 1}: Skill ${
        MAX_RUNTIME_SKILL_PROMPT_ENTRIES + 1
      }`,
    ),
    false,
  );
  assertStringIncludes(block, "(2 more skills available — use load_skill to discover)");
});

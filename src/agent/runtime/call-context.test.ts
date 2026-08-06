import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildAgentCallContext } from "./call-context.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

const MARKER = "<!-- veryfront-runtime-context -->";

function createSkills(): RuntimeSkillDefinition[] {
  return [
    {
      id: "deploy",
      name: "Deploy",
      displayName: "Deploy Skill",
      description: "Deployment guidance",
      instructions: "Deploy carefully.",
      allowedTools: ["create_file"],
      model: "openai/gpt-5.4",
      thinking: 512,
      maxSteps: 4,
    },
    {
      id: "review",
      name: "Review",
      description: "Review guidance",
      instructions: "Review carefully.",
      allowedTools: [],
    },
  ];
}

describe("agent/runtime/call-context", () => {
  // Layer 0 = the cached static prompt (marker head + tail). The dynamic tail
  // (project blocks, extra blocks, skills, environment) is a second, uncached
  // system message. See RFC 0001.
  describe("layering", () => {
    it("keeps the prompt in the static message and orders project, extra, and skills in the dynamic tail", () => {
      const [staticMsg, dynamicMsg] = buildAgentCallContext({
        instructions: `Head\n\n${MARKER}\n\nTail`,
        projectInstructions: "Follow the policy.",
        projectContext: { projectId: "project-1", branchId: "branch-9" },
        extraBlocks: ['<runtime_info>\nmodel: "openai/gpt-5.4"\n</runtime_info>'],
        skills: createSkills(),
      });

      // Static Layer 0 — prompt only (marker head + tail), no project/skills.
      assertEquals(staticMsg?.content, "Head\n\nTail");

      const dynamic = dynamicMsg?.content ?? "";
      const order = [
        "<project_instructions>",
        "<project_context>",
        "<runtime_info>",
        "<available_skills>",
      ].map((fragment) => dynamic.indexOf(fragment));

      assertEquals(order.some((index) => index < 0), false);
      assertEquals([...order].sort((a, b) => a - b), order);
    });

    it("keeps the static prompt byte-identical across projects (shared cache key)", () => {
      const layer0For = (projectId: string) =>
        buildAgentCallContext({
          instructions: "Shared prompt body",
          projectInstructions: `steering for ${projectId}`,
          projectContext: { projectId, branchId: "main" },
          skills: createSkills(),
          environmentContext: `facts for ${projectId}`,
        })[0]?.content;

      assertEquals(layer0For("project-a"), layer0For("project-b"));
      assertEquals(layer0For("project-a"), "Shared prompt body");
    });

    it("caches only the static message and leaves the dynamic tail uncached", () => {
      const messages = buildAgentCallContext({
        instructions: "Prompt",
        projectContext: { projectId: "project-1" },
        environmentContext: "Runtime facts",
      });

      assertEquals(messages[0]?.providerOptions, {
        anthropic: { cacheControl: { type: "ephemeral" } },
      });
      assertEquals(messages[1]?.providerOptions, undefined);
      // Nothing project-specific leaks into the cached prefix.
      assertEquals((messages[0]?.content ?? "").includes("project-1"), false);
    });

    it("extends the static breakpoint to 1h when cacheTtl is 1h", () => {
      const messages = buildAgentCallContext({ instructions: "Prompt", cacheTtl: "1h" });

      assertEquals(messages[0]?.providerOptions, {
        anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
      });
    });

    it("puts extra blocks in the dynamic tail, separate from the static prompt", () => {
      const [staticMsg, dynamicMsg] = buildAgentCallContext({
        instructions: "Base instructions",
        extraBlocks: ["Dynamic block"],
      });

      assertEquals(staticMsg?.content, "Base instructions");
      assertEquals(dynamicMsg?.content, "Dynamic block");
    });
  });

  describe("block tags", () => {
    it("renders project instructions with the mandatory-compliance preamble in the dynamic tail", () => {
      const [, dynamicMsg] = buildAgentCallContext({
        instructions: "Base",
        projectInstructions: "Use the project policy.",
      });

      assertEquals(
        dynamicMsg?.content,
        "<project_instructions>\nCRITICAL: You MUST follow these project-specific guidelines:\n\nUse the project policy.\n</project_instructions>",
      );
    });

    it("renders an explicit branch id and falls back to main guidance", () => {
      const [, explicit] = buildAgentCallContext({
        instructions: "Base",
        projectContext: { projectId: "project-1", branchId: "branch-9" },
      });
      const [, fallback] = buildAgentCallContext({
        instructions: "Base",
        projectContext: { projectId: "project-1" },
      });

      assertStringIncludes(explicit?.content ?? "", 'branch_id: "branch-9"');
      assertStringIncludes(
        fallback?.content ?? "",
        "branch_id: main (no branch_id needed for file operations)",
      );
      assertStringIncludes(fallback?.content ?? "", 'project_reference: "project-1"');
    });

    it("emits environment context as its own uncached message", () => {
      const messages = buildAgentCallContext({
        instructions: "Base",
        environmentContext: "Runtime facts",
      });

      assertEquals(messages.length, 2);
      assertEquals(messages[0]?.providerOptions, {
        anthropic: { cacheControl: { type: "ephemeral" } },
      });
      assertEquals(messages[1], {
        role: "system",
        content: "<environment_context>\nRuntime facts\n</environment_context>",
      });
    });
  });

  describe("empty inputs", () => {
    it("returns the prompt alone when nothing else is supplied", () => {
      const messages = buildAgentCallContext({ instructions: "Base instructions" });

      assertEquals(messages.length, 1);
      assertEquals(messages[0]?.content, "Base instructions");
    });

    it("omits the skills block for an empty skill list and drops empty extra blocks", () => {
      const [staticMsg, dynamicMsg] = buildAgentCallContext({
        instructions: "Base",
        skills: [],
        extraBlocks: ["", "Kept"],
      });

      assertEquals(staticMsg?.content, "Base");
      assertEquals(dynamicMsg?.content, "Kept");
    });
  });

  describe("skills rendering", () => {
    it("renders skill metadata and scopes delegation to the available tools", () => {
      const [, dynamicMsg] = buildAgentCallContext({
        instructions: "Base",
        skills: createSkills(),
        availableToolNames: ["agent_reviewer", "load_skill"],
      });

      const content = dynamicMsg?.content ?? "";
      assertStringIncludes(content, "<available_skills>");
      assertStringIncludes(
        content,
        '- {"skillId":"deploy","name":"Deploy","displayName":"Deploy Skill","description":"Deployment guidance","allowedTools":[],"model":"openai/gpt-5.4","thinking":512,"maxSteps":4}',
      );
      assertEquals(content.includes("create_file"), false);
      assertStringIncludes(
        content,
        '- {"skillId":"review","name":"Review","description":"Review guidance"}',
      );
      assertStringIncludes(
        content,
        'When delegating, use only these available scoped delegation tools: "agent_reviewer".',
      );
    });

    it("adds the skill tool call signatures only when the caller opts in", () => {
      const [, without] = buildAgentCallContext({ instructions: "Base", skills: createSkills() });
      const [, with_] = buildAgentCallContext({
        instructions: "Base",
        skills: createSkills(),
        includeSkillToolUsage: true,
      });

      assertEquals((without?.content ?? "").includes("execute_skill_script"), false);
      assertStringIncludes(with_?.content ?? "", "load_skill_reference: Call with");
      assertStringIncludes(with_?.content ?? "", "execute_skill_script: Call with");
    });
  });

  describe("marker splitting", () => {
    it("honours a caller-supplied marker, keeping head and tail in the static prompt", () => {
      const [staticMsg, dynamicMsg] = buildAgentCallContext({
        instructions: "Head\n<!--CUT-->\nTail",
        runtimeContextMarker: "<!--CUT-->",
        extraBlocks: ["Block"],
      });

      assertEquals(staticMsg?.content, "Head\n\nTail");
      assertEquals(dynamicMsg?.content, "Block");
    });

    it("drops a whitespace-only tail", () => {
      const [staticMsg, dynamicMsg] = buildAgentCallContext({
        instructions: `Head\n\n${MARKER}\n\n   `,
        extraBlocks: ["Block"],
      });

      assertEquals(staticMsg?.content, "Head");
      assertEquals(dynamicMsg?.content, "Block");
    });
  });

  describe("deduplication", () => {
    it("skips blocks whose tag the instructions already carry", () => {
      const messages = buildAgentCallContext({
        instructions:
          '<project_context>\nproject_reference: "already-there"\n</project_context>\n\nBase',
        projectContext: { projectId: "project-1" },
        environmentContext: "Runtime facts",
      });

      // The authored block stays in the (static) instructions; the runtime copy
      // is deduped, so the dynamic tail carries only the environment context.
      assertEquals(
        messages[0]?.content,
        '<project_context>\nproject_reference: "already-there"\n</project_context>\n\nBase',
      );
      assertEquals(
        messages[1]?.content,
        "<environment_context>\nRuntime facts\n</environment_context>",
      );
    });

    it("still emits the block when the instructions only name the tag in prose", () => {
      const [staticMsg, dynamicMsg] = buildAgentCallContext({
        instructions:
          "Never invent a project reference; read it from the <project_context> block instead.",
        projectContext: { projectId: "project-1" },
      });

      // A prose mention (no closing tag) must not suppress the real block.
      assertStringIncludes(staticMsg?.content ?? "", "<project_context>");
      assertStringIncludes(dynamicMsg?.content ?? "", 'project_reference: "project-1"');
      assertStringIncludes(dynamicMsg?.content ?? "", "</project_context>");
    });

    it("still emits environment context when the instructions only name the tag in prose", () => {
      const messages = buildAgentCallContext({
        instructions: "Runtime facts arrive in an <environment_context> block.",
        environmentContext: "Runtime facts",
      });

      assertEquals(messages.length, 2);
      assertEquals(
        messages[1]?.content,
        "<environment_context>\nRuntime facts\n</environment_context>",
      );
    });

    it("skips environment context the instructions already carry", () => {
      const messages = buildAgentCallContext({
        instructions: "Base\n\n<environment_context>\nAlready here\n</environment_context>",
        environmentContext: "Runtime facts",
      });

      assertEquals(messages.length, 1);
      assertEquals((messages[0]?.content ?? "").includes("Runtime facts"), false);
    });

    it("skips the skills block when the instructions already carry one", () => {
      const messages = buildAgentCallContext({
        instructions:
          "Base\n\n<available_skills>\n- authored: An authored catalog\n</available_skills>",
        skills: createSkills(),
      });

      assertEquals(messages.length, 1);
      assertEquals(
        messages[0]?.content,
        "Base\n\n<available_skills>\n- authored: An authored catalog\n</available_skills>",
      );
      assertEquals((messages[0]?.content ?? "").includes("Deployment guidance"), false);
    });

    it("still emits the skills block when the instructions only name the tag in prose", () => {
      const [, dynamicMsg] = buildAgentCallContext({
        instructions: "Your catalog arrives in an <available_skills> block.",
        skills: createSkills(),
      });

      assertStringIncludes(
        dynamicMsg?.content ?? "",
        '- {"skillId":"review","name":"Review","description":"Review guidance"}',
      );
      assertStringIncludes(dynamicMsg?.content ?? "", "</available_skills>");
    });

    it("keeps untagged extra blocks that cannot be matched by tag", () => {
      const [staticMsg, dynamicMsg] = buildAgentCallContext({
        instructions: "Base",
        extraBlocks: ["Plain guidance", "Plain guidance"],
      });

      assertEquals(staticMsg?.content, "Base");
      assertEquals(dynamicMsg?.content, "Plain guidance\n\nPlain guidance");
    });
  });
});

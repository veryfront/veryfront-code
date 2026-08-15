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
  describe("block ordering", () => {
    it("orders project instructions, project context, and extra blocks before the marker tail", () => {
      const [message] = buildAgentCallContext({
        instructions: `Head\n\n${MARKER}\n\nTail`,
        projectInstructions: "Follow the policy.",
        projectContext: { projectId: "project-1", branchId: "branch-9" },
        extraBlocks: ['<runtime_info>\nmodel: "openai/gpt-5.4"\n</runtime_info>'],
        skills: createSkills(),
      });

      const content = message?.content ?? "";
      const order = [
        "Head",
        "<project_instructions>",
        "<project_context>",
        "<runtime_info>",
        "Tail",
        "<available_skills>",
      ].map((fragment) => content.indexOf(fragment));

      assertEquals(order.some((index) => index < 0), false);
      assertEquals([...order].sort((a, b) => a - b), order);
    });

    it("appends blocks after the instructions when the marker is absent", () => {
      const [message] = buildAgentCallContext({
        instructions: "Base instructions",
        extraBlocks: ["Dynamic block"],
      });

      assertEquals(message?.content, "Base instructions\n\nDynamic block");
    });
  });

  describe("block tags", () => {
    it("renders project instructions with the mandatory-compliance preamble", () => {
      const [message] = buildAgentCallContext({
        instructions: "Base",
        projectInstructions: "Use the project policy.",
      });

      assertEquals(
        message?.content,
        "Base\n\n<project_instructions>\nCRITICAL: You MUST follow these project-specific guidelines:\n\nUse the project policy.\n</project_instructions>",
      );
    });

    it("renders an explicit branch id and falls back to main guidance", () => {
      const [explicit] = buildAgentCallContext({
        instructions: "Base",
        projectContext: { projectId: "project-1", branchId: "branch-9" },
      });
      const [fallback] = buildAgentCallContext({
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
    it("returns instructions alone when nothing else is supplied", () => {
      const messages = buildAgentCallContext({ instructions: "Base instructions" });

      assertEquals(messages.length, 1);
      assertEquals(messages[0]?.content, "Base instructions");
    });

    it("omits the skills block for an empty skill list and drops empty extra blocks", () => {
      const messages = buildAgentCallContext({
        instructions: "Base",
        skills: [],
        extraBlocks: ["", "Kept"],
      });

      assertEquals(messages.length, 1);
      assertEquals(messages[0]?.content, "Base\n\nKept");
    });
  });

  describe("skills rendering", () => {
    it("renders only the skill catalogue, with no orchestration prose", () => {
      const [message] = buildAgentCallContext({
        instructions: "Base",
        skills: createSkills(),
      });

      const content = message?.content ?? "";
      assertStringIncludes(content, "<available_skills>");
      // Identity only: model/thinking/maxSteps are returned structurally by
      // load_skill, which is when a caller needs them.
      assertStringIncludes(
        content,
        '- {"skillId":"deploy","name":"Deploy","displayName":"Deploy Skill","description":"Deployment guidance"}',
      );
      assertStringIncludes(
        content,
        '- {"skillId":"review","name":"Review","description":"Review guidance"}',
      );
      assertEquals(content.includes("create_file"), false);

      // The block carries no orchestration policy; that lives in the
      // load_skill tool description and the agent's own instructions.
      for (
        const prose of [
          "Continue the same turn",
          "Keep the root assistant",
          "When delegating",
          "Delegate only when",
          "Do not mention child agents",
          "Do NOT attempt tools",
        ]
      ) {
        assertEquals(content.includes(prose), false);
      }
    });
  });

  describe("marker splitting", () => {
    it("honours a caller-supplied marker", () => {
      const [message] = buildAgentCallContext({
        instructions: "Head\n<!--CUT-->\nTail",
        runtimeContextMarker: "<!--CUT-->",
        extraBlocks: ["Block"],
      });

      assertEquals(message?.content, "Head\n\nBlock\n\nTail");
    });

    it("drops a whitespace-only tail", () => {
      const [message] = buildAgentCallContext({
        instructions: `Head\n\n${MARKER}\n\n   `,
        extraBlocks: ["Block"],
      });

      assertEquals(message?.content, "Head\n\nBlock");
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
      const [message] = buildAgentCallContext({
        instructions:
          "Never invent a project reference; read it from the <project_context> block instead.",
        projectContext: { projectId: "project-1" },
      });

      assertStringIncludes(message?.content ?? "", 'project_reference: "project-1"');
      assertEquals((message?.content ?? "").split("<project_context>").length - 1, 2);
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

    it("keeps authorized skill IDs when instructions already carry a skills block", () => {
      const [message] = buildAgentCallContext({
        instructions:
          "Base\n\n<available_skills>\n- authored: An authored catalog\n</available_skills>",
        skills: createSkills(),
      });

      assertStringIncludes(
        message?.content ?? "",
        "Base\n\n<available_skills>\n- authored: An authored catalog\n</available_skills>",
      );
      assertStringIncludes(
        message?.content ?? "",
        '<available_skill_ids>\nAuthoritative skill IDs: ["deploy","review"]\n</available_skill_ids>',
      );
      assertEquals((message?.content ?? "").includes("Deployment guidance"), false);
    });

    it("replaces an earlier generated skill-ID fallback during recomposition", () => {
      const [first] = buildAgentCallContext({
        instructions:
          "Base\n\n<available_skills>\n- authored: An authored catalog\n</available_skills>",
        skills: createSkills(),
      });
      const [second] = buildAgentCallContext({
        instructions: first?.content ?? "",
        skills: [{
          id: "audit",
          name: "Audit",
          description: "Audit guidance",
          instructions: "Audit the change",
        }],
      });

      assertEquals((second?.content ?? "").match(/<available_skill_ids>/g)?.length, 1);
      assertStringIncludes(
        second?.content ?? "",
        '<available_skill_ids>\nAuthoritative skill IDs: ["audit"]\n</available_skill_ids>',
      );
      assertEquals((second?.content ?? "").includes('Authoritative skill IDs: ["deploy"'), false);
    });

    it("still emits the skills block when the instructions only name the tag in prose", () => {
      const [message] = buildAgentCallContext({
        instructions: "Your catalog arrives in an <available_skills> block.",
        skills: createSkills(),
      });

      assertStringIncludes(
        message?.content ?? "",
        '- {"skillId":"review","name":"Review","description":"Review guidance"}',
      );
      assertStringIncludes(message?.content ?? "", "</available_skills>");
    });

    it("keeps untagged extra blocks that cannot be matched by tag", () => {
      const [message] = buildAgentCallContext({
        instructions: "Base",
        extraBlocks: ["Plain guidance", "Plain guidance"],
      });

      assertEquals(message?.content, "Base\n\nPlain guidance\n\nPlain guidance");
    });
  });
});

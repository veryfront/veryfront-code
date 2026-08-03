import { renderToString } from "react-dom/server";
import { assert, assertStringIncludes } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { ChatDynamicToolPart } from "#veryfront/agent/react";
import { SkillBadge } from "./skill-badge.tsx";

const loadingSkill: ChatDynamicToolPart = {
  type: "dynamic-tool",
  toolCallId: "tool-1",
  toolName: "load_skill",
  state: "input-available",
  input: { skillId: "code-review" },
};

const completedSkill: ChatDynamicToolPart = {
  ...loadingSkill,
  state: "output-available",
};

const erroredScript: ChatDynamicToolPart = {
  type: "dynamic-tool",
  toolCallId: "tool-2",
  toolName: "execute_skill_script",
  state: "output-error",
  input: { script: "build.sh" },
};

describe("SkillBadge — load_skill", () => {
  it('shows a "Loading skill: <id>..." label while pending', () => {
    const html = renderToString(<SkillBadge tool={loadingSkill} />);
    assertStringIncludes(html, "Loading skill: code-review...");
  });

  it('shows "Skill: <id>" once output is available, with the success icon', () => {
    const html = renderToString(<SkillBadge tool={completedSkill} />);
    assertStringIncludes(html, "Skill: code-review");
    assertStringIncludes(html, "text-[var(--success)]");
  });
});

describe("SkillBadge — load_skill_reference", () => {
  it('shows a "Reading: <reference>..." label while pending', () => {
    const tool: ChatDynamicToolPart = {
      type: "dynamic-tool",
      toolCallId: "tool-3",
      toolName: "load_skill_reference",
      state: "input-available",
      input: { reference: "assets/spec.md" },
    };
    const html = renderToString(<SkillBadge tool={tool} />);
    assertStringIncludes(html, "Reading: assets/spec.md...");
  });
});

describe("SkillBadge — execute_skill_script", () => {
  it("shows an errored script with the error icon, not the success icon", () => {
    const html = renderToString(<SkillBadge tool={erroredScript} />);
    assertStringIncludes(html, "Running: build.sh...");
    assertStringIncludes(html, "text-[var(--destructive)]");
    assert(!html.includes("text-[var(--success)]"));
  });
});

describe("SkillBadge — icon override", () => {
  it("replaces the built-in state glyph for all states, including success", () => {
    const html = renderToString(
      <SkillBadge tool={completedSkill} icon={<span data-testid="custom-glyph">*</span>} />,
    );
    assertStringIncludes(html, "custom-glyph");
    assert(
      !html.includes("text-[var(--success)]"),
      "the built-in success checkmark must not also render",
    );
  });
});

describe("SkillBadge — restyles", () => {
  it("className merges onto the badge wrapper", () => {
    const html = renderToString(<SkillBadge tool={loadingSkill} className="vf-custom-skill" />);
    assertStringIncludes(html, "vf-custom-skill");
  });
});
